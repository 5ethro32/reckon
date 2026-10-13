/**
 * /api/credits/[id]
 *
 * PATCH:  Update status, notes, or external_credit_note_number on a credit_request.
 *         If status changes to 'cancelled' or 'resolved', invoice_lines are unlinked
 *         (credit_request_id set to null) so they can join a new request.
 *
 * DELETE: Hard-delete a draft credit_request. Only allowed for status='draft'.
 *         Sent / resolved / cancelled rows are part of the audit trail.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CREDIT_STATUSES as ALLOWED_STATUSES, canChangeCreditStatus, type CreditStatus as Status } from '@/lib/credit-status';

export const runtime = 'nodejs';


export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  let body: {
    status?: unknown;
    notes?: unknown;
    external_credit_note_number?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const update: Record<string, unknown> = {};
  if (typeof body.status === 'string') {
    if (!ALLOWED_STATUSES.includes(body.status as Status)) {
      return NextResponse.json(
        { error: `Invalid status — must be one of ${ALLOWED_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }
    update.status = body.status;
    if (body.status === 'resolved') {
      update.resolved_at = new Date().toISOString();
    }
  }
  if (typeof body.notes === 'string' || body.notes === null) {
    update.notes = body.notes;
  }
  if (
    typeof body.external_credit_note_number === 'string' ||
    body.external_credit_note_number === null
  ) {
    update.external_credit_note_number = body.external_credit_note_number;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  // Confirm the row exists and is accessible (RLS enforces pharmacy scope)
  const { data: existing, error: fetchError } = await supabase
    .from('credit_requests')
    .select('id, status, external_credit_note_number')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Credit request not found' }, { status: 404 });
  }

  if (existing.status === 'resolved' && 'external_credit_note_number' in update) {
    return NextResponse.json({ error: 'Evidence on a resolved claim cannot be replaced or cleared' }, { status: 409 });
  }
  if (typeof update.status === 'string' && !canChangeCreditStatus(existing.status as Status, update.status as Status)) {
    return NextResponse.json({ error: `A ${existing.status} claim cannot be changed to ${update.status}` }, { status: 409 });
  }
  if (update.status === 'sent' && existing.status === 'draft') {
    update.sent_at = new Date().toISOString();
    update.sent_by = user.id;
  }
  if (update.status === 'resolved') {
    const reference = typeof update.external_credit_note_number === 'string'
      ? update.external_credit_note_number.trim() : existing.external_credit_note_number?.trim();
    if (!reference) return NextResponse.json({ error: 'Enter the supplier credit reference before resolving the claim' }, { status: 400 });
    update.external_credit_note_number = reference;
    update.resolved_at = new Date().toISOString();
  } else if (update.status && existing.status === 'resolved') {
    return NextResponse.json({ error: 'A resolved claim cannot be reopened by changing its status' }, { status: 409 });
  }

  const { data: changed, error: updateError } = await supabase
    .from('credit_requests')
    .update(update)
    .eq('id', id)
    // Only apply the change if nobody moved the claim on since it was read.
    .eq('status', existing.status)
    .select('id');

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  // No row matched: the claim changed (for example a statement resolved it) after it was read.
  // Stop here, so cancelling cannot unlink lines from a claim that is no longer cancellable.
  if (!changed || changed.length === 0) {
    return NextResponse.json({ error: 'This claim was updated elsewhere. Refresh and try again.' }, { status: 409 });
  }

  // If we're closing this request out, unlink the invoice_lines so they can
  // be re-chased. (Resolved means supplier issued the credit — line is "done".)
  if (update.status === 'cancelled') {
    await supabase
      .from('invoice_lines')
      .update({ credit_request_id: null })
      .eq('credit_request_id', id);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { data: existing, error: fetchError } = await supabase
    .from('credit_requests')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Credit request not found' }, { status: 404 });
  }
  if (existing.status !== 'draft') {
    return NextResponse.json(
      {
        error:
          'Only draft credit requests can be deleted. Use status=cancelled to close out a sent request.',
      },
      { status: 422 }
    );
  }

  // Unlink any lines first
  await supabase
    .from('invoice_lines')
    .update({ credit_request_id: null })
    .eq('credit_request_id', id);

  const { error } = await supabase.from('credit_requests').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
