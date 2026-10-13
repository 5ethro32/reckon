/**
 * PATCH /api/invoice-lines/[id]
 *
 * Update any subset of:
 *   - flags, qty_received, qty_returned
 *   - damage_disposition (for damaged status)
 *   - return_disposition (for returned status)
 *   - notes
 *
 * Only the fields present in the body are updated; missing fields are
 * left untouched.
 *
 * Side effect: if the update transitions the line into the `returned` flag
 * state (or the qty_returned changes on an already-returned line), we kick
 * off a retroactive match against open CRED rows on existing supplier
 * statements via the try_match_returned_line_to_credit_row RPC. This lets
 * the system auto-resolve a return that's already been credited on a
 * statement we ingested earlier — without needing the pharmacist to do
 * anything else.
 *
 * RLS enforces the line belongs to a pharmacy the caller is a member of.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const ALLOWED_DAMAGE_DISPOSITIONS = new Set(['returning', 'disposed', 'awaiting']);
const ALLOWED_RETURN_DISPOSITIONS = new Set([
  'damaged',
  'wrong_product',
  'expired',
  'over_ordered',
  'other',
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Build a partial update from only the fields present + valid in the body.
  const update: Record<string, unknown> = {};

  if (Array.isArray(body.flags)) {
    update.flags = (body.flags as unknown[]).filter(
      (f): f is string => typeof f === 'string'
    );
  }

  if ('qty_received' in body) {
    const value = body.qty_received;
    if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) {
      return NextResponse.json({ error: 'Received quantity must be a non-negative whole number' }, { status: 400 });
    }
    update.qty_received = value;
  }

  if ('qty_returned' in body) {
    const v = body.qty_returned;
    if (v === null) {
      update.qty_returned = null;
    } else if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) {
      update.qty_returned = v;
    } else {
      return NextResponse.json(
        { error: 'qty_returned must be a non-negative number or null' },
        { status: 400 }
      );
    }
  }

  if ('damage_disposition' in body) {
    const v = body.damage_disposition;
    if (v === null) {
      update.damage_disposition = null;
    } else if (typeof v === 'string' && ALLOWED_DAMAGE_DISPOSITIONS.has(v)) {
      update.damage_disposition = v;
    } else {
      return NextResponse.json(
        { error: `damage_disposition must be one of: returning, disposed, awaiting, null` },
        { status: 400 }
      );
    }
  }

  if ('return_disposition' in body) {
    const v = body.return_disposition;
    if (v === null) {
      update.return_disposition = null;
    } else if (typeof v === 'string' && ALLOWED_RETURN_DISPOSITIONS.has(v)) {
      update.return_disposition = v;
    } else {
      return NextResponse.json(
        { error: `return_disposition must be one of: damaged, wrong_product, expired, over_ordered, other, null` },
        { status: 400 }
      );
    }
  }

  if ('notes' in body) {
    const v = body.notes;
    if (v === null) {
      update.notes = null;
    } else if (typeof v === 'string') {
      // Strip control chars, trim
      update.notes = v.replace(/[\x00-\x1F\x7F]/g, ' ').trim() || null;
    } else {
      return NextResponse.json(
        { error: 'notes must be a string or null' },
        { status: 400 }
      );
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: 'No valid fields to update' },
      { status: 400 }
    );
  }

  const { data: saved, error } = await supabase.from('invoice_lines')
    .update(update).eq('id', id).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!saved) return NextResponse.json({ error: 'Invoice line not found' }, { status: 404 });

  // Retroactive match: any exception flag (short / damaged / returned /
  // not_received) implies an expected credit. Fire the matcher to look for
  // an open CRED row on a prior statement that resolves it. The RPC is
  // idempotent — does nothing if the line is already linked, has a
  // credit_request, or has no matching CRED amount.
  const flags = update.flags as string[] | undefined;
  const exceptionFlags = ['short', 'damaged', 'returned', 'not_received'];
  const hasException =
    Array.isArray(flags) && flags.some(f => exceptionFlags.includes(f));

  if (hasException) {
    void supabase.rpc('try_match_returned_line_to_credit_row', {
      p_invoice_line_id: id,
    }).then(({ error }) => {
      if (error) console.warn('try_match_returned_line_to_credit_row:', error.message);
    });
  }

  return NextResponse.json({ ok: true });
}
