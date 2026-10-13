-- Incomplete quantities are not evidence for a full-line credit.
create or replace function public.expected_credit_gross(p_flags jsonb,p_gross numeric,p_qty_ordered integer,p_qty_received integer,p_qty_returned integer)
returns numeric language plpgsql immutable as $$
begin
 if p_qty_ordered is null or p_qty_ordered<=0 or p_gross is null or p_gross<0 then return 0; end if;
 if p_flags ? 'not_received' or p_flags ? 'damaged' then return p_gross; end if;
 if p_flags ? 'short' then
  if p_qty_received is null or p_qty_received<0 or p_qty_received>=p_qty_ordered then return 0; end if;
  return round(p_gross*(p_qty_ordered-p_qty_received)/p_qty_ordered,2);
 end if;
 if p_flags ? 'returned' then
  if p_qty_returned is null or p_qty_returned<=0 or p_qty_returned>p_qty_ordered then return 0; end if;
  return round(p_gross*p_qty_returned/p_qty_ordered,2);
 end if;
 return 0;
end $$;
-- Amount alone is not evidence that a supplier credit resolves a particular claim.
-- Use one exact reference + amount candidate; ambiguous credits stay open for review.
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
  update public.credit_requests set status='resolved',resolved_at=now(),resolved_via_statement_line_id=sl.id where id=target;
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
 update public.invoice_lines set credited_via_statement_line_id=sl.id where id=target;
 update public.statement_lines set resolved_invoice_line_id=target where id=sl.id;
 return target;
end $$;
create or replace function public.try_match_credit_row_to_returned_line(p_statement_line_id uuid)
returns uuid language sql security invoker set search_path=public as $$
 select public.try_match_credit_row_safely(p_statement_line_id);
$$;
create or replace function public.try_match_returned_line_to_credit_row(p_invoice_line_id uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare row_id uuid; found_id uuid;
begin
 for row_id in select sl.id from public.statement_lines sl join public.invoice_lines il on il.pharmacy_id=sl.pharmacy_id
 where il.id=p_invoice_line_id and sl.document_type='CRED' and sl.resolved_credit_request_id is null and sl.resolved_invoice_line_id is null
 loop
  found_id:=public.try_match_credit_row_safely(row_id);
  if found_id=p_invoice_line_id then return row_id; end if;
 end loop;
 return null;
end $$;
create or replace function public.try_match_credit_request_to_credit_row(p_credit_request_id uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare row_id uuid; found_id uuid;
begin
 for row_id in select sl.id from public.statement_lines sl join public.credit_requests cr on cr.pharmacy_id=sl.pharmacy_id
 where cr.id=p_credit_request_id and sl.document_type='CRED' and sl.resolved_credit_request_id is null and sl.resolved_invoice_line_id is null
 loop
  found_id:=public.try_match_credit_row_safely(row_id);
  if found_id=p_credit_request_id then return row_id; end if;
 end loop;
 return null;
end $$;
revoke all on function public.try_match_credit_row_safely(uuid) from public,anon;
revoke all on function public.try_match_credit_row_to_returned_line(uuid) from public,anon;
revoke all on function public.try_match_returned_line_to_credit_row(uuid) from public,anon;
revoke all on function public.try_match_credit_request_to_credit_row(uuid) from public,anon;
grant execute on function public.try_match_credit_row_safely(uuid), public.try_match_credit_row_to_returned_line(uuid),
 public.try_match_returned_line_to_credit_row(uuid), public.try_match_credit_request_to_credit_row(uuid) to authenticated;
