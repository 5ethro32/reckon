/**
 * POST /api/upload
 *
 * Receives a PDF, runs @reckon/parser, persists to Supabase under the
 * caller's pharmacy.
 *
 * Returns:
 *   { ok: true, documentId, kind, supplier, summary }
 *   { ok: false, error }
 *
 * The user's pharmacy is determined from their first pharmacy_memberships row.
 * RLS enforces that the user can only insert under pharmacies they're a member of.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parsePdf } from '@reckon/parser';
import type { ParsedInvoice, ParsedStatement } from '@reckon/parser';

// Use Node.js runtime (default) — pdf-parse needs Node APIs
export const runtime = 'nodejs';
// Allow up to 60 seconds for parsing large statements
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  }

  // Find the caller's pharmacy
  const { data: memberships } = await supabase
    .from('pharmacy_memberships')
    .select('pharmacy_id')
    .eq('user_id', user.id)
    .limit(1);
  const pharmacyId = memberships?.[0]?.pharmacy_id;
  if (!pharmacyId) {
    return NextResponse.json({ ok: false, error: 'No pharmacy membership' }, { status: 403 });
  }

  // Read the upload
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'No file provided' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Parse
  const result = await parsePdf(buffer);

  if (!result.document) {
    return NextResponse.json({
      ok: false,
      error: result.errors.join('; ') || `Detection failed (supplier=${result.detection.supplier}, kind=${result.detection.kind})`,
    }, { status: 422 });
  }

  // Persist by document kind
  if (result.document.kind === 'invoice') {
    return await persistInvoice(supabase, pharmacyId, result.document, file.name);
  }
  if (result.document.kind === 'statement') {
    return await persistStatement(supabase, pharmacyId, result.document, file.name);
  }

  return NextResponse.json({ ok: false, error: `Unsupported document kind` }, { status: 422 });
}

async function persistInvoice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pharmacyId: string,
  invoice: ParsedInvoice,
  filename: string
) {
  // Upsert by (pharmacy_id, supplier, invoice_number) — uploading the same
  // PDF twice updates rather than duplicates.
  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('pharmacy_id', pharmacyId)
    .eq('supplier', invoice.supplier)
    .eq('invoice_number', invoice.invoiceNumber)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      documentId: existing.id,
      kind: 'invoice',
      supplier: invoice.supplier,
      summary: `Already uploaded — ${invoice.lines.length} lines, £${invoice.grossTotal.toFixed(2)} (showing existing)`,
    });
  }

  // Insert invoice header
  const { data: invoiceRow, error: insertError } = await supabase
    .from('invoices')
    .insert({
      pharmacy_id: pharmacyId,
      supplier: invoice.supplier,
      invoice_number: invoice.invoiceNumber,
      invoice_date: invoice.invoiceDate,
      due_date: invoice.dueDate ?? null,
      po_number: invoice.poNumber ?? null,
      customer_account: invoice.customerAccount ?? null,
      customer_name: invoice.customerName ?? null,
      net_total: invoice.netTotal,
      vat_total: invoice.vatTotal,
      gross_total: invoice.grossTotal,
      totals_match: invoice.totalsMatch,
      warnings: invoice.warnings,
    })
    .select('id')
    .single();

  if (insertError || !invoiceRow) {
    return NextResponse.json({
      ok: false,
      error: `DB insert failed: ${insertError?.message ?? 'unknown'}`,
    }, { status: 500 });
  }

  // Insert lines
  const lineRows = invoice.lines.map((line, idx) => ({
    invoice_id: invoiceRow.id,
    pharmacy_id: pharmacyId,
    line_number: idx + 1,
    supplier_sku: line.supplierSku,
    description: line.description,
    pack_size: line.packSize ?? null,
    qty_ordered: line.qty,
    unit_price: line.unitPrice,
    net: line.net,
    vat_rate: line.vatRate,
    vat_amount: line.vatAmount,
    gross: line.gross,
  }));

  const { error: linesError } = await supabase.from('invoice_lines').insert(lineRows);
  if (linesError) {
    return NextResponse.json({
      ok: false,
      error: `Lines insert failed: ${linesError.message}`,
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    documentId: invoiceRow.id,
    kind: 'invoice',
    supplier: invoice.supplier,
    summary: `${invoice.supplier.toUpperCase()} invoice ${invoice.invoiceNumber} — ${invoice.lines.length} lines, £${invoice.grossTotal.toFixed(2)}`,
  });
}

async function persistStatement(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pharmacyId: string,
  statement: ParsedStatement,
  filename: string
) {
  // Upsert by (pharmacy_id, supplier, statement_date)
  const { data: existing } = await supabase
    .from('statements')
    .select('id')
    .eq('pharmacy_id', pharmacyId)
    .eq('supplier', statement.supplier)
    .eq('statement_date', statement.statementDate)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      documentId: existing.id,
      kind: 'statement',
      supplier: statement.supplier,
      summary: `Already uploaded — ${statement.rows.length} rows, £${statement.totals.total.toFixed(2)} (showing existing)`,
    });
  }

  const { data: statementRow, error: insertError } = await supabase
    .from('statements')
    .insert({
      pharmacy_id: pharmacyId,
      supplier: statement.supplier,
      statement_date: statement.statementDate,
      customer_account: statement.customerAccount ?? null,
      customer_name: statement.customerName ?? null,
      net_total: statement.totals.net,
      vat_total: statement.totals.vat,
      gross_total: statement.totals.total,
      totals_match: statement.totalsMatch,
      warnings: statement.warnings,
    })
    .select('id')
    .single();

  if (insertError || !statementRow) {
    return NextResponse.json({
      ok: false,
      error: `DB insert failed: ${insertError?.message ?? 'unknown'}`,
    }, { status: 500 });
  }

  // Build lookup tables for matching:
  //   1. invoices (by invoice_number) — for INV row matching
  //   2. open credit_requests + their linked invoices — for CRED row matching
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, supplier')
    .eq('pharmacy_id', pharmacyId)
    .eq('supplier', statement.supplier)
    .is('deleted_at', null);

  const invoiceLookup = new Map<string, string>(); // invoice_number → invoice_id
  for (const inv of invoices ?? []) {
    invoiceLookup.set(inv.invoice_number, inv.id);
  }

  // Open credit requests for this supplier — candidates for CRED-row matching
  type OpenCreditRequest = {
    id: string;
    total_amount: number;
    invoice_numbers: string[];  // invoice_numbers covered by this credit_request
  };

  const { data: creditRequestRows } = await supabase
    .from('credit_requests')
    .select(`
      id, total_amount,
      invoice_lines:invoice_lines!credit_request_id ( invoices ( invoice_number ) )
    `)
    .eq('pharmacy_id', pharmacyId)
    .eq('supplier', statement.supplier)
    .in('status', ['sent', 'overdue']);

  const openCredits: OpenCreditRequest[] = (creditRequestRows ?? []).map(
    (cr: { id: string; total_amount: number; invoice_lines: Array<{ invoices: { invoice_number: string } | { invoice_number: string }[] }> }) => {
      const invoiceNumbers = new Set<string>();
      for (const line of cr.invoice_lines) {
        const inv = Array.isArray(line.invoices) ? line.invoices[0] : line.invoices;
        if (inv?.invoice_number) invoiceNumbers.add(inv.invoice_number);
      }
      return {
        id: cr.id,
        total_amount: Number(cr.total_amount),
        invoice_numbers: Array.from(invoiceNumbers),
      };
    }
  );

  // Track which credit_requests have been claimed by a CRED row this run.
  // One CRED row matches one credit_request — first-match-wins.
  const claimedCreditRequestIds = new Set<string>();

  let matched = 0;
  let creditsResolved = 0;

  const lineRows = statement.rows.map((row, idx) => {
    const matchedInvoiceId = invoiceLookup.get(row.documentNumber) ?? null;

    let resolvedCreditRequestId: string | null = null;

    // CRED rows: try to match an open credit_request
    if (row.documentType === 'CRED') {
      // Statements show CRED rows with NEGATIVE totals; absolute value matches credit_request.total_amount
      const creditAbs = Math.abs(Number(row.total));

      // Strategy: prefer a credit_request that
      //   (a) hasn't been claimed yet this run
      //   (b) has matching invoice_number reference if available, AND
      //   (c) has total_amount close to |row.total| (within 1p)
      // Fall back to amount-only match if no reference match.
      let candidate = openCredits.find(cr =>
        !claimedCreditRequestIds.has(cr.id) &&
        cr.invoice_numbers.includes(row.documentNumber) &&
        Math.abs(cr.total_amount - creditAbs) < 0.01
      );
      if (!candidate) {
        candidate = openCredits.find(cr =>
          !claimedCreditRequestIds.has(cr.id) &&
          Math.abs(cr.total_amount - creditAbs) < 0.01
        );
      }
      if (candidate) {
        resolvedCreditRequestId = candidate.id;
        claimedCreditRequestIds.add(candidate.id);
        creditsResolved++;
      }
    }

    if (matchedInvoiceId) matched++;

    return {
      statement_id: statementRow.id,
      pharmacy_id: pharmacyId,
      line_number: idx + 1,
      document_date: row.date,
      document_number: row.documentNumber,
      document_type: row.documentType,
      reference: row.reference ?? null,
      due_date: row.dueDate,
      net: row.net,
      vat: row.vat,
      total: row.total,
      matched_invoice_id: matchedInvoiceId,
      match_confidence: matchedInvoiceId ? 1.0 : null,
      match_status: matchedInvoiceId ? 'matched' : 'unmatched',
      resolved_credit_request_id: resolvedCreditRequestId,
    };
  });

  const { data: insertedLines, error: linesError } = await supabase
    .from('statement_lines')
    .insert(lineRows)
    .select('id, document_type, resolved_credit_request_id');

  if (linesError) {
    return NextResponse.json({
      ok: false,
      error: `Lines insert failed: ${linesError.message}`,
    }, { status: 500 });
  }

  // Close out resolved credit_requests: status='resolved', stamp resolved_at + resolved_via_statement_line_id
  if (insertedLines) {
    for (const line of insertedLines) {
      if (line.resolved_credit_request_id) {
        await supabase
          .from('credit_requests')
          .update({
            status: 'resolved',
            resolved_at: new Date().toISOString(),
            resolved_via_statement_line_id: line.id,
          })
          .eq('id', line.resolved_credit_request_id);
      }
    }
  }

  // Update statement rollup counts
  await supabase
    .from('statements')
    .update({
      reconciled_count: matched,
      unreconciled_count: statement.rows.length - matched,
    })
    .eq('id', statementRow.id);

  return NextResponse.json({
    ok: true,
    documentId: statementRow.id,
    kind: 'statement',
    supplier: statement.supplier,
    summary: `${statement.supplier.toUpperCase()} statement ${statement.statementDate} — ${statement.rows.length} rows (${matched} matched, ${creditsResolved} credits resolved), £${statement.totals.total.toFixed(2)}`,
  });
}
