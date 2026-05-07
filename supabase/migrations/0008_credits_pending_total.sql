-- ============================================================================
-- Reckon — denormalised credits_pending_total on statements (M3 polish)
--
-- The /statements list page was doing a 4-level join (statements →
-- statement_lines → invoices → invoice_lines) to compute the per-statement
-- "credits pending" number. For a pharmacy with several months of history
-- that's thousands of rows fetched just to compute one summary number per
-- row. Page click felt slow.
--
-- Fix: store the rollup as a column on `statements`, maintain it via
-- triggers on the source-of-truth tables (invoice_lines flag changes,
-- credit_requests status changes). List page becomes a single-row read.
--
-- The recompute function lives at the database level so any write path
-- (UI, CLI, future jobs, manual SQL) gets the correct result without
-- application code having to remember to update the cache.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Column: statements.credits_pending_total
-- ----------------------------------------------------------------------------
alter table public.statements
  add column if not exists credits_pending_total numeric(12, 2) not null default 0;

-- ----------------------------------------------------------------------------
-- recompute_statement_credits_pending(p_statement_id)
-- ----------------------------------------------------------------------------
-- Computes the sum of expected-credit gross over invoice_lines whose:
--   - parent invoice is matched by this statement (any matched_invoice_id row)
--   - the line itself has an exception flag (short/damaged/not_received/returned)
--   - the line has NOT been credited via this or any other statement
--   - the line is NOT linked to a credit_request that has been resolved
--
-- Mirrors the in-memory pendingCreditFor() helper in statements/[id]/page.tsx
-- so the list and detail views agree.
-- ----------------------------------------------------------------------------
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
    select il.gross
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

-- ----------------------------------------------------------------------------
-- Trigger: when an invoice_line's flags / credit links change,
-- recompute every statement that references its parent invoice.
-- ----------------------------------------------------------------------------
create or replace function public.tg_recompute_statements_for_invoice_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_stmt_id uuid;
begin
  -- For UPDATE, both OLD and NEW have invoice_id; they're the same in practice.
  -- For INSERT, NEW.invoice_id is what we care about.
  -- For DELETE, OLD.invoice_id.
  if TG_OP = 'DELETE' then
    v_invoice_id := OLD.invoice_id;
  else
    v_invoice_id := NEW.invoice_id;
  end if;

  -- Find every statement whose statement_lines reference this invoice and
  -- recompute. For most operations there's at most one such statement (a
  -- given invoice usually appears on a single supplier statement).
  for v_stmt_id in
    select distinct sl.statement_id
      from public.statement_lines sl
     where sl.matched_invoice_id = v_invoice_id
  loop
    perform public.recompute_statement_credits_pending(v_stmt_id);
  end loop;

  return null;
end;
$$;

drop trigger if exists invoice_line_flag_change on public.invoice_lines;
create trigger invoice_line_flag_change
  after insert or update of flags, qty_received, qty_returned, credited_via_statement_line_id, credit_request_id, gross
  or delete
  on public.invoice_lines
  for each row
  execute function public.tg_recompute_statements_for_invoice_line();

-- ----------------------------------------------------------------------------
-- Trigger: when a credit_request changes status (e.g. resolved),
-- recompute every statement that has a CRED row pointing at it.
-- ----------------------------------------------------------------------------
create or replace function public.tg_recompute_statements_for_credit_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cr_id uuid;
  v_stmt_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_cr_id := OLD.id;
  else
    v_cr_id := NEW.id;
  end if;

  -- Find every statement that has a CRED row resolved to this credit_request
  for v_stmt_id in
    select distinct sl.statement_id
      from public.statement_lines sl
     where sl.resolved_credit_request_id = v_cr_id
  loop
    perform public.recompute_statement_credits_pending(v_stmt_id);
  end loop;

  -- Also: if status just transitioned, the lines linked to this CR might
  -- not be on this CR's statement. So sweep statements that match this CR's
  -- linked invoices too.
  if TG_OP <> 'DELETE' then
    for v_stmt_id in
      select distinct sl.statement_id
        from public.statement_lines sl
        join public.invoice_lines il on il.invoice_id = sl.matched_invoice_id
       where il.credit_request_id = NEW.id
    loop
      perform public.recompute_statement_credits_pending(v_stmt_id);
    end loop;
  end if;

  return null;
end;
$$;

drop trigger if exists credit_request_status_change on public.credit_requests;
create trigger credit_request_status_change
  after insert or update of status, resolved_at, resolved_via_statement_line_id
  or delete
  on public.credit_requests
  for each row
  execute function public.tg_recompute_statements_for_credit_request();

-- ----------------------------------------------------------------------------
-- Trigger: when a statement_line gets a CRED row resolved (or unresolved),
-- recompute its parent statement.
-- ----------------------------------------------------------------------------
create or replace function public.tg_recompute_statement_self()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stmt_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_stmt_id := OLD.statement_id;
  else
    v_stmt_id := NEW.statement_id;
  end if;

  perform public.recompute_statement_credits_pending(v_stmt_id);
  return null;
end;
$$;

drop trigger if exists statement_line_resolution_change on public.statement_lines;
create trigger statement_line_resolution_change
  after insert or update of resolved_credit_request_id, resolved_invoice_line_id, matched_invoice_id, match_status
  or delete
  on public.statement_lines
  for each row
  execute function public.tg_recompute_statement_self();

-- ----------------------------------------------------------------------------
-- Backfill — recompute every existing statement once
-- ----------------------------------------------------------------------------
do $$
declare
  v_stmt record;
  v_count integer := 0;
begin
  for v_stmt in
    select id from public.statements where deleted_at is null
  loop
    perform public.recompute_statement_credits_pending(v_stmt.id);
    v_count := v_count + 1;
  end loop;
  raise notice 'Backfilled credits_pending_total for % statements', v_count;
end $$;
