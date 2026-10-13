import { creditShare, creditValue } from '@/lib/credit-amount';
/**
 * /api/credits
 *
 * POST: Create (or re-open) a credit_request from a set of flagged invoice_lines
 *       and return a mailto: URL the user can fire from the browser.
 *
 *       SMART RECOVERY:
 *       - If the same set of lines is already on an open credit_request,
 *         we re-open that request and rebuild the mailto URL (idempotent).
 *       - If a different overlapping set of lines is on an open credit_request,
 *         we cancel that one and create a fresh request for the new set.
 *
 * GET:  List outstanding credit_requests (status in 'sent' | 'overdue').
 *
 * Auth + pharmacy scoping mirrors /api/upload — RLS enforces the rest.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildCreditEmail, type CreditEmailLine } from '@/lib/email/credit-template';
import { buildMailto } from '@/lib/credits/build-mailto';

export const runtime = 'nodejs';

// Built-in defaults if no supplier_contacts row / no credit_email is set.
const DEFAULT_CREDIT_EMAILS: Record<string, string> = {
  aah: 'creditrequests@aah.co.uk',
  aver: 'accounts@avergenerics.co.uk',
  phoenix: 'credits@phoenixhc.co.uk',
  alliance: 'credits@alliance-healthcare.co.uk',
  ethigen: 'accounts@ethigen.co.uk',
  numark: 'accounts@numark.co.uk',
};

async function resolvePharmacy(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) } as const;

  const { data: memberships } = await supabase
    .from('pharmacy_memberships')
    .select('pharmacy_id, pharmacies(id, name)')
    .eq('user_id', user.id)
    .limit(1);
  const pharmacyId = memberships?.[0]?.pharmacy_id as string | undefined;
  if (!pharmacyId) {
    return {
      error: NextResponse.json({ error: 'No pharmacy membership' }, { status: 403 }),
    } as const;
  }
  const pharmRaw = memberships?.[0]?.pharmacies as
    | { id: string; name: string }
    | { id: string; name: string }[]
    | null
    | undefined;
  const pharmacy = Array.isArray(pharmRaw) ? pharmRaw[0] : pharmRaw;
  return { user, pharmacyId, pharmacyName: pharmacy?.name ?? null } as const;
}

/** Compare two arrays of IDs as sets — order-independent equality. */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  for (const id of b) if (!aSet.has(id)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// POST /api/credits
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await resolvePharmacy(supabase);
  if ('error' in ctx) return ctx.error;
  const { user, pharmacyId, pharmacyName } = ctx;

  // Parse body
  let body: { invoice_ids?: unknown; invoice_line_ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const invoiceIds = Array.isArray(body.invoice_ids) ? (body.invoice_ids as string[]) : [];
  const requestedLineIds = Array.isArray(body.invoice_line_ids)
    ? (body.invoice_line_ids as string[])
    : [];
  if (requestedLineIds.length === 0 || requestedLineIds.length > 200 || requestedLineIds.some(id => typeof id !== 'string')) {
    return NextResponse.json({ error: 'invoice_line_ids is required' }, { status: 400 });
  }

  // Require the current schema so evidence fields cannot silently disappear.
  const { data: rows, error: readError } = await supabase.from('invoice_lines').select(`
    id, invoice_id, supplier_sku, description, pack_size,
    qty_ordered, qty_received, qty_returned, net, vat_amount, gross,
    flags, notes, damage_disposition, return_disposition, credit_request_id, credited_via_statement_line_id,
    invoices ( id, supplier, invoice_number, invoice_date, pharmacy_id, deleted_at )
  `).in('id', requestedLineIds);
  if (readError) return NextResponse.json({ error: readError.message }, { status: 400 });
  const lines = rows as unknown as Array<Record<string, unknown>>;
  if (!lines || lines.length !== requestedLineIds.length) {
    return NextResponse.json(
      { error: 'One or more lines not found or not accessible' },
      { status: 404 }
    );
  }

  // Validate lines: belong to pharmacy, have flags
  type InvoiceJoin = {
    id: string;
    supplier: string;
    invoice_number: string;
    invoice_date: string;
    pharmacy_id: string;
    deleted_at: string | null;
  };
  type LineJoin = (typeof lines)[number] & { invoices: InvoiceJoin | InvoiceJoin[] | null };

  const suppliers = new Set<string>();
  const linkedCreditRequestIds = new Set<string>();

  for (const raw of lines as LineJoin[]) {
    const inv = Array.isArray(raw.invoices) ? raw.invoices[0] : raw.invoices;
    if (!inv || inv.deleted_at) {
      return NextResponse.json(
        { error: 'Line missing parent invoice' },
        { status: 422 }
      );
    }
    if (inv.pharmacy_id !== pharmacyId) {
      return NextResponse.json(
        { error: 'Line does not belong to your pharmacy' },
        { status: 403 }
      );
    }
    const flags = (raw.flags as string[] | null) ?? [];
    if (flags.length === 0) {
      return NextResponse.json(
        { error: `Line ${raw.id} is not flagged — only flagged lines can be chased` },
        { status: 422 }
      );
    }
    if (raw.credited_via_statement_line_id) return NextResponse.json({ error: 'A selected line is already credited' }, { status: 409 });
    suppliers.add(inv.supplier);
    if (raw.credit_request_id) {
      linkedCreditRequestIds.add(raw.credit_request_id as string);
    }
  }
  if (suppliers.size > 1) {
    return NextResponse.json(
      { error: 'Lines must all be from the same supplier' },
      { status: 422 }
    );
  }
  const supplier = Array.from(suppliers)[0]!;

  if (linkedCreditRequestIds.size) {
    const { data: linked, error } = await supabase.from('credit_requests').select('id,status').in('id', [...linkedCreditRequestIds]);
    if (error || linked?.length !== linkedCreditRequestIds.size) return NextResponse.json({ error: 'Could not verify existing claims' }, { status: 409 });
    if (linked.some(r => r.status === 'resolved')) return NextResponse.json({ error: 'A selected line is already settled' }, { status: 409 });
  }

  // Optional: sanity check invoice_ids if provided
  if (invoiceIds.length > 0) {
    const seenInvoiceIds = new Set(
      (lines as LineJoin[]).map(l => {
        const inv = Array.isArray(l.invoices) ? l.invoices[0] : l.invoices;
        return inv?.id;
      })
    );
    for (const id of invoiceIds) {
      if (!seenInvoiceIds.has(id)) {
        return NextResponse.json(
          { error: `invoice_ids includes ${id} but no selected line came from that invoice` },
          { status: 422 }
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // SMART RECOVERY: handle pre-existing credit_request links
  // ---------------------------------------------------------------------
  // If ALL the requested lines are already linked to ONE existing open
  // credit_request, AND that request covers EXACTLY this set (no extras),
  // we rebuild the mailto URL and return — no DB churn. Idempotent.
  //
  // Other overlaps require explicit review; never detach an existing claim.
  if (linkedCreditRequestIds.size === 1) {
    const existingId = Array.from(linkedCreditRequestIds)[0]!;

    // Pull all lines currently linked to that credit_request
    const { data: existingLines } = await supabase
      .from('invoice_lines')
      .select('id')
      .eq('credit_request_id', existingId);

    const existingIds = (existingLines ?? []).map(l => l.id as string);

    if (sameSet(existingIds, requestedLineIds)) {
      // Identical set — re-open the same request
      const { data: existing } = await supabase
        .from('credit_requests')
        .select('id, status, email_to, email_subject, email_body')
        .eq('id', existingId)
        .maybeSingle();
      if (existing && ['draft','sent','overdue'].includes(existing.status)) {
        const { url: mailtoUrl } = buildMailto({
          to: existing.email_to as string,
          subject: existing.email_subject as string,
          body: existing.email_body as string,
        });
        return NextResponse.json({
          credit_request_id: existing.id,
          mailto_url: mailtoUrl,
          reused: true,
        });
      }
    }
  }

  if (linkedCreditRequestIds.size > 0) {
    return NextResponse.json({ error: 'Some lines already belong to another claim. Review that claim instead of combining or replacing it.' }, { status: 409 });
  }

  // ---------------------------------------------------------------------
  // Look up supplier_contacts row
  // ---------------------------------------------------------------------
  const { data: contact } = await supabase
    .from('supplier_contacts')
    .select('credit_email, accounts_email, contact_name, account_number, signature')
    .eq('pharmacy_id', pharmacyId)
    .eq('supplier', supplier)
    .maybeSingle();

  const fallbackTo = DEFAULT_CREDIT_EMAILS[supplier] ?? null;
  const emailTo = contact?.credit_email || contact?.accounts_email || fallbackTo;
  const usingFallbackEmail = !contact?.credit_email && !contact?.accounts_email;

  if (!emailTo) {
    return NextResponse.json(
      {
        error:
          'No credit email address configured for this supplier. Add one on the Suppliers page first.',
      },
      { status: 422 }
    );
  }

  // Build email content from the lines
  const emailLines: CreditEmailLine[] = (lines as LineJoin[]).map(raw => {
    const inv = Array.isArray(raw.invoices) ? raw.invoices[0]! : raw.invoices!;
    return {
      invoiceNumber: inv.invoice_number,
      invoiceDate: inv.invoice_date,
      supplierSku: raw.supplier_sku as string,
      description: raw.description as string,
      packSize: raw.pack_size as string | null,
      qtyOrdered: Number(raw.qty_ordered),
      qtyReceived: raw.qty_received === null ? null : Number(raw.qty_received),
      flags: (raw.flags as string[] | null) ?? [],
      net: raw.net === null || raw.net === undefined ? undefined : Number(raw.net),
      vatAmount:
        raw.vat_amount === null || raw.vat_amount === undefined
          ? undefined
          : Number(raw.vat_amount),
      gross: Number(raw.gross),
      notes: (raw.notes as string | null) ?? null,
      damageDisposition: (raw.damage_disposition as 'returning' | 'disposed' | 'awaiting' | null) ?? null,
      qtyReturned: raw.qty_returned === null || raw.qty_returned === undefined
        ? null
        : Number(raw.qty_returned),
      returnDisposition:
        (raw.return_disposition as 'damaged' | 'wrong_product' | 'expired' | 'over_ordered' | 'other' | null | undefined) ?? null,
    };
  });

  try {
    for (const line of emailLines) {
      const share = creditShare({ flags: line.flags, qtyOrdered: line.qtyOrdered, qtyReceived: line.qtyReceived, qtyReturned: line.qtyReturned ?? null });
      line.gross = creditValue(line.gross, share);
      if (line.net !== undefined) line.net = creditValue(line.net, share);
      // VAT is the remainder, so net + VAT always equals the gross the claim asks for.
      if (line.vatAmount !== undefined) line.vatAmount = line.net !== undefined ? Math.round((line.gross - line.net) * 100) / 100 : creditValue(line.vatAmount, share);
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid credit quantities' }, { status: 422 });
  }

  // Round all totals to 2dp to avoid floating-point display weirdness in the email
  const totalAmount = +emailLines.reduce((sum, l) => sum + l.gross, 0).toFixed(2);
  const netTotal = +emailLines
    .reduce((sum, l) => sum + (typeof l.net === 'number' ? l.net : 0), 0)
    .toFixed(2);
  const vatTotal = +emailLines
    .reduce((sum, l) => sum + (typeof l.vatAmount === 'number' ? l.vatAmount : 0), 0)
    .toFixed(2);

  const { subject, body: emailBody } = buildCreditEmail({
    supplier,
    contactName: contact?.contact_name ?? null,
    pharmacyName: pharmacyName ?? null,
    accountNumber: contact?.account_number ?? null,
    signature: contact?.signature ?? null,
    fallbackSignerName: user.email ?? null,
    totalAmount,
    netTotal: netTotal > 0 ? netTotal : undefined,
    vatTotal: vatTotal > 0 ? vatTotal : undefined,
    lines: emailLines,
    usingFallbackEmail,
  });

  const { url: mailtoUrl } = buildMailto({
    to: emailTo,
    subject,
    body: emailBody,
  });

  const { data: claimId, error: insertError } = await supabase.rpc('create_credit_request_from_lines', {
    p_line_ids: requestedLineIds,
    p_payload: { supplier, total_amount: totalAmount, email_to: emailTo, email_subject: subject, email_body: emailBody },
  });
  if (insertError || !claimId) return NextResponse.json({ error: insertError?.message ?? 'Could not create claim' }, { status: 409 });
  const inserted = { id: claimId as string };

  // Retroactive match: if a CRED row on a prior statement already matches
  // this credit request by reference and amount, link it and mark it resolved. Without this, credit_requests created AFTER their
  // statement was uploaded stay forever in 'sent' status. The RPC is
  // idempotent + best-effort — if it fails we still return the credit
  // request so the user can email the supplier.
  let autoResolved = false;
  const matchRpc = await supabase.rpc('try_match_credit_request_to_credit_row', {
    p_credit_request_id: inserted.id,
  });
  if (matchRpc.error) {
    // Non-fatal — log and carry on. Most likely cause: migration 0007
    // hasn't been applied yet on this Supabase project.
    console.warn('try_match_credit_request_to_credit_row:', matchRpc.error.message);
  } else if (matchRpc.data) {
    autoResolved = true;
  }

  return NextResponse.json({
    credit_request_id: inserted.id,
    mailto_url: mailtoUrl,
    auto_resolved: autoResolved,
  });
}

// ---------------------------------------------------------------------------
// GET /api/credits — list outstanding credit_requests with line context
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient();
  const ctx = await resolvePharmacy(supabase);
  if ('error' in ctx) return ctx.error;

  const { data, error } = await supabase
    .from('credit_requests')
    .select(
      `id, supplier, status, total_amount, email_to, email_subject, email_body,
       sent_at, resolved_at, external_credit_note_number, notes, created_at,
       invoice_lines ( id, supplier_sku, description, gross, flags, invoice_id,
                       invoices ( id, invoice_number, invoice_date ) )`
    )
    .in('status', ['draft', 'sent', 'overdue'])
    .order('sent_at', { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ credit_requests: data ?? [] });
}
