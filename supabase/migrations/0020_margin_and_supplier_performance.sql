-- Purchase margin against the Drug Tariff, and supplier performance, from records Reckon already holds.
--
-- 1. dm+d reimbursement prices (Open Government Licence v3.0, NHSBSA dm+d), loaded by scripts/import-dmd.mts:
--    dmd_vmpps: every valid VMPP with its Drug Tariff payment category and price (VMPP DTINFO, pence).
--    dmd_ampps: every valid AMPP with its VMPP and NHS indicative price (AMPP PRICE_INFO, basis 0001).
-- 2. margin_lines(): each invoiced pack compared with its reimbursement price. A line is matched to dm+d
--    only through confirmed links: the GTIN printed on the invoice line, this pharmacy's verified barcode
--    mapping, or packs scanned against the line. Description matching is never used here.
-- 3. margin_by_supplier(), margin_by_product(), supplier_performance(): period aggregates.
--
-- The figure is purchase margin against the Drug Tariff, not profit: it ignores what was dispensed,
-- Category M clawback, discount deductions and fees. Functions run as the caller, so RLS applies.
create table public.dmd_vmpps (
  vmpp_id text primary key check (vmpp_id ~ '^[0-9]{6,18}$'),
  name text not null,
  pack_qty numeric,
  dt_category_code text,          -- PAY_CATCD, e.g. 0001 Category A, 0003 Category C, 0011 Category M
  dt_category text,               -- description from the dm+d lookup file
  dt_price_pence integer check (dt_price_pence is null or dt_price_pence >= 0),
  dt_price_date date,             -- DT: date the current price applies from
  dt_prev_price_pence integer check (dt_prev_price_pence is null or dt_prev_price_pence >= 0)
);
create table public.dmd_ampps (
  ampp_id text primary key check (ampp_id ~ '^[0-9]{6,18}$'),
  vmpp_id text not null check (vmpp_id ~ '^[0-9]{6,18}$'),
  name text not null,
  nhs_price_pence integer check (nhs_price_pence is null or nhs_price_pence >= 0),  -- only for basis 0001
  price_date date,
  prev_price_pence integer check (prev_price_pence is null or prev_price_pence >= 0)
);
create index dmd_ampps_vmpp on public.dmd_ampps(vmpp_id);
alter table public.dmd_releases add column if not exists vmpps integer, add column if not exists ampps integer;
alter table public.dmd_vmpps enable row level security;
alter table public.dmd_ampps enable row level security;
create policy dmd_vmpps_read on public.dmd_vmpps for select to authenticated using (true);
create policy dmd_ampps_read on public.dmd_ampps for select to authenticated using (true);
revoke all on public.dmd_vmpps, public.dmd_ampps from anon;
-- Writes come only from the importer using the service role.
create index if not exists idx_invoices_pharmacy_date on public.invoices(pharmacy_id, invoice_date) where deleted_at is null;

-- Price in force on a date: dm+d carries the current price, its start date and the previous price only.
create function public.dmd_price_on(p_price integer, p_from date, p_prev integer, p_on date)
returns integer language sql immutable set search_path = public as $$
 select case when p_from is not null and p_on < p_from and p_prev is not null then p_prev else p_price end
$$;

create function public.margin_lines(p_from date, p_to date)
returns table (
  line_id uuid, invoice_id uuid, pharmacy_id uuid, supplier text, invoice_number text, invoice_date date,
  description text, pack_size text, qty integer, net numeric, cost_per_pack numeric,
  match_status text, match_source text, vmpp_id text, ampp_id text, product text, dt_category text,
  reimbursement_basis text, reimbursement_per_pack numeric, reimbursement numeric, list_price_per_pack numeric,
  margin_per_pack numeric, margin numeric, margin_pct numeric,
  best_price_per_pack numeric, best_supplier text, leakage numeric
) language sql stable security invoker set search_path = public as $$
 with lines as (
  select l.id, l.invoice_id, l.pharmacy_id, i.supplier, i.invoice_number, i.invoice_date, l.supplier_sku,
   l.description, l.pack_size, l.qty_ordered, l.net, l.gtin
  from public.invoice_lines l join public.invoices i on i.id = l.invoice_id and i.pharmacy_id = l.pharmacy_id
  where i.deleted_at is null and i.invoice_date between p_from and p_to and l.qty_ordered > 0 and l.net >= 0
 ), evidence as (
  -- The GTIN the supplier printed on the invoice line.
  select x.id as line_id, 'invoice'::text as source, p.ampp_id from lines x
  join public.dmd_packs p on p.gtin = x.gtin and (p.gtin_end is null or p.gtin_end >= x.invoice_date)
  union all
  -- This pharmacy's verified mapping for the same supplier product code, description and pack.
  select x.id, 'mapping', coalesce(b.ampp_id, p.ampp_id) from lines x
  join public.product_barcodes b on b.pharmacy_id = x.pharmacy_id and b.supplier = x.supplier and b.supplier_sku = x.supplier_sku
   and b.pack_size is not distinct from x.pack_size
   and lower(regexp_replace(trim(b.description), '\s+', ' ', 'g')) = lower(regexp_replace(trim(x.description), '\s+', ' ', 'g'))
  left join public.dmd_packs p on b.ampp_id is null and p.gtin = b.gtin and (p.gtin_end is null or p.gtin_end >= x.invoice_date)
  union all
  -- Packs scanned and accepted against the line.
  select x.id, 'scan', p.ampp_id from lines x
  join public.receipt_events r on r.invoice_line_id = x.id
  join public.dmd_packs p on p.gtin = r.gtin and (p.gtin_end is null or p.gtin_end >= x.invoice_date)
 ), resolved as (
  select e.line_id, string_agg(distinct e.source, ',' order by e.source) as sources,
   count(distinct a.vmpp_id) as vmpps, min(a.vmpp_id) as vmpp_id,
   count(distinct e.ampp_id) as ampps, min(e.ampp_id) as ampp_id
  from evidence e left join public.dmd_ampps a on a.ampp_id = e.ampp_id
  where e.ampp_id is not null group by e.line_id
 ), priced as (
  select x.*, r.sources,
   case when r.line_id is null then 'unmatched' when r.vmpps = 0 then 'not_in_dmd' when r.vmpps > 1 then 'conflict' else 'matched' end as status,
   case when r.vmpps = 1 then r.vmpp_id end as vmpp,
   case when r.vmpps = 1 and r.ampps = 1 then r.ampp_id end as ampp,
   public.dmd_price_on(v.dt_price_pence, v.dt_price_date, v.dt_prev_price_pence, x.invoice_date) as dt_pence,
   case when r.vmpps = 1 and r.ampps = 1 then public.dmd_price_on(a.nhs_price_pence, a.price_date, a.prev_price_pence, x.invoice_date) end as nhs_pence,
   v.name as vmpp_name, v.dt_category, round(x.net / x.qty_ordered, 4) as cpp
  from lines x left join resolved r on r.line_id = x.id
  left join public.dmd_vmpps v on r.vmpps = 1 and v.vmpp_id = r.vmpp_id
  left join public.dmd_ampps a on r.vmpps = 1 and r.ampps = 1 and a.ampp_id = r.ampp_id
 ), valued as (
  select p.*,
   case when p.status <> 'matched' then null when p.dt_pence is not null then 'drug_tariff' when p.nhs_pence is not null then 'nhs_indicative' else 'no_price' end as basis,
   coalesce(p.dt_pence, p.nhs_pence) / 100.0 as rpp,
   min(p.cpp) over w as best, first_value(p.supplier) over (w order by p.cpp, p.supplier) as best_supplier
  from priced p window w as (partition by p.pharmacy_id, p.vmpp)
 )
 select v.id, v.invoice_id, v.pharmacy_id, v.supplier, v.invoice_number, v.invoice_date, v.description, v.pack_size,
  v.qty_ordered, v.net, v.cpp, v.status, v.sources, v.vmpp, v.ampp, v.vmpp_name, v.dt_category,
  v.basis, case when v.status = 'matched' then round(v.rpp, 4) end,
  case when v.status = 'matched' then round(v.rpp * v.qty_ordered, 2) end,
  -- The brand's NHS indicative price, for context: a branded prescription is reimbursed at list price.
  round(v.nhs_pence / 100.0, 4),
  case when v.status = 'matched' then round(v.rpp - v.cpp, 4) end,
  case when v.status = 'matched' then round(v.rpp * v.qty_ordered - v.net, 2) end,
  case when v.status = 'matched' and v.rpp > 0 then round((v.rpp * v.qty_ordered - v.net) / (v.rpp * v.qty_ordered) * 100, 1) end,
  case when v.vmpp is not null then v.best end,
  case when v.vmpp is not null then v.best_supplier end,
  case when v.vmpp is not null then round((v.cpp - v.best) * v.qty_ordered, 2) end
 from valued v
$$;

create function public.margin_by_supplier(p_from date, p_to date)
returns table (pharmacy_id uuid, supplier text, lines bigint, matched_lines bigint, priced_lines bigint, unmatched_lines bigint,
  spend numeric, priced_spend numeric, reimbursement numeric, margin numeric, margin_pct numeric,
  loss_lines bigint, loss numeric, leakage numeric)
language sql stable security invoker set search_path = public as $$
 select m.pharmacy_id, min(m.supplier), count(*), count(*) filter (where m.match_status = 'matched'),
  count(m.reimbursement), count(*) filter (where m.match_status <> 'matched'),
  sum(m.net), coalesce(sum(m.net) filter (where m.reimbursement is not null), 0), coalesce(sum(m.reimbursement), 0), coalesce(sum(m.margin), 0),
  round(sum(m.margin) / nullif(sum(m.reimbursement) filter (where m.reimbursement > 0), 0) * 100, 1),
  count(*) filter (where m.margin < 0), coalesce(-sum(m.margin) filter (where m.margin < 0), 0), coalesce(sum(m.leakage), 0)
 from public.margin_lines(p_from, p_to) m group by m.pharmacy_id, lower(trim(m.supplier))
$$;

create function public.margin_by_product(p_from date, p_to date)
returns table (pharmacy_id uuid, vmpp_id text, product text, dt_category text, reimbursement_basis text, lines bigint, packs bigint,
  suppliers bigint, spend numeric, reimbursement numeric, margin numeric, margin_pct numeric, loss_lines bigint,
  best_price_per_pack numeric, best_supplier text, reimbursement_per_pack numeric, leakage numeric)
language sql stable security invoker set search_path = public as $$
 select m.pharmacy_id, m.vmpp_id, min(m.product), min(m.dt_category), string_agg(distinct m.reimbursement_basis, ','),
  count(*), sum(m.qty), count(distinct lower(trim(m.supplier))), sum(m.net), sum(m.reimbursement), sum(m.margin),
  round(sum(m.margin) / nullif(sum(m.reimbursement) filter (where m.reimbursement > 0), 0) * 100, 1),
  count(*) filter (where m.margin < 0), min(m.best_price_per_pack), min(m.best_supplier),
  round(sum(m.reimbursement) / nullif(sum(m.qty) filter (where m.reimbursement is not null), 0), 4), coalesce(sum(m.leakage), 0)
 from public.margin_lines(p_from, p_to) m where m.vmpp_id is not null group by m.pharmacy_id, m.vmpp_id
$$;

-- Raw components per supplier; the score itself is computed and explained in the app (app/lib/supplier-score.ts).
create function public.supplier_performance(p_from date, p_to date)
returns table (pharmacy_id uuid, supplier text, invoices bigint, invoices_mismatched bigint, lines bigint, checked_lines bigint,
  packs_ordered bigint, packs_received bigint, short_lines bigint, damaged_lines bigint, returned_lines bigint,
  claims_sent bigint, claims_resolved bigint, claims_due bigint, claims_resolved_14d bigint, claims_open_overdue bigint,
  avg_turnaround_days numeric, statements bigint, statements_with_variance bigint,
  compared_lines bigint, compared_spend numeric, best_price_spend numeric)
language sql stable security invoker set search_path = public as $$
 with inv as (
  select i.pharmacy_id, lower(trim(i.supplier)) as k, min(i.supplier) as name, count(*) as n, count(*) filter (where not i.totals_match) as bad
  from public.invoices i where i.deleted_at is null and i.invoice_date between p_from and p_to group by 1, 2
 ), lin as (
  select i.pharmacy_id, lower(trim(i.supplier)) as k, count(*) as n, count(l.qty_received) as checked,
   coalesce(sum(l.qty_ordered) filter (where l.qty_received is not null), 0) as ordered,
   coalesce(sum(least(greatest(l.qty_received, 0), l.qty_ordered)) filter (where l.qty_received is not null), 0) as received,
   count(*) filter (where l.qty_received < l.qty_ordered or l.flags ? 'short' or l.flags ? 'not_received') as short,
   count(*) filter (where l.flags ? 'damaged') as damaged, count(*) filter (where l.flags ? 'returned') as returned
  from public.invoice_lines l join public.invoices i on i.id = l.invoice_id and i.pharmacy_id = l.pharmacy_id
  where i.deleted_at is null and i.invoice_date between p_from and p_to and l.qty_ordered > 0 group by 1, 2
 ), cr as (
  select c.pharmacy_id, lower(trim(c.supplier)) as k, min(c.supplier) as name, count(*) as sent,
   count(*) filter (where c.status = 'resolved') as resolved,
   count(*) filter (where c.status = 'resolved' or c.sent_at <= now() - interval '14 days') as due,
   count(*) filter (where c.status = 'resolved' and c.resolved_at <= c.sent_at + interval '14 days') as fast,
   count(*) filter (where c.status in ('sent', 'overdue') and (c.status = 'overdue' or c.sent_at <= now() - interval '14 days')) as overdue,
   round(avg(extract(epoch from c.resolved_at - c.sent_at) / 86400) filter (where c.status = 'resolved' and c.resolved_at >= c.sent_at), 1) as turnaround
  from public.credit_requests c
  where c.sent_at is not null and c.status <> 'cancelled' and (c.sent_at at time zone 'Europe/London')::date between p_from and p_to group by 1, 2
 ), st as (
  select s.pharmacy_id, lower(trim(s.supplier)) as k, min(s.supplier) as name, count(*) as n,
   count(*) filter (where not s.totals_match or abs(s.variance) >= 0.01) as bad
  from public.statements s where s.deleted_at is null and s.statement_date between p_from and p_to group by 1, 2
 ), price as (
  select m.pharmacy_id, lower(trim(m.supplier)) as k, count(*) as n, sum(m.net) as spend, round(sum(m.best_price_per_pack * m.qty), 2) as best
  from public.margin_lines(p_from, p_to) m where m.best_price_per_pack is not null group by 1, 2
 ), keys as (
  select u.pharmacy_id, u.k, min(u.name) as name from (
   select pharmacy_id, k, name from inv union all select pharmacy_id, k, name from cr union all select pharmacy_id, k, name from st
  ) u group by 1, 2
 )
 select k.pharmacy_id, k.name, coalesce(inv.n, 0), coalesce(inv.bad, 0), coalesce(lin.n, 0), coalesce(lin.checked, 0),
  coalesce(lin.ordered, 0), coalesce(lin.received, 0), coalesce(lin.short, 0), coalesce(lin.damaged, 0), coalesce(lin.returned, 0),
  coalesce(cr.sent, 0), coalesce(cr.resolved, 0), coalesce(cr.due, 0), coalesce(cr.fast, 0), coalesce(cr.overdue, 0), cr.turnaround,
  coalesce(st.n, 0), coalesce(st.bad, 0), coalesce(price.n, 0), coalesce(price.spend, 0), coalesce(price.best, 0)
 from keys k
 left join inv on inv.pharmacy_id = k.pharmacy_id and inv.k = k.k
 left join lin on lin.pharmacy_id = k.pharmacy_id and lin.k = k.k
 left join cr on cr.pharmacy_id = k.pharmacy_id and cr.k = k.k
 left join st on st.pharmacy_id = k.pharmacy_id and st.k = k.k
 left join price on price.pharmacy_id = k.pharmacy_id and price.k = k.k
$$;

revoke all on function public.dmd_price_on(integer, date, integer, date), public.margin_lines(date, date),
 public.margin_by_supplier(date, date), public.margin_by_product(date, date), public.supplier_performance(date, date) from public, anon;
grant execute on function public.dmd_price_on(integer, date, integer, date), public.margin_lines(date, date),
 public.margin_by_supplier(date, date), public.margin_by_product(date, date), public.supplier_performance(date, date) to authenticated;
