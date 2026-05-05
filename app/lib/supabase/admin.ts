/**
 * Admin Supabase client — bypasses RLS using the service role key.
 *
 * USE WITH EXTREME CARE.
 * - Only call from trusted server contexts (API routes, server actions, cron)
 * - NEVER import this in client components
 * - Always validate the calling user's permissions in code before using
 *
 * Use cases:
 *   - Server-side ingestion that needs to write across tenant boundaries
 *   - Cron jobs that don't have a user session
 *   - Admin tooling
 *
 * For normal user-driven operations, use ./server.ts which respects RLS.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  }

  return createSupabaseClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
