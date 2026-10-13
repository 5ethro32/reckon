-- NHS Dictionary of Medicines and Devices (dm+d) pack reference, loaded by scripts/import-dmd.mts.
-- Contains public sector information licensed under the Open Government Licence v3.0 (NHSBSA dm+d).
-- Shared, read-only reference data: it identifies a scanned pack before any pharmacy has mapped it.
-- It never proves what an invoice line is; staff still confirm the product and pack on first use.
create table public.dmd_packs (
  gtin text not null check (gtin ~ '^[0-9]{14}$'),
  ampp_id text not null check (ampp_id ~ '^[0-9]{6,18}$'),
  name text not null,
  generic_name text,
  pack_qty numeric,
  discontinued boolean not null default false,
  gtin_start date,
  gtin_end date,
  primary key (gtin, ampp_id)
);
create table public.dmd_releases (
  release text primary key,
  loaded_at timestamptz not null default now(),
  packs integer not null
);
alter table public.dmd_packs enable row level security;
alter table public.dmd_releases enable row level security;
create policy dmd_packs_read on public.dmd_packs for select to authenticated using (true);
create policy dmd_releases_read on public.dmd_releases for select to authenticated using (true);
-- Writes come only from the importer using the service role.
