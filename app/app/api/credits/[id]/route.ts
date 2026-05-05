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

export const runtime = 'nodejs';

const ALLOWED_STATUSES = ['draft', 'sent', 'resolved', 'overdue', 'cancelled'] as const;
type Status = (typeof ALLOWED_STATUSES)[number];

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
    .select('id, status')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Credit request not found' }, { status: 404 });
  }

  const { error: updateError } = await supabase
    .from('credit_requests')
    .update(update)
    .eq('id', id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
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
