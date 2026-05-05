-- Reckon — Chunk A: extensions + tables only
-- Run first. Idempotent (uses `if not exists`).

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;

create table if not exists public.pharmacies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  ods_code        text unique,
  vat_number      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.pharmacy_memberships (
  pharmacy_id     uuid not null references public.pharmacies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at      timestamptz not null default now(),
  primary key (pharmacy_id, user_id)
);

create index if not exists idx_memberships_user on public.pharmacy_memberships(user_id);

create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  pharmacy_id         uuid not null references public.pharmacies(id) on delete cascade,
  supplier            text not null check (supplier in ('aah', 'aver', 'phoenix', 'alliance', 'ethigen', 'numark')),
  invoice_number      text not null,
  invoice_date        date not null,
  due_date            date,
  po_number           text,
  customer_account    text,
  customer_name       text,
  net_total           numeric(12, 2) not null default 0,
  vat_total           numeric(12, 2) not null default 0,
  gross_total         numeric(12, 2) not null default 0,
  totals_match        boolean not null default false,
  receipt_status      text not null default 'pending' check (receipt_status in ('pending', 'received_full', 'short', 'damaged', 'not_received')),
  received_at         timestamptz,
  received_by         uuid references auth.users(id),
  source_storage_path text,
  raw_text            text,
  warnings            jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (pharmacy_id, supplier, invoice_number)
);

create index if not exists idx_invoices_pharmacy on public.invoices(pharmacy_id) where deleted_at is null;
create index if not exists idx_invoices_supplier on public.invoices(pharmacy_id, supplier) where deleted_at is null;
create index if not exists idx_invoices_invoice_number on public.invoices(pharmacy_id, supplier, invoice_number);

create table if not exists public.invoice_lines (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references public.invoices(id) on delete cascade,
  pharmacy_id         uuid not null references public.pharmacies(id) on delete cascade,
  line_number         integer not null,
  supplier_sku        text not null,
  description         text not null,
  pack_size           text,
  qty_ordered         integer not null,
  qty_received        integer,
  unit_price          numeric(12, 4) not null,
  net                 numeric(12, 2) not null,
  vat_rate            integer not null,
  vat_amount          numeric(12, 2) not null,
  gross               numeric(12, 2) not null,
  flags               jsonb not null default '[]'::jsonb,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_invoice_lines_invoice on public.invoice_lines(invoice_id);
create index if not exists idx_invoice_lines_pharmacy on public.invoice_lines(pharmacy_id);

create table if not exists public.statements (
  id                  uuid primary key default gen_random_uuid(),
  pharmacy_id         uuid not null references public.pharmacies(id) on delete cascade,
  supplier            text not null check (supplier in ('aah', 'aver', 'phoenix', 'alliance', 'ethigen', 'numark')),
  statement_date      date not null,
  customer_account    text,
  customer_name       text,
  net_total           numeric(12, 2) not null default 0,
  vat_total           numeric(12, 2) not null default 0,
  gross_total         numeric(12, 2) not null default 0,
  totals_match        boolean not null default false,
  reconciled_count    integer not null default 0,
  unreconciled_count  integer not null default 0,
  expected_total      numeric(12, 2) not null default 0,
  variance            numeric(12, 2) not null default 0,
  source_storage_path text,
  raw_text            text,
  warnings            jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (pharmacy_id, supplier, statement_date)
);

create index if not exists idx_statements_pharmacy on public.statements(pharmacy_id) where deleted_at is null;

create table if not exists public.statement_lines (
  id                  uuid primary key default gen_random_uuid(),
  statement_id        uuid not null references public.statements(id) on delete cascade,
  pharmacy_id         uuid not null references public.pharmacies(id) on delete cascade,
  line_number         integer not null,
  document_date       date not null,
  document_number     text not null,
  document_type       text not null check (document_type in ('INV', 'CRED', 'OTHER')),
  reference           text,
  due_date            date,
  net                 numeric(12, 2) not null,
  vat                 numeric(12, 2) not null,
  total               numeric(12, 2) not null,
  matched_invoice_id  uuid references public.invoices(id) on delete set null,
  match_confidence    numeric(3, 2),
  match_status        text not null default 'unmatched' check (match_status in ('unmatched', 'matched', 'expected_credit', 'manual_override')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_statement_lines_statement on public.statement_lines(statement_id);
create index if not exists idx_statement_lines_pharmacy on public.statement_lines(pharmacy_id);
create index if not exists idx_statement_lines_doc_number on public.statement_lines(pharmacy_id, document_number);
create index if not exists idx_statement_lines_invoice on public.statement_lines(matched_invoice_id);
