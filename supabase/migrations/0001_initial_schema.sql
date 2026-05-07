-- ============================================================================
-- Reckon — initial schema (M2)
--
-- Multi-tenant invoice + statement reconciliation for UK pharmacies.
-- Every business table carries a pharmacy_id and is gated by RLS so a user
-- can only see rows for pharmacies they belong to.
--
-- Run this in the Supabase SQL editor for your project.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;

-- ----------------------------------------------------------------------------
-- Pharmacies — the tenants
-- ----------------------------------------------------------------------------
create table if not exists public.pharmacies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  ods_code        text unique,                -- NHS pharmacy code (e.g. FW042)
  vat_number      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Pharmacy memberships — joins auth.users to pharmacies
-- ----------------------------------------------------------------------------
create table if not exists public.pharmacy_memberships (
  pharmacy_id     uuid not null references public.pharmacies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at      timestamptz not null default now(),
  primary key (pharmacy_id, user_id)
);

create index if not exists idx_memberships_user on public.pharmacy_memberships(user_id);

-- Helper function: returns true if the current auth user belongs to a pharmacy.
-- Used in every RLS policy below.
create or replace function public.user_belongs_to_pharmacy(p_pharmacy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists(
    select 1 from public.pharmacy_memberships
    where pharmacy_id = p_pharmacy_id
      and user_id = auth.uid()
  );
$$;

-- ----------------------------------------------------------------------------
-- Invoices — header
-- ----------------------------------------------------------------------------
create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  pharmacy_id         uuid not null references public.pharmacies(id) on delete cascade,

  -- Identity (from parser)
  supplier            text not null,
  invoice_number      text not null,
  invoice_date        date not null,
  due_date            date,
  po_number           text,
  customer_account    text,
  customer_name       text,

  -- Totals
  net_total           numeric(12, 2) not null default 0,
  vat_total           numeric(12, 2) not null default 0,
  gross_total         numeric(12, 2) not null default 0,
  totals_match        boolean not null default false,

  -- Receipt status (set by user during tick-off)
  receipt_status      text not null default 'pending' check (receipt_status in ('pending', 'received_full', 'short', 'damaged', 'not_received')),
  received_at         timestamptz,
  received_by         uuid references auth.users(id),

  -- Source PDF
  source_storage_path text,                     -- supabase storage path
  raw_text            text,                     -- pdf-parse output (for debugging)
  warnings            jsonb not null default '[]'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  unique (pharmacy_id, supplier, invoice_number)
);

create index if not exists idx_invoices_pharmacy on public.invoices(pharmacy_id) where deleted_at is null;
create index if not exists idx_invoices_supplier on public.invoices(pharmacy_id, supplier) where deleted_at is null;
create index if not exists idx_invoices_invoice_number on public.invoices(pharmacy_id, supplier, invoice_number);

-- ----------------------------------------------------------------------------
-- Invoice lines
-- ----------------------------------------------------------------------------
create table if not exists public.invoice_lines (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references public.invoices(id) on delete cascade,
  pharmacy_id         uuid not null references public.pharmacies(id) on delete cascade,
  line_number         integer not null,                -- order within invoice

  -- Product
  supplier_sku        text not null,
  description         text not null,
  pack_size           text,

  -- Quantities + money
  qty_ordered         integer not null,
  qty_received        integer,                          -- nullable until ticked off
  unit_price          numeric(12, 4) not null,          -- 4dp because unit prices can be fractional
  net                 numeric(12, 2) not null,
  vat_rate            integer not null,
  vat_amount          numeric(12, 2) not null,
  gross               numeric(12, 2) not null,

  -- Status flags from tick-off
  flags               jsonb not null default '[]'::jsonb,   -- e.g. ['short', 'damaged']
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_invoice_lines_invoice on public.invoice_lines(invoice_id);
create index if not exists idx_invoice_lines_pharmacy on public.invoice_lines(pharmacy_id);

-- ----------------------------------------------------------------------------
-- Statements — header
-- ----------------------------------------------------------------------------
create table if not exists public.statements (
  id                  uuid primary key default gen_random_uuid(),
  pharmacy_id         uuid not null references public.pharmacies(id) on delete cascade,

  supplier            text not null,
  statement_date      date not null,
  customer_account    text,
  customer_name       text,

  net_total           numeric(12, 2) not null default 0,
  vat_total           numeric(12, 2) not null default 0,
  gross_total         numeric(12, 2) not null default 0,
  totals_match        boolean not null default false,

  -- Reconciliation rollup (populated by reconcile job)
  reconciled_count    integer not null default 0,
  unreconciled_count  integer not null default 0,
  expected_total      numeric(12, 2) not null default 0,    -- invoices − credits expected
  variance            numeric(12, 2) not null default 0,    -- statement total − expected total

  source_storage_path text,
  raw_text            text,
  warnings            jsonb not null default '[]'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  unique (pharmacy_id, supplier, statement_date)
);

create index if not exists idx_statements_pharmacy on public.statements(pharmacy_id) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- Statement lines (one row per line on the statement)
-- ----------------------------------------------------------------------------
create table if not exists public.statement_lines (
  id                  uuid primary key default gen_random_uuid(),
  statement_id        uuid not null references public.statements(id) on delete cascade,
  pharmacy_id         uuid not null references public.pharmacies(id) on delete cascade,
  line_number         integer not null,

  -- From statement row
  document_date       date not null,
  document_number     text not null,
  document_type       text not null check (document_type in ('INV', 'CRED', 'OTHER')),
  reference           text,
  due_date            date,
  net                 numeric(12, 2) not null,
  vat                 numeric(12, 2) not null,
  total               numeric(12, 2) not null,

  -- Reconciliation
  matched_invoice_id  uuid references public.invoices(id) on delete set null,
  match_confidence    numeric(3, 2),                    -- 0.00 - 1.00
  match_status        text not null default 'unmatched' check (match_status in ('unmatched', 'matched', 'expected_credit', 'manual_override')),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_statement_lines_statement on public.statement_lines(statement_id);
create index if not exists idx_statement_lines_pharmacy on public.statement_lines(pharmacy_id);
create index if not exists idx_statement_lines_doc_number on public.statement_lines(pharmacy_id, document_number);
create index if not exists idx_statement_lines_invoice on public.statement_lines(matched_invoice_id);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.pharmacies;
create trigger set_updated_at before update on public.pharmacies
  for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at on public.invoices;
create trigger set_updated_at before update on public.invoices
  for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at on public.invoice_lines;
create trigger set_updated_at before update on public.invoice_lines
  for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at on public.statements;
create trigger set_updated_at before update on public.statements
  for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at on public.statement_lines;
create trigger set_updated_at before update on public.statement_lines
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.pharmacies              enable row level security;
alter table public.pharmacy_memberships    enable row level security;
alter table public.invoices                enable row level security;
alter table public.invoice_lines           enable row level security;
alter table public.statements              enable row level security;
alter table public.statement_lines         enable row level security;

-- Pharmacies: users can read pharmacies they're members of
drop policy if exists pharmacies_read on public.pharmacies;
create policy pharmacies_read on public.pharmacies
  for select using (public.user_belongs_to_pharmacy(id));

drop policy if exists pharmacies_update on public.pharmacies;
create policy pharmacies_update on public.pharmacies
  for update using (public.user_belongs_to_pharmacy(id));

-- Memberships: users can read their own memberships
drop policy if exists memberships_self on public.pharmacy_memberships;
create policy memberships_self on public.pharmacy_memberships
  for select using (user_id = auth.uid());

-- Invoices
drop policy if exists invoices_all on public.invoices;
create policy invoices_all on public.invoices
  for all using (public.user_belongs_to_pharmacy(pharmacy_id))
  with check (public.user_belongs_to_pharmacy(pharmacy_id));

-- Invoice lines
drop policy if exists invoice_lines_all on public.invoice_lines;
create policy invoice_lines_all on public.invoice_lines
  for all using (public.user_belongs_to_pharmacy(pharmacy_id))
  with check (public.user_belongs_to_pharmacy(pharmacy_id));

-- Statements
drop policy if exists statements_all on public.statements;
create policy statements_all on public.statements
  for all using (public.user_belongs_to_pharmacy(pharmacy_id))
  with check (public.user_belongs_to_pharmacy(pharmacy_id));

-- Statement lines
drop policy if exists statement_lines_all on public.statement_lines;
create policy statement_lines_all on public.statement_lines
  for all using (public.user_belongs_to_pharmacy(pharmacy_id))
  with check (public.user_belongs_to_pharmacy(pharmacy_id));

-- ============================================================================
-- Storage bucket for source PDFs
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('source-pdfs', 'source-pdfs', false)
on conflict (id) do nothing;

-- Storage RLS: users can only read/write objects under their pharmacy folder
drop policy if exists "pdfs select own" on storage.objects;
create policy "pdfs select own" on storage.objects
  for select using (
    bucket_id = 'source-pdfs'
    and public.user_belongs_to_pharmacy((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "pdfs insert own" on storage.objects;
create policy "pdfs insert own" on storage.objects
  for insert with check (
    bucket_id = 'source-pdfs'
    and public.user_belongs_to_pharmacy((storage.foldername(name))[1]::uuid)
  );
