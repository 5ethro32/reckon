-- ============================================================================
-- Reckon — user profile + self-serve signup support (M2.5)
--
-- Adds:
--   1. pharmacy_memberships.display_name — user's preferred name
--                                          (e.g. "Stuart Burns")
--   2. pharmacy_memberships.onboarded_at  — null until first-login modal done
--   3. helper RPC: setup_new_pharmacy(name) — atomically creates a pharmacy
--      and a membership for the calling user. Used by the self-serve signup
--      flow when a magic-link auth lands without an existing membership.
--
-- Apply via SQL editor:
--   https://supabase.com/dashboard/project/kvsipdhtsgibavcvxgqx/sql/new
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pharmacy_memberships: display_name + onboarded_at
-- ----------------------------------------------------------------------------
alter table public.pharmacy_memberships
  add column if not exists display_name text;

alter table public.pharmacy_memberships
  add column if not exists onboarded_at timestamptz;

-- Backfill existing memberships so they don't trigger the onboarding modal.
-- New users will have null onboarded_at; the app sees that as "needs setup".
update public.pharmacy_memberships
  set onboarded_at = created_at
  where onboarded_at is null and display_name is not null;

-- ----------------------------------------------------------------------------
-- setup_new_pharmacy(name) — self-serve signup helper
--
-- Called from the /api/onboarding endpoint when a freshly-signed-in user has
-- no membership yet. Atomically creates a pharmacy + a membership in one
-- transaction. Returns the new pharmacy_id.
--
-- security definer is required because the calling user can't insert into
-- public.pharmacies directly (no RLS policy for raw inserts) — the function
-- runs with elevated privileges, but only ever creates a pharmacy that the
-- caller is then made owner of, so it can't be abused to create dangling rows.
-- ----------------------------------------------------------------------------
create or replace function public.setup_new_pharmacy(p_pharmacy_name text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_pharmacy_id uuid;
begin
  -- Identify the caller. auth.uid() returns null if no session, which we
  -- reject below.
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Refuse blank or absurdly long names early.
  if p_pharmacy_name is null
     or length(trim(p_pharmacy_name)) = 0
     or length(p_pharmacy_name) > 200 then
    raise exception 'invalid_pharmacy_name';
  end if;

  -- Idempotency: if the user already has a membership, return the existing
  -- pharmacy_id rather than creating another. Stops double-clicks from
  -- spawning multiple shell pharmacies.
  select pharmacy_id into v_pharmacy_id
  from public.pharmacy_memberships
  where user_id = v_user_id
  limit 1;

  if v_pharmacy_id is not null then
    return v_pharmacy_id;
  end if;

  -- Create the pharmacy.
  insert into public.pharmacies (name)
  values (trim(p_pharmacy_name))
  returning id into v_pharmacy_id;

  -- Make the caller the owner.
  insert into public.pharmacy_memberships (pharmacy_id, user_id, role)
  values (v_pharmacy_id, v_user_id, 'owner');

  -- Seed the default supplier_contacts rows for this new pharmacy
  -- (mirrors the seed in migration 0002 but scoped to one pharmacy).
  insert into public.supplier_contacts (pharmacy_id, supplier, credit_email, accounts_email)
  values
    (v_pharmacy_id, 'aah',      'creditrequests@aah.co.uk',          'AAHReceivables@aah.co.uk'),
    (v_pharmacy_id, 'aver',     'accounts@avergenerics.co.uk',       'accounts@avergenerics.co.uk'),
    (v_pharmacy_id, 'phoenix',  'credits@phoenixhc.co.uk',           'accounts@phoenixhc.co.uk'),
    (v_pharmacy_id, 'alliance', 'credits@alliance-healthcare.co.uk', 'accounts@alliance-healthcare.co.uk'),
    (v_pharmacy_id, 'ethigen',  null, null),
    (v_pharmacy_id, 'numark',   null, null)
  on conflict (pharmacy_id, supplier) do nothing;

  return v_pharmacy_id;
end;
$$;

-- Allow signed-in users to call the function. SECURITY DEFINER above means
-- it runs as the function owner, but we still need an EXECUTE grant.
grant execute on function public.setup_new_pharmacy(text) to authenticated;

-- ----------------------------------------------------------------------------
-- complete_onboarding(p_display_name, p_pharmacy_name) — first-login modal
--
-- Updates the caller's display_name AND their pharmacy's name in one atomic
-- step, then marks the membership as onboarded. Returns nothing.
-- ----------------------------------------------------------------------------
create or replace function public.complete_onboarding(
  p_display_name text,
  p_pharmacy_name text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_pharmacy_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if p_display_name is null
     or length(trim(p_display_name)) = 0
     or length(p_display_name) > 120 then
    raise exception 'invalid_display_name';
  end if;

  if p_pharmacy_name is null
     or length(trim(p_pharmacy_name)) = 0
     or length(p_pharmacy_name) > 200 then
    raise exception 'invalid_pharmacy_name';
  end if;

  -- Find the caller's pharmacy. They must already have a membership;
  -- the signup flow ensures this before triggering onboarding.
  select pharmacy_id into v_pharmacy_id
  from public.pharmacy_memberships
  where user_id = v_user_id
  limit 1;

  if v_pharmacy_id is null then
    raise exception 'no_membership';
  end if;

  -- Update the membership.
  update public.pharmacy_memberships
    set display_name = trim(p_display_name),
        onboarded_at = now()
    where user_id = v_user_id;

  -- Update the pharmacy name.
  update public.pharmacies
    set name = trim(p_pharmacy_name)
    where id = v_pharmacy_id;
end;
$$;

grant execute on function public.complete_onboarding(text, text) to authenticated;
