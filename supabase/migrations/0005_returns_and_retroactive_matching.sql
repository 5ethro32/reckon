-- ============================================================================
-- Reckon — returned lines + retroactive credit matching (M3)
--
-- Problem we're solving:
--   1. Pharmacist marks a delivered line as "returned" — supplier will issue
--      a credit. Today the only return-adjacent state is `damage_disposition
--      = 'returning'`, but returns happen for plenty of non-damage reasons
--      (wrong product, expired-on-arrival, over-ordered, etc).
--   2. When the next supplier statement arrives with a CRED row for that
--      return, we want to deterministically resolve the credit against the
--      original invoice line — not just amount-match against credit_requests.
--   3. Statements uploaded BEFORE the matching invoice exists currently
--      stay forever as `unmatched`. We want matching to be retroactive —
--      any time a new invoice or returned-line lands, the matcher re-runs
--      over open statement_lines for that supplier.
--
-- Apply via the Supabase SQL editor for your project.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- invoice_lines: qty_returned + return_disposition
-- ----------------------------------------------------------------------------
-- qty_returned mirrors qty_received in shape. Always non-negative; <= qty_ordered.
-- Meaningful only when `flags` contains 'returned'.
alter table public.invoice_lines
  add column if not exists qty_returned integer,
  add column if not exists return_disposition text
    check (
      return_disposition is null
      or return_disposition in (
        'damaged',           -- returned because damaged
        'wrong_product',     -- supplier picked the wrong SKU
        'expired',           -- short-dated or expired on arrival
        'over_ordered',      -- pharmacy doesn't need it
        'other'              -- catch-all; require notes when set
      )
    );

-- ----------------------------------------------------------------------------
-- statement_lines: link a CRED row directly to the invoice_line it credits
-- ----------------------------------------------------------------------------
-- This is the new strong link from a credit row on a statement back to the
-- specific returned line it resolves. `resolved_credit_request_id` (existing,
-- from migration 0002) covers the credit-request case; this new column covers
-- the line-level returned case. They are independent — a CRED row may resolve
-- a credit_request, an invoice_line, or both.
alter table public.statement_lines
  add column if not exists resolved_invoice_line_id uuid
    references public.invoice_lines(id) on delete set null;

create index if not exists idx_statement_lines_resolved_invoice_line
  on public.statement_lines(resolved_invoice_line_id)
  where resolved_invoice_line_id is not null;

-- ----------------------------------------------------------------------------
-- invoice_lines: track when a returned line has been confirmed credited
-- ----------------------------------------------------------------------------
-- Convenience reverse pointer — lets us answer "has this returned line been
-- credited yet?" without a join through statement_lines. Maintained by the
-- matcher functions below.
alter table public.invoice_lines
  add column if not exists credited_via_statement_line_id uuid
    references public.statement_lines(id) on delete set null;

create index if not exists idx_invoice_lines_credited_via
  on public.invoice_lines(credited_via_statement_line_id)
  where credited_via_statement_line_id is not null;

-- ----------------------------------------------------------------------------
-- Helper: gross value the supplier should credit for a given line
-- ----------------------------------------------------------------------------
-- For a fully-returned line: full gross.
-- For a partially-returned line (qty_returned < qty_ordered): proportional.
-- For a not-returned line: 0.
-- Inlined formula avoids needing a function call from the matcher.

-- ----------------------------------------------------------------------------
-- Function: try_match_credit_row_to_returned_line(p_statement_line_id)
-- ----------------------------------------------------------------------------
-- Given a CRED-typed statement_line that doesn't yet have a resolved_*
-- pointer, try to find an open returned invoice_line whose expected credit
-- gross matches the row's |total| within 1p. First match wins.
-- Returns the matched invoice_line.id or null.
--
-- This is the core matcher. It's called from several places:
--   - statement upload, after inserting CRED rows
--   - invoice-line PATCH that sets the `returned` flag (retroactive sweep
--     over open CRED rows for this supplier)
--   - new-invoice upload (less common, but if a statement was uploaded first
--     and the invoice contains a returned line on day-1, we want a match)
-- ----------------------------------------------------------------------------
create or replace function public.try_match_credit_row_to_returned_line(
  p_statement_line_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pharmacy_id      uuid;
  v_supplier         text;
  v_total_abs        numeric(12, 2);
  v_match_id         uuid;
begin
  -- Pull the cred row's basics
  select sl.pharmacy_id, s.supplier, abs(sl.total)
    into v_pharmacy_id, v_supplier, v_total_abs
  from public.statement_lines sl
  join public.statements s on s.id = sl.statement_id
  where sl.id = p_statement_line_id
    and sl.document_type = 'CRED'
    and sl.resolved_invoice_line_id is null
    and sl.resolved_credit_request_id is null;

  -- Not found, not a CRED, or already resolved — nothing to do
  if v_pharmacy_id is null then
    return null;
  end if;

  -- Find the first open returned line with matching expected credit
  --   - same pharmacy + supplier
  --   - flags contains 'returned'
  --   - not yet credited
  --   - expected credit gross matches |row.total|
  -- Expected credit gross =
  --   full line gross * (qty_returned / qty_ordered) when partial
  --   line gross when qty_returned IS NULL or = qty_ordered (full return)
  select il.id into v_match_id
  from public.invoice_lines il
  join public.invoices i on i.id = il.invoice_id
  where il.pharmacy_id = v_pharmacy_id
    and i.supplier     = v_supplier
    and i.deleted_at   is null
    and il.credited_via_statement_line_id is null
    and (il.flags ? 'returned')
    and abs(
      case
        when il.qty_returned is null or il.qty_ordered = 0 then il.gross
        when il.qty_returned >= il.qty_ordered            then il.gross
        else round(il.gross * il.qty_returned::numeric / il.qty_ordered::numeric, 2)
      end
      - v_total_abs
    ) < 0.01
  order by i.invoice_date asc, il.line_number asc
  limit 1;

  if v_match_id is null then
    return null;
  end if;

  -- Wire up the bidirectional link
  update public.invoice_lines
    set credited_via_statement_line_id = p_statement_line_id,
        updated_at = now()
    where id = v_match_id;

  update public.statement_lines
    set resolved_invoice_line_id = v_match_id
    where id = p_statement_line_id;

  return v_match_id;
end;
$$;

grant execute on function public.try_match_credit_row_to_returned_line(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Function: try_match_returned_line_to_credit_row(p_invoice_line_id)
-- ----------------------------------------------------------------------------
-- Inverse of above: given a returned invoice_line that doesn't yet have a
-- credited_via_statement_line_id, find an open CRED statement_line for the
-- same supplier whose |total| matches the expected credit. First match wins.
-- ----------------------------------------------------------------------------
create or replace function public.try_match_returned_line_to_credit_row(
  p_invoice_line_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pharmacy_id   uuid;
  v_supplier      text;
  v_expected_gross numeric(12, 2);
  v_match_id      uuid;
begin
  -- Pull the line's basics + compute expected credit gross
  select il.pharmacy_id,
         i.supplier,
         case
           when il.qty_returned is null or il.qty_ordered = 0 then il.gross
           when il.qty_returned >= il.qty_ordered            then il.gross
           else round(il.gross * il.qty_returned::numeric / il.qty_ordered::numeric, 2)
         end
    into v_pharmacy_id, v_supplier, v_expected_gross
  from public.invoice_lines il
  join public.invoices i on i.id = il.invoice_id
  where il.id = p_invoice_line_id
    and il.credited_via_statement_line_id is null
    and (il.flags ? 'returned');

  if v_pharmacy_id is null then
    return null;
  end if;

  -- Find first open CRED row whose |total| matches
  select sl.id into v_match_id
  from public.statement_lines sl
  join public.statements s on s.id = sl.statement_id
  where sl.pharmacy_id = v_pharmacy_id
    and s.supplier     = v_supplier
    and s.deleted_at   is null
    and sl.document_type = 'CRED'
    and sl.resolved_invoice_line_id   is null
    and sl.resolved_credit_request_id is null
    and abs(abs(sl.total) - v_expected_gross) < 0.01
  order by sl.document_date asc, sl.line_number asc
  limit 1;

  if v_match_id is null then
    return null;
  end if;

  update public.invoice_lines
    set credited_via_statement_line_id = v_match_id,
        updated_at = now()
    where id = p_invoice_line_id;

  update public.statement_lines
    set resolved_invoice_line_id = p_invoice_line_id
    where id = v_match_id;

  return v_match_id;
end;
$$;

grant execute on function public.try_match_returned_line_to_credit_row(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Function: try_match_unmatched_invoice_rows(p_pharmacy_id, p_supplier, p_invoice_number)
-- ----------------------------------------------------------------------------
-- Retroactive INV-row matching. When a new invoice arrives, sweep over all
-- statement_lines (across all statements) for that pharmacy+supplier where
-- match_status='unmatched' AND document_number = the new invoice number.
-- Set them to matched.
--
-- Updates the statement's reconciled_count / unreconciled_count rollups.
-- Returns the count of newly-matched rows.
-- ----------------------------------------------------------------------------
create or replace function public.try_match_unmatched_invoice_rows(
  p_pharmacy_id    uuid,
  p_supplier       text,
  p_invoice_number text,
  p_invoice_id     uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with updated as (
    update public.statement_lines sl
      set matched_invoice_id = p_invoice_id,
          match_status       = 'matched',
          match_confidence   = 1.0
      from public.statements s
      where sl.statement_id        = s.id
        and sl.pharmacy_id         = p_pharmacy_id
        and s.supplier             = p_supplier
        and s.deleted_at           is null
        and sl.document_type       = 'INV'
        and sl.match_status        = 'unmatched'
        and sl.document_number     = p_invoice_number
      returning sl.statement_id
  )
  select count(*) into v_count from updated;

  -- Refresh rollup counts on every affected statement
  if v_count > 0 then
    update public.statements s
      set reconciled_count   = (select count(*) from public.statement_lines where statement_id = s.id and match_status = 'matched'),
          unreconciled_count = (select count(*) from public.statement_lines where statement_id = s.id and match_status = 'unmatched' and document_type = 'INV')
      where s.id in (
        select distinct statement_id
        from public.statement_lines
        where document_number = p_invoice_number
          and pharmacy_id = p_pharmacy_id
      );
  end if;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.try_match_unmatched_invoice_rows(uuid, text, text, uuid) to authenticated;
