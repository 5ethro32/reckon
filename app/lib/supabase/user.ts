/**
 * Signed-in user from the session JWT.
 *
 * getClaims() verifies the access token's signature locally against the
 * project's published JWKS (cached per server instance) when the project
 * signs with an asymmetric key, so there is no Auth round trip per request.
 * With a legacy symmetric secret it falls back to getUser() on the Auth
 * server, which is what every caller did before. A token about to expire is
 * refreshed first, exactly as getUser() did.
 *
 * Authorisation still rests on RLS: PostgREST checks the same JWT.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type SignedInUser = { id: string; email: string | null };

export async function getSignedInUser(db: Pick<SupabaseClient, 'auth'>): Promise<SignedInUser | null> {
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const email = data.claims.email;
  return { id: data.claims.sub, email: typeof email === 'string' && email ? email : null };
}
