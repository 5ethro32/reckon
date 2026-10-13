-- A concurrent request must not steal invoice lines from an existing claim.
create function public.create_credit_request_from_lines(p_line_ids uuid[],p_payload jsonb)
returns uuid language plpgsql security invoker set search_path=public as $$
declare l public.invoice_lines; pharmacy uuid; supplier_name text; n integer:=0; expected numeric:=0; claim_id uuid;
begin
 if auth.uid() is null or cardinality(p_line_ids) is null or cardinality(p_line_ids)<1 or cardinality(p_line_ids)>200 then raise exception 'Select up to 200 lines'; end if;
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
revoke all on function public.create_credit_request_from_lines(uuid[],jsonb) from public,anon;
grant execute on function public.create_credit_request_from_lines(uuid[],jsonb) to authenticated;
