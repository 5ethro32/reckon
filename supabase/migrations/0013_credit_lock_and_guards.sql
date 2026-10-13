-- Review fixes for the credit workflow (PR #2).
-- 1. Claim creation takes the per-pharmacy credit lock used by try_match_credit_row_safely,
--    so a statement credit and a new claim cannot both take one invoice line.
-- 2. The matcher re-checks that the claim is still open and the line still unclaimed
--    when it writes, instead of relying on the earlier read.
create or replace function public.try_match_credit_row_safely(p_statement_line_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare sl public.statement_lines; st public.statements; ids uuid[]; target uuid;
begin
 select * into sl from public.statement_lines where id=p_statement_line_id;
 if sl.id is null or auth.uid() is null or not public.user_belongs_to_pharmacy(sl.pharmacy_id) then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('credit:'||sl.pharmacy_id::text,0));
 select * into sl from public.statement_lines where id=p_statement_line_id for update;
 select * into st from public.statements where id=sl.statement_id and deleted_at is null;
 if st.id is null or st.pharmacy_id<>sl.pharmacy_id or sl.document_type<>'CRED'
  or sl.resolved_credit_request_id is not null or sl.resolved_invoice_line_id is not null then return null; end if;
 -- The same supplier credit may appear on successive statements. Consume it once.
 if nullif(sl.document_number,'') is not null and exists (
  select 1 from public.statement_lines prior join public.statements ps on ps.id=prior.statement_id
  where prior.id<>sl.id and prior.pharmacy_id=sl.pharmacy_id and ps.supplier=st.supplier
  and prior.document_type='CRED' and prior.document_number=sl.document_number
  and (prior.resolved_credit_request_id is not null or prior.resolved_invoice_line_id is not null)
 ) then return null; end if;
 select array_agg(cr.id) into ids from public.credit_requests cr
 where cr.pharmacy_id=sl.pharmacy_id and cr.supplier=st.supplier
 and cr.status in ('draft','sent','overdue') and cr.resolved_at is null
 and abs(cr.total_amount-abs(sl.total))<0.01
 and ((nullif(cr.external_credit_note_number,'') is not null and cr.external_credit_note_number=sl.document_number)
  or exists(select 1 from public.invoice_lines il join public.invoices i on i.id=il.invoice_id
   where il.credit_request_id=cr.id and il.pharmacy_id=sl.pharmacy_id and i.pharmacy_id=sl.pharmacy_id
   and i.deleted_at is null and i.supplier=st.supplier and nullif(sl.reference,'')=i.invoice_number));
 if cardinality(ids)>1 then return null; end if;
 if cardinality(ids)=1 then
  target:=ids[1];
  -- An invoice reference may fit a loose exception as well as a grouped claim.
  -- Only an explicit supplier credit-note reference disambiguates that case.
  if not exists(select 1 from public.credit_requests cr where cr.id=target and nullif(cr.external_credit_note_number,'')=sl.document_number)
   and exists(select 1 from public.invoice_lines il join public.invoices i on i.id=il.invoice_id
    where il.pharmacy_id=sl.pharmacy_id and i.pharmacy_id=sl.pharmacy_id and i.supplier=st.supplier
    and i.deleted_at is null and nullif(sl.reference,'')=i.invoice_number
    and il.credit_request_id is null and il.credited_via_statement_line_id is null
    and public.expected_credit_gross(il.flags,il.gross,il.qty_ordered,il.qty_received,il.qty_returned)>0
    and abs(public.expected_credit_gross(il.flags,il.gross,il.qty_ordered,il.qty_received,il.qty_returned)-abs(sl.total))<0.01
   ) then return null; end if;
  update public.credit_requests set status='resolved',resolved_at=now(),resolved_via_statement_line_id=sl.id
   where id=target and status in ('draft','sent','overdue') and resolved_at is null;
  if not found then return null; end if;
  update public.statement_lines set resolved_credit_request_id=target where id=sl.id;
  return target;
 end if;
 select array_agg(il.id) into ids from public.invoice_lines il join public.invoices i on i.id=il.invoice_id
 where il.pharmacy_id=sl.pharmacy_id and i.pharmacy_id=sl.pharmacy_id and i.supplier=st.supplier and i.deleted_at is null
 and il.credit_request_id is null and il.credited_via_statement_line_id is null
 and nullif(sl.reference,'')=i.invoice_number
 and public.expected_credit_gross(il.flags,il.gross,il.qty_ordered,il.qty_received,il.qty_returned)>0
 and abs(public.expected_credit_gross(il.flags,il.gross,il.qty_ordered,il.qty_received,il.qty_returned)-abs(sl.total))<0.01;
 if cardinality(ids)<>1 or ids is null then return null; end if;
 target:=ids[1];
 update public.invoice_lines set credited_via_statement_line_id=sl.id
  where id=target and credit_request_id is null and credited_via_statement_line_id is null;
 if not found then return null; end if;
 update public.statement_lines set resolved_invoice_line_id=target where id=sl.id;
 return target;
end $$;
create or replace function public.create_credit_request_from_lines(p_line_ids uuid[],p_payload jsonb)
returns uuid language plpgsql security invoker set search_path=public as $$
declare l public.invoice_lines; pharmacy uuid; supplier_name text; n integer:=0; expected numeric:=0; claim_id uuid;
begin
 if auth.uid() is null or cardinality(p_line_ids) is null or cardinality(p_line_ids)<1 or cardinality(p_line_ids)>200 then raise exception 'Select up to 200 lines'; end if;
 -- Same per-pharmacy lock as the statement matcher, so a credit row and a new claim
 -- cannot both take the same invoice line.
 select il.pharmacy_id into pharmacy from public.invoice_lines il where il.id=any(p_line_ids) limit 1;
 if pharmacy is null then raise exception 'Some lines are missing or inaccessible'; end if;
 perform pg_advisory_xact_lock(hashtextextended('credit:'||pharmacy::text,0));
 for l in select * from public.invoice_lines where id=any(p_line_ids) order by id for update loop
  if l.credit_request_id is not null or l.credited_via_statement_line_id is not null then raise exception 'A line already belongs to a claim or credit. Refresh before continuing'; end if;
  if pharmacy is null then pharmacy:=l.pharmacy_id; end if;
  if l.pharmacy_id<>pharmacy then raise exception 'Lines must belong to one pharmacy'; end if;
  if not exists(select 1 from public.invoices i where i.id=l.invoice_id and i.pharmacy_id=pharmacy and i.deleted_at is null and i.supplier=p_payload->>'supplier') then raise exception 'Invoice supplier or status changed'; end if;
  if l.qty_ordered<=0 or (l.flags ? 'short' and (l.qty_received is null or l.qty_received<0 or l.qty_received>=l.qty_ordered))
   or (l.flags ? 'returned' and (l.qty_returned is null or l.qty_returned<=0 or l.qty_returned>l.qty_ordered)) then raise exception 'Confirm affected quantities'; end if;
  if public.expected_credit_gross(l.flags,l.gross,l.qty_ordered,l.qty_received,l.qty_returned)<=0 then raise exception 'Line has no credit amount'; end if;
  expected:=expected+public.expected_credit_gross(l.flags,l.gross,l.qty_ordered,l.qty_received,l.qty_returned);
  n:=n+1;
 end loop;
 if n<>cardinality(p_line_ids) then raise exception 'Some lines are missing or inaccessible'; end if;
 if abs(expected-(p_payload->>'total_amount')::numeric)>=0.01 or p_payload->>'total_amount' is null then raise exception 'Invoice quantities changed. Refresh before creating the claim'; end if;
 insert into public.credit_requests(pharmacy_id,supplier,status,total_amount,email_to,email_subject,email_body)
 values(pharmacy,p_payload->>'supplier','draft',expected,p_payload->>'email_to',p_payload->>'email_subject',p_payload->>'email_body') returning id into claim_id;
 update public.invoice_lines set credit_request_id=claim_id where id=any(p_line_ids);
 return claim_id;
end $$;
