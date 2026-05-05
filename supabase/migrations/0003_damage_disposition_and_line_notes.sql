-- ============================================================================
-- Reckon — damage disposition + per-line notes
--
-- Real pharmacy workflow showed two gaps in the original line model:
--
--   1. "Damaged" wasn't enough — pharmacists need to record what's happening
--      with the damaged goods (returning to supplier, disposed of, awaiting
--      decision). This affects what the credit-request email should say.
--
--   2. Notes — every line might have a unique scrap of context that doesn't
--      fit a structured field ("packaging wet on bottom 3", "expired Mar 26",
--      "broken vial 3 of 12"). These need to flow into the credit email.
--
-- Apply via SQL editor:
--   https://supabase.com/dashboard/project/kvsipdhtsgibavcvxgqx/sql/new
-- ============================================================================

-- damage_disposition is meaningful only when flags includes 'damaged'.
-- Values:
--   returning        — pharmacy will return the goods; credit when received back
--   disposed         — pharmacy has disposed of the goods; supplier credits on trust
--   awaiting         — not yet decided; supplier should follow up
alter table public.invoice_lines
  add column if not exists damage_disposition text
    check (damage_disposition is null or damage_disposition in ('returning', 'disposed', 'awaiting'));

-- The 'notes' column already exists per migration 0001 — confirm and ensure
-- there's no length cap surprise. (text is already unbounded.)
-- No-op insertion to verify the column is present and writable:
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoice_lines' and column_name = 'notes'
  ) then
    alter table public.invoice_lines add column notes text;
  end if;
end $$;
