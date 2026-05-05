-- ============================================================================
-- Reckon — credits and supplier contacts (M2.5)
--
-- Adds:
--   1. supplier_contacts — per-supplier email mapping for credit chase emails
--   2. credit_requests   — ledger of credit chase emails sent
--   3. invoice_lines.credit_request_id — link back from line to its credit ask
--
-- Apply via SQL editor:
--   https://supabase.com/dashboard/project/kvsipdhtsgibavcvxgqx/sql/new
-- ============================================================================

-- ----------------------------------------------------------------------------
-- supplier_contacts
-- ----------------------------------------------------------------------------
create table if not exists public.supplier_contacts (
  id                  uuid primary key default gen_random_uuid(),
  pharmacy_id         uuid not null references public.pharmacies(id) on delete cascade,
  supplier            text not null check (supplier in ('aah', 'aver', 'phoenix', 'alliance', 'ethigen', 'numark')),

  -- Email contacts
  credit_email        text,                  -- where credit-request emails go
  accounts_email      text,                  -- fallback / general accounts queries
  account_number      text,                  -- our customer account ref with this supplier
  contact_name        text,                  -- human contact at supplier

  -- User signature for emails
  signature           text,                  -- e.g. "Thanks,\nStuart Burns"

  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (pharmacy_id, supplier)
);

create index if not exists idx_supplier_contacts_pharmacy
  on public.supplier_contacts(pharmacy_id);

drop trigger if exists set_updated_at on public.supplier_contacts;
create trigger set_updated_at before update on public.supplier_contacts
  for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- credit_requests
-- ----------------------------------------------------------------------------
create table if not exists public.credit_requests (
  id                  uuid primary key default gen_random_uuid(),
  pharmacy_id         uuid not null references public.pharmacies(id) on delete cascade,
  supplier            text not null check (supplier in ('aah', 'aver', 'phoenix', 'alliance', 'ethigen', 'numark')),

  -- Status machine: draft → sent → resolved | overdue | cancelled
  status              text not null default 'draft' check (status in ('draft', 'sent', 'resolved', 'overdue', 'cancelled')),

  -- Money
  total_amount        numeric(12, 2) not null default 0,    -- expected refund

  -- Email content (snapshot at send time so audit is immutable)
  email_to            text,
  email_cc            text,
  email_subject       text,
  email_body          text,

  sent_at             timestamptz,
  sent_by             uuid references auth.users(id),

  -- Resolution
  resolved_at         timestamptz,
  resolved_via_statement_line_id uuid references public.statement_lines(id) on delete set null,
  external_credit_note_number    text,    -- supplier's reference if they issue one

  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_credit_requests_pharmacy on public.credit_requests(pharmacy_id);
create index if not exists idx_credit_requests_status   on public.credit_requests(pharmacy_id, status);
create index if not exists idx_credit_requests_supplier on public.credit_requests(pharmacy_id, supplier, status);

drop trigger if exists set_updated_at on public.credit_requests;
create trigger set_updated_at before update on public.credit_requests
  for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- invoice_lines.credit_request_id
-- ----------------------------------------------------------------------------
-- A line can be linked to at most one OPEN credit request. If the credit is
-- cancelled or rejected, the line is unlinked and can join a new request.
alter table public.invoice_lines
  add column if not exists credit_request_id uuid references public.credit_requests(id) on delete set null;

create index if not exists idx_invoice_lines_credit_request
  on public.invoice_lines(credit_request_id) where credit_request_id is not null;

-- ----------------------------------------------------------------------------
-- statement_lines: track which credit_request a CRED row resolved
-- ----------------------------------------------------------------------------
alter table public.statement_lines
  add column if not exists resolved_credit_request_id uuid references public.credit_requests(id) on delete set null;

create index if not exists idx_statement_lines_resolved_credit
  on public.statement_lines(resolved_credit_request_id) where resolved_credit_request_id is not null;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.supplier_contacts enable row level security;
alter table public.credit_requests   enable row level security;

drop policy if exists supplier_contacts_all on public.supplier_contacts;
create policy supplier_contacts_all on public.supplier_contacts
  for all using (public.user_belongs_to_pharmacy(pharmacy_id))
  with check (public.user_belongs_to_pharmacy(pharmacy_id));

drop policy if exists credit_requests_all on public.credit_requests;
create policy credit_requests_all on public.credit_requests
  for all using (public.user_belongs_to_pharmacy(pharmacy_id))
  with check (public.user_belongs_to_pharmacy(pharmacy_id));

-- ============================================================================
-- Sensible defaults — seed supplier_contacts for known suppliers per pharmacy
-- ============================================================================
-- Insert one row per supplier per existing pharmacy. User can edit later.
insert into public.supplier_contacts (pharmacy_id, supplier, credit_email, accounts_email, contact_name)
select p.id, s.supplier, s.credit_email, s.accounts_email, s.contact_name
from public.pharmacies p
cross join (values
  ('aah',      'creditrequests@aah.co.uk',     'AAHReceivables@aah.co.uk', null),
  ('aver',     'accounts@avergenerics.co.uk',  'accounts@avergenerics.co.uk', null),
  ('phoenix',  'credits@phoenixhc.co.uk',      'accounts@phoenixhc.co.uk', null),
  ('alliance', 'credits@alliance-healthcare.co.uk', 'accounts@alliance-healthcare.co.uk', null),
  ('ethigen',  null,                           null, null),
  ('numark',   null,                           null, null)
) as s(supplier, credit_email, accounts_email, contact_name)
on conflict (pharmacy_id, supplier) do nothing;
