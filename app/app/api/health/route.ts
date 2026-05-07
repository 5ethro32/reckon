/**
 * GET /api/health — uptime probe.
 *
 * Returns:
 *   200 { ok: true, ts, db: 'ok', version }              — all good
 *   200 { ok: true, ts, db: 'degraded', version, error } — DB unreachable
 *                                                          but app is responding
 *
 * Why 200 even on DB failure: this endpoint is for proving "the function
 * is alive". DB health is reported in the body so monitors can alert on
 * `db !== 'ok'` independently of HTTP status. Keeps Vercel's own
 * function-level alerts and DB-level alerts cleanly separable.
 *
 * Public — no auth. Returns no PII or schema info.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// Tag deployments so logs/monitors can correlate health checks with
// specific Vercel deploys. Falls back to 'unknown' in local dev.
const VERCEL_GIT_COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'unknown';

export async function GET() {
  const ts = new Date().toISOString();

  let dbStatus: 'ok' | 'degraded' = 'ok';
  let dbError: string | undefined;

  try {
    const supabase = await createClient();
    // Cheapest possible query — count from a tiny, indexed table that always
    // exists. We don't need the actual count, just confirmation that
    // PostgREST + the DB are responsive.
    const { error } = await supabase
      .from('pharmacies')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    if (error) {
      dbStatus = 'degraded';
      dbError = error.message;
    }
  } catch (e) {
    dbStatus = 'degraded';
    dbError = e instanceof Error ? e.message : 'unknown';
  }

  return NextResponse.json({
    ok: true,
    ts,
    db: dbStatus,
    version: VERCEL_GIT_COMMIT_SHA,
    ...(dbError ? { error: dbError } : {}),
  }, {
    headers: {
      // Don't cache health responses — defeats the purpose
      'cache-control': 'no-store, max-age=0',
    },
  });
}
