/**
 * /api/suppliers
 *
 * PATCH: Update a supplier_contacts row. The id is passed in the body (the
 *        Suppliers page lists multiple rows and patches them individually
 *        on blur — keeping a single endpoint avoids per-row dynamic routes).
 *
 * RLS enforces the row belongs to the caller's pharmacy.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const EDITABLE_FIELDS = [
  'credit_email',
  'accounts_email',
  'account_number',
  'contact_name',
  'signature',
  'notes',
] as const;

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : null;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) {
      const v = body[field];
      if (v === null || typeof v === 'string') {
        // Empty string → null so the DB doesn't store empty strings
        update[field] = typeof v === 'string' && v.trim() === '' ? null : v;
      }
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
  }

  const { error } = await supabase.from('supplier_contacts').update(update).eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
