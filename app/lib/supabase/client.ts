/**
 * Browser-side Supabase client.
 *
 * Use in client components ("use client") to make calls from the browser.
 * Reads/writes cookies via document.cookie under the hood.
 *
 * Uses the anon key — RLS policies enforce row-level access.
 */

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
