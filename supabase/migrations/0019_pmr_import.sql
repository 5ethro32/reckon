-- Dispensing system (PMR) data: Positive Solutions Pharmacy Manager report exports.
-- Product-level figures only. Prescription references and anything identifying a patient are
-- dropped by the parser and have no column here. Rows are written only by pmr_record_import,
-- which checks pharmacy membership; members can read their own pharmacy's rows.

create table public.pmr_imports (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  source_system text not null check (source_system in ('psl')),
  report text not null check (report in ('product_usage', 'stock_value', 'items_processed')),
  file_name text not null check (length(file_name) between 1 and 255),
  period_start date,
  period_end date,
  snapshot_date date,
  sites text[] not null default '{}',
  row_count integer not null default 0 check (row_count >= 0),
  -- Distinct products identified in dm+d, and those left unmatched.
  matched_count integer not null default 0 check (matched_count >= 0),
  unmatched_count integer not null default 0 check (unmatched_count >= 0),
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (period_start is null or period_end is null or period_start <= period_end)
);

-- Packs dispensed per product, month and site (PSL "Spoke"; '' for a single-site export).
-- product_key is the dm+d VMPP name when matched, otherwise the PMR description without its
-- manufacturer and pack split, so manufacturer variants of one pack collapse together.
create table public.pmr_dispensing (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  import_id uuid not null references public.pmr_imports(id) on delete cascade,
  site text not null default '' check (length(site) <= 200),
  month date not null check (extract(day from month) = 1),
  description text not null check (length(description) between 1 and 500),
  product_key text not null check (length(product_key) between 1 and 500),
  pack_size numeric check (pack_size > 0),
  pip text check (pip ~ '^[0-9]{7}$'),
  dmd_source text check (dmd_source in ('ampp', 'vmpp')),
  dmd_ampp_id text check (dmd_ampp_id ~ '^[0-9]{6,18}$'),
  dmd_name text,
  packs numeric not null,
  units numeric,
  value numeric(14, 2),
  unique (pharmacy_id, site, month, description)
);

-- Stock by location when a Stock Value report was run. quantity is packs; rows under an
-- "On Order" location are on order, not on hand.
create table public.pmr_stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  import_id uuid not null references public.pmr_imports(id) on delete cascade,
  snapshot_date date not null,
  location text not null check (length(location) between 1 and 200),
  description text not null check (length(description) between 1 and 500),
  product_key text not null check (length(product_key) between 1 and 500),
  pack_size numeric check (pack_size > 0),
  pip text check (pip ~ '^[0-9]{7}$'),
  dmd_source text check (dmd_source in ('ampp', 'vmpp')),
  dmd_ampp_id text check (dmd_ampp_id ~ '^[0-9]{6,18}$'),
  dmd_name text,
  quantity numeric not null,
  tariff numeric(12, 4),
  value numeric(14, 2),
  status text not null default '' check (length(status) <= 100)
);

-- PIP code per PMR description, from Items Processed. Phoenix prints the PIP as its product code.
create table public.pmr_pip_codes (
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  description text not null check (length(description) between 1 and 500),
  pip text not null check (pip ~ '^[0-9]{7}$'),
  import_id uuid references public.pmr_imports(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (pharmacy_id, description)
);

create index idx_pmr_imports_pharmacy on public.pmr_imports(pharmacy_id, report, created_at desc);
create index idx_pmr_dispensing_month on public.pmr_dispensing(pharmacy_id, month);
create index idx_pmr_dispensing_product on public.pmr_dispensing(pharmacy_id, product_key);
create index idx_pmr_dispensing_import on public.pmr_dispensing(import_id);
create index idx_pmr_stock_date on public.pmr_stock_snapshots(pharmacy_id, snapshot_date desc);
create index idx_pmr_stock_import on public.pmr_stock_snapshots(import_id);
create index idx_pmr_pip_codes_pip on public.pmr_pip_codes(pharmacy_id, pip);
-- PMR descriptions are dm+d names; look them up without regard to case.
create index if not exists idx_dmd_packs_name_lower on public.dmd_packs(lower(name));
create index if not exists idx_dmd_packs_generic_lower on public.dmd_packs(lower(generic_name));

alter table public.pmr_imports enable row level security;
alter table public.pmr_dispensing enable row level security;
alter table public.pmr_stock_snapshots enable row level security;
alter table public.pmr_pip_codes enable row level security;
create policy pmr_imports_read on public.pmr_imports for select to authenticated
  using (public.user_belongs_to_pharmacy(pharmacy_id));
create policy pmr_dispensing_read on public.pmr_dispensing for select to authenticated
  using (public.user_belongs_to_pharmacy(pharmacy_id));
create policy pmr_stock_read on public.pmr_stock_snapshots for select to authenticated
  using (public.user_belongs_to_pharmacy(pharmacy_id));
create policy pmr_pip_codes_read on public.pmr_pip_codes for select to authenticated
  using (public.user_belongs_to_pharmacy(pharmacy_id));
revoke all on public.pmr_imports, public.pmr_dispensing, public.pmr_stock_snapshots, public.pmr_pip_codes from anon;

-- dm+d rows whose AMPP or VMPP name equals one of the given names, ignoring case.
create function public.pmr_dmd_lookup(p_names text[])
returns table (lookup text, ampp_id text, name text, generic_name text, pack_qty numeric)
language sql stable security invoker set search_path = public as $$
  with l as (select distinct lower(n) n from unnest(p_names[1:1000]) n where n is not null)
  select l.n, d.ampp_id, d.name, d.generic_name, d.pack_qty from l join public.dmd_packs d on lower(d.name) = l.n
  union
  select l.n, d.ampp_id, d.name, d.generic_name, d.pack_qty from l join public.dmd_packs d on lower(d.generic_name) = l.n
$$;
revoke all on function public.pmr_dmd_lookup(text[]) from public, anon;
grant execute on function public.pmr_dmd_lookup(text[]) to authenticated;

-- Records one parsed export in a single transaction. A newer Product Usage import replaces the
-- months and sites it covers; a Stock Value import replaces any snapshot of the same date;
-- Items Processed updates PIP codes and fills them in on stored rows.
create function public.pmr_record_import(p_pharmacy_id uuid, p_import jsonb, p_rows jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_report text := p_import->>'report';
  v_snapshot date;
begin
  if auth.uid() is null or p_pharmacy_id is null or not public.user_belongs_to_pharmacy(p_pharmacy_id) then
    raise exception 'Pharmacy is not available';
  end if;
  if coalesce(p_import->>'source_system', '') <> 'psl' then raise exception 'Unsupported source system'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Rows must be a list'; end if;
  if jsonb_array_length(p_rows) > 50000 then raise exception 'Too many rows in one import'; end if;
  v_snapshot := case when v_report = 'stock_value' then coalesce((p_import->>'snapshot_date')::date, current_date) end;

  insert into public.pmr_imports (pharmacy_id, source_system, report, file_name, period_start, period_end, snapshot_date,
    sites, row_count, matched_count, unmatched_count, uploaded_by)
  values (p_pharmacy_id, 'psl', v_report, left(coalesce(nullif(trim(p_import->>'file_name'), ''), 'export.xlsx'), 255),
    (p_import->>'period_start')::date, (p_import->>'period_end')::date, v_snapshot,
    coalesce(array(select left(s, 200) from jsonb_array_elements_text(coalesce(p_import->'sites', '[]'::jsonb)) s limit 100), '{}'),
    jsonb_array_length(p_rows), greatest(coalesce((p_import->>'matched_count')::integer, 0), 0),
    greatest(coalesce((p_import->>'unmatched_count')::integer, 0), 0), auth.uid())
  returning id into v_id;

  if v_report = 'product_usage' then
    delete from public.pmr_dispensing d
    using (select distinct coalesce(r->>'site', '') site, (r->>'month')::date m from jsonb_array_elements(p_rows) r) k
    where d.pharmacy_id = p_pharmacy_id and d.site = k.site and d.month = k.m;
    insert into public.pmr_dispensing (pharmacy_id, import_id, site, month, description, product_key, pack_size, pip,
      dmd_source, dmd_ampp_id, dmd_name, packs, units, value)
    select p_pharmacy_id, v_id, coalesce(r.site, ''), r.month, r.description, max(r.product_key), max(r.pack_size),
      coalesce(max(r.pip), max(c.pip)), max(r.dmd_source), max(r.dmd_ampp_id), max(r.dmd_name), sum(r.packs), sum(r.units), sum(r.value)
    from jsonb_to_recordset(p_rows) as r(site text, month date, description text, product_key text, pack_size numeric, pip text,
      dmd_source text, dmd_ampp_id text, dmd_name text, packs numeric, units numeric, value numeric)
    left join public.pmr_pip_codes c on c.pharmacy_id = p_pharmacy_id and c.description = r.description
    group by coalesce(r.site, ''), r.month, r.description;
  elsif v_report = 'stock_value' then
    delete from public.pmr_stock_snapshots where pharmacy_id = p_pharmacy_id and snapshot_date = v_snapshot;
    insert into public.pmr_stock_snapshots (pharmacy_id, import_id, snapshot_date, location, description, product_key, pack_size,
      pip, dmd_source, dmd_ampp_id, dmd_name, quantity, tariff, value, status)
    select p_pharmacy_id, v_id, v_snapshot, r.location, r.description, r.product_key, r.pack_size, coalesce(r.pip, c.pip),
      r.dmd_source, r.dmd_ampp_id, r.dmd_name, r.quantity, r.tariff, r.value, coalesce(r.status, '')
    from jsonb_to_recordset(p_rows) as r(location text, description text, product_key text, pack_size numeric, pip text,
      dmd_source text, dmd_ampp_id text, dmd_name text, quantity numeric, tariff numeric, value numeric, status text)
    left join public.pmr_pip_codes c on c.pharmacy_id = p_pharmacy_id and c.description = r.description;
  elsif v_report = 'items_processed' then
    insert into public.pmr_pip_codes (pharmacy_id, description, pip, import_id)
    select distinct on (r.description) p_pharmacy_id, r.description, r.pip, v_id
    from jsonb_to_recordset(p_rows) as r(description text, pip text)
    order by r.description
    on conflict (pharmacy_id, description) do update set pip = excluded.pip, import_id = excluded.import_id, updated_at = now();
    update public.pmr_dispensing d set pip = c.pip from public.pmr_pip_codes c
      where d.pharmacy_id = p_pharmacy_id and c.pharmacy_id = p_pharmacy_id and c.description = d.description and d.pip is distinct from c.pip;
    update public.pmr_stock_snapshots s set pip = c.pip from public.pmr_pip_codes c
      where s.pharmacy_id = p_pharmacy_id and c.pharmacy_id = p_pharmacy_id and c.description = s.description and s.pip is distinct from c.pip;
  end if;
  return v_id;
end $$;
revoke all on function public.pmr_record_import(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.pmr_record_import(uuid, jsonb, jsonb) to authenticated;
