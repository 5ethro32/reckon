/**
 * PATCH /api/profile
 *
 * Updates display_name (pharmacy_memberships) and/or pharmacy name (pharmacies).
 * Partial updates are allowed — send only the field(s) that changed.
 *
 * Auth: session cookie via Supabase SSR client. RLS on both tables restricts
 * writes to the signed-in user's own rows.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json();
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : null;
  const pharmacyName = typeof body.pharmacyName === 'string' ? body.pharmacyName.trim() : null;

  if (displayName !== null && (displayName.length === 0 || displayName.length > 120)) {
    return NextResponse.json({ error: 'Display name must be 1–120 characters' }, { status: 400 });
  }
  if (pharmacyName !== null && (pharmacyName.length === 0 || pharmacyName.length > 200)) {
    return NextResponse.json({ error: 'Pharmacy name must be 1–200 characters' }, { status: 400 });
  }
  if (displayName === null && pharmacyName === null) {
    return NextResponse.json({ error: 'No changes' }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from('pharmacy_memberships')
    .select('pharmacy_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: 'No pharmacy' }, { status: 404 });

  if (displayName !== null) {
    const { error } = await supabase
      .from('pharmacy_memberships')
      .update({ display_name: displayName })
      .eq('user_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (pharmacyName !== null) {
    const { error } = await supabase
      .from('pharmacies')
      .update({ name: pharmacyName })
      .eq('id', membership.pharmacy_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
