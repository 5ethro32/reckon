-- ============================================================================
-- Reckon — broaden credit matcher to all exception flags (M3 follow-up)
--
-- Original migration 0005 only matched CRED statement rows against lines
-- flagged 'returned'. But every line-level exception expects a credit:
--
--   not_received → supplier didn't ship anything → credit for full line gross
--   short        → supplier shipped fewer units → credit for the missing portion
--   damaged      → goods unusable → credit for full line gross
--   returned     → goods sent back → credit for the returned portion
--
-- This migration replaces the two bidirectional matcher functions with
-- versions that:
--
--   1. Match against ANY of the four exception flags
--   2. Compute the expected credit gross per flag (full or pro-rata)
--   3. Skip lines already linked to a credit_request — once a CR has been
--      emailed, that's the canonical resolution path and the line-level
--      matcher should not double-resolve
--
-- The third matcher (try_match_unmatched_invoice_rows) is unchanged — it
-- handles INV rows, which are unrelated to this change.
--
-- Apply via the Supabase SQL editor for your project.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: expected_credit_gross(line) — single source of truth
-- ----------------------------------------------------------------------------
-- Returns the gross amount the supplier should credit for THIS line's
-- exception flag. Returns 0 if the line has no exception flag we recognise.
--
-- Lookup order matters — a line with multiple flags resolves to the
-- "strongest" credit interpretation. In practice the UI only sets one
-- flag at a time, but the function is defensive.
--
-- Defined as immutable so Postgres can use it in indexes and inline it.
-- ----------------------------------------------------------------------------
create or replace function public.expected_credit_gross(
  p_flags             jsonb,
  p_gross             numeric,
  p_qty_ordered       integer,
  p_qty_received      integer,
  p_qty_returned      integer
)
returns numeric
language plpgsql
immutable
as $$
begin
  if p_flags is null or jsonb_array_length(p_flags) = 0 then
    return 0;
  end if;

  -- not_received: nothing arrived → full credit
  if p_flags ? 'not_received' then
    return p_gross;
  end if;

  -- damaged: arrived but unusable → full credit
  if p_flags ? 'damaged' then
    return p_gross;
  end if;

  -- short: pro-rata for the missing units
  if p_flags ? 'short' then
    if p_qty_ordered is null or p_qty_ordered = 0 then
      return 0;
    end if;
    -- Default qty_received to 0 if null (means user marked short but didn't
    -- specify quantity — treat as nothing received).
    return round(
      p_gross * (p_qty_ordered - coalesce(p_qty_received, 0))::numeric
      / p_qty_ordered::numeric,
      2
    );
  end if;

  -- returned: pro-rata for the returned units (full if qty_returned is null)
  if p_flags ? 'returned' then
    if p_qty_ordered is null or p_qty_ordered = 0 then
      return p_gross;
    end if;
    if p_qty_returned is null or p_qty_returned >= p_qty_ordered then
      return p_gross;
    end if;
    return round(
      p_gross * p_qty_returned::numeric / p_qty_ordered::numeric,
      2
    );
  end if;

  return 0;
end;
$$;

grant execute on function public.expected_credit_gross(jsonb, numeric, integer, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- Replace: try_match_credit_row_to_returned_line
-- ----------------------------------------------------------------------------
-- New version: matches against any line with an exception flag whose
-- expected credit gross matches the CRED row's |total| within 1p.
--
-- Function name kept unchanged to avoid a breaking schema change for
-- callers (the two API routes that invoke it). Despite the name, it
-- now matches any flagged exception line, not just returned ones.
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
  select sl.pharmacy_id, s.supplier, abs(sl.total)
    into v_pharmacy_id, v_supplier, v_total_abs
  from public.statement_lines sl
  join public.statements s on s.id = sl.statement_id
  where sl.id = p_statement_line_id
    and sl.document_type = 'CRED'
    and sl.resolved_invoice_line_id is null
    and sl.resolved_credit_request_id is null;

  if v_pharmacy_id is null then
    return null;
  end if;

  -- Find first open exception line whose expected credit gross matches.
  -- Skip lines already linked to a credit_request (that's the canonical
  -- resolution path; double-resolving would confuse the chase ledger).
  select il.id into v_match_id
  from public.invoice_lines il
  join public.invoices i on i.id = il.invoice_id
  where il.pharmacy_id = v_pharmacy_id
    and i.supplier     = v_supplier
    and i.deleted_at   is null
    and il.credited_via_statement_line_id is null
    and il.credit_request_id is null
    and (
         il.flags ? 'short'
      or il.flags ? 'damaged'
      or il.flags ? 'returned'
      or il.flags ? 'not_received'
    )
    and abs(
      public.expected_credit_gross(
        il.flags, il.gross, il.qty_ordered, il.qty_received, il.qty_returned
      )
      - v_total_abs
    ) < 0.01
  order by i.invoice_date asc, il.line_number asc
  limit 1;

  if v_match_id is null then
    return null;
  end if;

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
-- Replace: try_match_returned_line_to_credit_row
-- ----------------------------------------------------------------------------
-- Symmetric to above. Matches any flagged exception line against open CRED
-- rows on existing statements.
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
  v_pharmacy_id      uuid;
  v_supplier         text;
  v_expected_gross   numeric(12, 2);
  v_match_id         uuid;
begin
  select il.pharmacy_id,
         i.supplier,
         public.expected_credit_gross(
           il.flags, il.gross, il.qty_ordered, il.qty_received, il.qty_returned
         )
    into v_pharmacy_id, v_supplier, v_expected_gross
  from public.invoice_lines il
  join public.invoices i on i.id = il.invoice_id
  where il.id = p_invoice_line_id
    and il.credited_via_statement_line_id is null
    and il.credit_request_id is null
    and (
         il.flags ? 'short'
      or il.flags ? 'damaged'
      or il.flags ? 'returned'
      or il.flags ? 'not_received'
    );

  if v_pharmacy_id is null or v_expected_gross = 0 then
    return null;
  end if;

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
-- One-shot retroactive sweep over existing data
-- ----------------------------------------------------------------------------
-- Now that the matcher accepts any exception flag, walk every existing
-- exception line and try to match it. Idempotent — already-linked lines
-- are skipped by the matcher's WHERE clause.
--
-- Wrapped in a DO block so it runs once at migration time. Subsequent runs
-- of this migration are no-ops because all matchable lines will already be
-- linked.
-- ----------------------------------------------------------------------------
do $$
declare
  v_line   record;
  v_match  uuid;
  v_total  integer := 0;
begin
  for v_line in
    select il.id
      from public.invoice_lines il
      join public.invoices i on i.id = il.invoice_id
     where i.deleted_at is null
       and il.credited_via_statement_line_id is null
       and il.credit_request_id is null
       and (
            il.flags ? 'short'
         or il.flags ? 'damaged'
         or il.flags ? 'returned'
         or il.flags ? 'not_received'
       )
  loop
    select public.try_match_returned_line_to_credit_row(v_line.id) into v_match;
    if v_match is not null then
      v_total := v_total + 1;
    end if;
  end loop;

  raise notice 'Retroactive credit matching: linked % lines', v_total;
end $$;
