/**
 * Per-request auth and membership for server components.
 *
 * React cache() scopes each helper to one server render, so the (app)
 * layout and the page share one Supabase client, one JWT check and one
 * membership query instead of repeating them.
 */

import { cache } from 'react';
import { createClient } from './supabase/server';
import { getSignedInUser } from './supabase/user';

export const getRequestClient = cache(createClient);

export const getCurrentUser = cache(async () => getSignedInUser(await getRequestClient()));

export type CurrentMembership = {
  pharmacy_id: string;
  role: string;
  onboarded_at: string | null;
  display_name: string | null;
  pharmacy: { id: string; name: string };
};

/** First membership row for the signed-in user, or null when signed out or without access. */
export const getCurrentMembership = cache(async (): Promise<CurrentMembership | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const db = await getRequestClient();
  const { data, error } = await db
    .from('pharmacy_memberships')
    .select('pharmacy_id, role, onboarded_at, display_name, pharmacies(id, name)')
    .eq('user_id', user.id)
    .limit(1);
  const row = data?.[0];
  if (error || !row) return null;
  const raw = row.pharmacies as { id: string; name: string } | { id: string; name: string }[] | null;
  const pharmacy = Array.isArray(raw) ? raw[0] : raw;
  if (!pharmacy) return null;
  return { pharmacy_id: row.pharmacy_id, role: row.role, onboarded_at: row.onboarded_at, display_name: row.display_name, pharmacy };
});
