-- A pharmacy's own account codes with Aver Generics (e.g. HO025), so a delivery's picking-slip QR
-- can bring in its Aver invoices directly: only slips on these accounts are returned.
alter table public.pharmacies add column if not exists aver_accounts text[] not null default '{}';
