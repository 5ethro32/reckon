/**
 * POST /api/onboarding
 *
 * First-login onboarding: atomically writes the user's display_name,
 * updates their pharmacy's name, and stamps onboarded_at via the
 * complete_onboarding() security-definer RPC.
 *
 * Returns { ok: true } on success.
 * Returns { ok: false, error } on validation or RPC failure.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const pharmacyName = typeof body.pharmacyName === 'string' ? body.pharmacyName.trim() : '';

  if (!displayName || displayName.length > 120) {
    return NextResponse.json(
      { ok: false, error: 'invalid_display_name' },
      { status: 400 }
    );
  }
  if (!pharmacyName || pharmacyName.length > 200) {
    return NextResponse.json(
      { ok: false, error: 'invalid_pharmacy_name' },
      { status: 400 }
    );
  }

  const { error } = await supabase.rpc('complete_onboarding', {
    p_display_name: displayName,
    p_pharmacy_name: pharmacyName,
  });

  if (error) {
    const isValidationError =
      error.message === 'invalid_display_name' ||
      error.message === 'invalid_pharmacy_name' ||
      error.message === 'no_membership';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isValidationError ? 400 : 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
