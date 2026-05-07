-- ============================================================================
-- Reckon — symmetric credit_request <-> CRED-row matcher (M3 follow-up 2)
--
-- Migration 0006 broadened the LINE-level matcher to all exception flags,
-- but didn't address a different bug class: credit_requests created AFTER
-- the relevant statement was uploaded never get matched to their CRED row.
--
-- The system already has a forward path:
--   statement upload → for each CRED row, scan open credit_requests by amount
--
-- But not the symmetric reverse path:
--   credit_request created → scan open CRED rows on prior statements
--
-- Without that, if a pharmacist uploads a statement, then later flags lines
-- and generates a credit request, the credit_request is forever stuck in
-- 'sent' status even though its credit row is sitting on the statement
-- waiting to be claimed.
--
-- This migration adds the missing direction and runs a one-shot retroactive
-- sweep over existing 'sent'/'overdue' credit_requests.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Function: try_match_credit_request_to_credit_row
-- ----------------------------------------------------------------------------
-- Given a credit_request that's currently 'sent' or 'overdue' (i.e. open),
-- look for an open CRED statement_line for the same supplier whose |total|
-- matches the credit_request's total_amount within 1p. First match wins.
--
-- On match, atomically:
--   - credit_requests.status → 'resolved'
--   - credit_requests.resolved_at → now()
--   - credit_requests.resolved_via_statement_line_id → matched row id
--   - statement_lines.resolved_credit_request_id → this credit_request id
--
-- Returns the matched statement_line.id, or null if no match found.
-- ----------------------------------------------------------------------------
create or replace function public.try_match_credit_request_to_credit_row(
  p_credit_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pharmacy_id  uuid;
  v_supplier     text;
  v_total_amount numeric(12, 2);
  v_match_id     uuid;
begin
  -- Pull the credit_request's basics, gated on it still being open
  select cr.pharmacy_id, cr.supplier, cr.total_amount
    into v_pharmacy_id, v_supplier, v_total_amount
  from public.credit_requests cr
  where cr.id = p_credit_request_id
    and cr.status in ('sent', 'overdue')
    and cr.resolved_at is null;

  if v_pharmacy_id is null then
    return null;
  end if;

  -- Find first unresolved CRED row whose |total| matches
  select sl.id into v_match_id
  from public.statement_lines sl
  join public.statements s on s.id = sl.statement_id
  where sl.pharmacy_id = v_pharmacy_id
    and s.supplier     = v_supplier
    and s.deleted_at   is null
    and sl.document_type = 'CRED'
    and sl.resolved_credit_request_id is null
    and sl.resolved_invoice_line_id   is null
    and abs(abs(sl.total) - v_total_amount) < 0.01
  order by sl.document_date asc, sl.line_number asc
  limit 1;

  if v_match_id is null then
    return null;
  end if;

  -- Wire up bidirectional link + close the credit_request
  update public.credit_requests
    set status = 'resolved',
        resolved_at = now(),
        resolved_via_statement_line_id = v_match_id,
        updated_at = now()
    where id = p_credit_request_id;

  update public.statement_lines
    set resolved_credit_request_id = p_credit_request_id
    where id = v_match_id;

  return v_match_id;
end;
$$;

grant execute on function public.try_match_credit_request_to_credit_row(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- One-shot retroactive sweep: every open credit_request gets a chance
-- ----------------------------------------------------------------------------
do $$
declare
  v_cr     record;
  v_match  uuid;
  v_total  integer := 0;
begin
  for v_cr in
    select cr.id
      from public.credit_requests cr
      where cr.status in ('sent', 'overdue')
        and cr.resolved_at is null
  loop
    select public.try_match_credit_request_to_credit_row(v_cr.id) into v_match;
    if v_match is not null then
      v_total := v_total + 1;
    end if;
  end loop;
  raise notice 'Retroactive credit_request matching: resolved % credit_request(s)', v_total;
end $$;
