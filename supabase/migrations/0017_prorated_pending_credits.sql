-- Statement "credits pending" uses the same prorated amount as claims and the credit matcher:
-- a one-pack shortage from ten is a tenth of the line, not the whole line (expected_credit_gross, 0010).
create or replace function public.recompute_statement_credits_pending(
  p_statement_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(12, 2);
begin
  -- Build the set of credit_request_ids that have been resolved on this
  -- specific statement (via CRED rows). Lines linked to those credit_requests
  -- are NOT pending anymore.
  with resolved_crs_on_this_statement as (
    select sl.resolved_credit_request_id as cr_id
      from public.statement_lines sl
     where sl.statement_id = p_statement_id
       and sl.resolved_credit_request_id is not null
  ),
  matched_invoices as (
    select distinct sl.matched_invoice_id as inv_id
      from public.statement_lines sl
     where sl.statement_id = p_statement_id
       and sl.matched_invoice_id is not null
  ),
  pending_lines as (
    select public.expected_credit_gross(il.flags, il.gross, il.qty_ordered, il.qty_received, il.qty_returned) as gross
      from public.invoice_lines il
      join matched_invoices mi on mi.inv_id = il.invoice_id
     where (
            il.flags ? 'short'
         or il.flags ? 'damaged'
         or il.flags ? 'returned'
         or il.flags ? 'not_received'
       )
       and il.credited_via_statement_line_id is null
       and (
         il.credit_request_id is null
         or il.credit_request_id not in (select cr_id from resolved_crs_on_this_statement where cr_id is not null)
       )
  )
  select coalesce(sum(gross), 0)::numeric(12, 2)
    into v_total
    from pending_lines;

  update public.statements
     set credits_pending_total = v_total
   where id = p_statement_id;

  return v_total;
end;
$$;

grant execute on function public.recompute_statement_credits_pending(uuid) to authenticated;
