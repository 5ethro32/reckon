-- ============================================================================
-- Reckon — faster signed-in pages
--
-- 1. RLS policies evaluate membership once per query, not once per row.
--    Every policy called user_belongs_to_pharmacy(pharmacy_id): a SECURITY
--    DEFINER function cannot be inlined, so Postgres ran its EXISTS lookup
--    for every row scanned. `pharmacy_id in (select user_pharmacy_ids())`
--    is planned as a hashed subplan that runs once. Same rows are visible.
-- 2. Receipt counts are computed in the database. The dashboard, the
--    supplier CSV and the invoices list used to download every invoice and
--    every invoice line to count them in the app.
-- 3. Indexes for those queries and for unindexed foreign keys.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Membership helper used by the policies
-- ----------------------------------------------------------------------------
create or replace function public.user_pharmacy_ids()
returns setof uuid
language sql
stable
security definer
rows 5
set search_path = public
as $$
  select pharmacy_id from public.pharmacy_memberships where user_id = (select auth.uid());
$$;
-- anon keeps execute, as it has on user_belongs_to_pharmacy: policies must
-- evaluate to "no rows" without a session (the public /api/health probe
-- reads pharmacies as anon), not raise a permission error. Without a
-- session auth.uid() is null and the function returns nothing.
revoke all on function public.user_pharmacy_ids() from public;
grant execute on function public.user_pharmacy_ids() to anon, authenticated;

-- (user_id, pharmacy_id) answers the helper from the index alone. It makes
-- the old single-column user_id index redundant.
create index if not exists idx_memberships_user_pharmacy on public.pharmacy_memberships(user_id, pharmacy_id);
drop index if exists public.idx_memberships_user;

-- ----------------------------------------------------------------------------
-- Policies: same names, same rules, membership checked once per statement
-- ----------------------------------------------------------------------------
drop policy if exists pharmacies_read on public.pharmacies;
create policy pharmacies_read on public.pharmacies
  for select using (id in (select public.user_pharmacy_ids()));

drop policy if exists pharmacies_update on public.pharmacies;
create policy pharmacies_update on public.pharmacies
  for update using (id in (select public.user_pharmacy_ids()));

drop policy if exists memberships_self on public.pharmacy_memberships;
create policy memberships_self on public.pharmacy_memberships
  for select using (user_id = (select auth.uid()));

drop policy if exists invoices_all on public.invoices;
create policy invoices_all on public.invoices
  for all using (pharmacy_id in (select public.user_pharmacy_ids()))
  with check (pharmacy_id in (select public.user_pharmacy_ids()));

drop policy if exists invoice_lines_all on public.invoice_lines;
create policy invoice_lines_all on public.invoice_lines
  for all using (pharmacy_id in (select public.user_pharmacy_ids()))
  with check (pharmacy_id in (select public.user_pharmacy_ids()));

drop policy if exists statements_all on public.statements;
create policy statements_all on public.statements
  for all using (pharmacy_id in (select public.user_pharmacy_ids()))
  with check (pharmacy_id in (select public.user_pharmacy_ids()));

drop policy if exists statement_lines_all on public.statement_lines;
create policy statement_lines_all on public.statement_lines
  for all using (pharmacy_id in (select public.user_pharmacy_ids()))
  with check (pharmacy_id in (select public.user_pharmacy_ids()));

drop policy if exists supplier_contacts_all on public.supplier_contacts;
create policy supplier_contacts_all on public.supplier_contacts
  for all using (pharmacy_id in (select public.user_pharmacy_ids()))
  with check (pharmacy_id in (select public.user_pharmacy_ids()));

drop policy if exists credit_requests_all on public.credit_requests;
create policy credit_requests_all on public.credit_requests
  for all using (pharmacy_id in (select public.user_pharmacy_ids()))
  with check (pharmacy_id in (select public.user_pharmacy_ids()));

drop policy if exists barcode_read on public.product_barcodes;
create policy barcode_read on public.product_barcodes for select to authenticated
  using (pharmacy_id in (select public.user_pharmacy_ids()));

drop policy if exists receipt_read on public.receipt_events;
create policy receipt_read on public.receipt_events for select to authenticated
  using (pharmacy_id in (select public.user_pharmacy_ids()));

drop policy if exists uninvoiced_read on public.uninvoiced_receipts;
create policy uninvoiced_read on public.uninvoiced_receipts for select to authenticated
  using (pharmacy_id in (select public.user_pharmacy_ids()));

drop policy if exists uninvoiced_create on public.uninvoiced_receipts;
create policy uninvoiced_create on public.uninvoiced_receipts for insert to authenticated
  with check (pharmacy_id in (select public.user_pharmacy_ids()) and recorded_by = (select auth.uid())
  and invoice_id is null and linked_at is null and linked_by is null);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
-- Invoices list, newest invoice date first. Not led by pharmacy_id: the RLS
-- filter is a hashed membership check, so only an index in list order lets
-- ORDER BY ... LIMIT read one page and count lines for those invoices only.
create index if not exists idx_invoices_live_date on public.invoices(invoice_date desc, id) where deleted_at is null;
-- Credits page: flagged lines not yet on a claim.
create index if not exists idx_invoice_lines_unclaimed_flagged on public.invoice_lines(pharmacy_id)
  where credit_request_id is null and flags <> '[]'::jsonb;
-- Open and aged claims.
create index if not exists idx_credit_requests_open on public.credit_requests(pharmacy_id, status, sent_at);
-- Foreign keys without an index (deletes and joins scan the whole table otherwise).
create index if not exists idx_credit_requests_resolved_via on public.credit_requests(resolved_via_statement_line_id)
  where resolved_via_statement_line_id is not null;
create index if not exists idx_receipt_events_pharmacy on public.receipt_events(pharmacy_id);
create index if not exists idx_uninvoiced_receipts_pharmacy on public.uninvoiced_receipts(pharmacy_id, received_at desc);
create index if not exists idx_uninvoiced_receipts_invoice on public.uninvoiced_receipts(invoice_id) where invoice_id is not null;

-- ----------------------------------------------------------------------------
-- invoice_receipt_summary: one row per live invoice with its line counts
-- ----------------------------------------------------------------------------
-- security_invoker: the caller's RLS applies to invoices and invoice_lines.
-- The counts mirror app/lib/operations-summary.ts lineState():
--   pending  qty_received is null
--   full     received equals ordered and no flags
--   issue    flagged, or received differs from ordered
-- The lateral subquery lets ORDER BY ... LIMIT stop after one page of
-- invoices instead of counting every line first.
create or replace view public.invoice_receipt_summary with (security_invoker = true) as
select
  i.id, i.pharmacy_id, i.supplier, i.invoice_number, i.invoice_date, i.gross_total, i.created_at,
  c.line_count, c.full_count, c.pending_count, c.issue_count,
  case when c.line_count = 0 then 0 when c.full_count < c.line_count then 1 else 2 end as status_rank,
  -- What the invoices search box matches: supplier, number, dd/mm/yyyy date and amount.
  lower(i.supplier || chr(31) || i.invoice_number || chr(31) || to_char(i.invoice_date, 'DD/MM/YYYY') || chr(31) || trim_scale(i.gross_total)::text) as search_text
from public.invoices i
cross join lateral (
  select
    count(l.id)::int as line_count,
    count(l.id) filter (where l.qty_received is not null and l.qty_received = l.qty_ordered and not f.flagged)::int as full_count,
    count(l.id) filter (where l.qty_received is null)::int as pending_count,
    count(l.id) filter (where f.flagged or (l.qty_received is not null and l.qty_received <> l.qty_ordered))::int as issue_count
  from public.invoice_lines l
  cross join lateral (select jsonb_typeof(l.flags) = 'array' and jsonb_array_length(l.flags) > 0 as flagged) f
  where l.invoice_id = i.id
) c
where i.deleted_at is null;

revoke all on public.invoice_receipt_summary from public, anon;
grant select on public.invoice_receipt_summary to authenticated;

-- Suppliers with live invoices, for the invoices list filter and total.
create or replace view public.invoice_supplier_counts with (security_invoker = true) as
select supplier, count(*)::int as invoice_count
from public.invoices
where deleted_at is null
group by supplier;

revoke all on public.invoice_supplier_counts from public, anon;
grant select on public.invoice_supplier_counts to authenticated;

-- ----------------------------------------------------------------------------
-- dashboard_summary(): everything the overview and supplier CSV show
-- ----------------------------------------------------------------------------
-- One call replaces paging through every invoice, line and open claim.
-- SECURITY INVOKER, so RLS limits it to the caller's pharmacies.
create or replace function public.dashboard_summary(p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view your pharmacy records.';
  end if;

  with r as (
    select * from public.invoice_receipt_summary
  ),
  claims as (
    select id, pharmacy_id, supplier, status, total_amount, sent_at
    from public.credit_requests
    where status in ('draft', 'sent', 'overdue')
  ),
  aged as (
    select * from claims
    where status = 'overdue' or (status = 'sent' and sent_at is not null and sent_at <= p_now - interval '336 hours')
  ),
  unfinished as (
    select * from r where line_count = 0 or pending_count > 0
  ),
  per_supplier as (
    select pharmacy_id, supplier,
           sum(invoices)::int as invoices, sum(invoice_gross) as invoice_gross,
           sum(pending)::int as pending, sum(exceptions)::int as exceptions,
           sum(open_claims)::int as open_claims, sum(claim_total) as claim_total
    from (
      select pharmacy_id, supplier, count(*) as invoices, sum(gross_total) as invoice_gross,
             sum(pending_count) as pending, sum(issue_count) as exceptions,
             0 as open_claims, 0::numeric as claim_total
      from r group by pharmacy_id, supplier
      union all
      select pharmacy_id, supplier, 0, 0, 0, 0, count(*), sum(total_amount)
      from claims group by pharmacy_id, supplier
    ) u
    group by pharmacy_id, supplier
  )
  select jsonb_build_object(
    'receipt_count', (select count(*) from r),
    'unfinished_count', (select count(*) from unfinished),
    'unfinished', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb) from (
      select id, supplier, invoice_number, invoice_date, gross_total, created_at, line_count as lines, pending_count as pending
      from unfinished order by created_at, id limit 8) x),
    'issue_count', (select count(*) from r where issue_count > 0),
    'open_count', (select count(*) from claims),
    'open_total', (select coalesce(sum(total_amount), 0) from claims),
    'aged_count', (select count(*) from aged),
    'aged', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sent_at nulls first, x.id), '[]'::jsonb) from (
      select id, supplier, total_amount, sent_at from aged order by sent_at nulls first, id limit 6) x),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object(
        'pharmacy', pharmacy_id, 'supplier', supplier, 'invoices', invoices, 'invoiceGross', invoice_gross,
        'pending', pending, 'exceptions', exceptions, 'openClaims', open_claims, 'claimTotal', claim_total
      ) order by pharmacy_id, supplier), '[]'::jsonb) from per_supplier)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.dashboard_summary(timestamptz) from public, anon;
grant execute on function public.dashboard_summary(timestamptz) to authenticated;

-- Make PostgREST pick up the new views and function straight away.
notify pgrst, 'reload schema';
