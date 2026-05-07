import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatementDetailTable, { type StatementDetailRow } from './statement-detail-table';

const supplierLabels: Record<string, string> = {
  aah: 'AAH', aver: 'Aver', phoenix: 'Phoenix',
  alliance: 'Alliance', ethigen: 'Ethigen', numark: 'Numark',
};

export default async function StatementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: statement, error } = await supabase
    .from('statements')
    .select('id, supplier, statement_date, customer_account, customer_name, net_total, vat_total, gross_total, totals_match, warnings')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !statement) notFound();

  // We try the full SELECT (with the credit→line link from migration 0005)
  // first; if that column doesn't exist yet we fall back to the pre-0005
  // shape so the page still renders.
  type RawLine = {
    id: string;
    line_number: number;
    document_date: string;
    document_number: string;
    document_type: string;
    reference: string | null;
    due_date: string;
    net: number;
    vat: number;
    total: number;
    matched_invoice_id: string | null;
    match_status: string;
    resolved_invoice_line_id?: string | null;
    resolved_credit_request_id?: string | null;
    invoices: {
      id: string;
      invoice_number: string;
      gross_total: number;
      receipt_status: string;
      invoice_lines: {
        id: string;
        gross: number;
        flags: string[];
        credited_via_statement_line_id?: string | null;
        credit_request_id?: string | null;
      }[];
    } | {
      id: string;
      invoice_number: string;
      gross_total: number;
      receipt_status: string;
      invoice_lines: {
        id: string;
        gross: number;
        flags: string[];
        credited_via_statement_line_id?: string | null;
        credit_request_id?: string | null;
      }[];
    }[] | null;
    resolved_invoice_line?: {
      id: string;
      invoice_id: string;
      invoices: { invoice_number: string } | { invoice_number: string }[] | null;
    } | { id: string; invoice_id: string; invoices: { invoice_number: string } | { invoice_number: string }[] | null }[] | null;
    resolved_credit_request?: {
      id: string;
      total_amount: number;
      invoice_lines: { invoices: { invoice_number: string } | { invoice_number: string }[] | null }[];
    } | { id: string; total_amount: number; invoice_lines: { invoices: { invoice_number: string } | { invoice_number: string }[] | null }[] }[] | null;
  };

  let lines: RawLine[] | null = null;
  {
    // Pull everything we need to compute pending credit accurately:
    //   - each matched invoice's lines + their credit_request_id +
    //     credited_via_statement_line_id (so we can filter out resolved ones)
    //   - each CRED row's resolved_credit_request_id (to surface in UI)
    //   - the linked credit_request's invoice numbers (so we can show
    //     "Resolved → 41489885W" sub-badge on the CRED row)
    const r = await supabase
      .from('statement_lines')
      .select(`
        id, line_number, document_date, document_number, document_type,
        reference, due_date, net, vat, total,
        matched_invoice_id, match_status,
        resolved_invoice_line_id, resolved_credit_request_id,
        invoices:matched_invoice_id (
          id, invoice_number, gross_total, receipt_status,
          invoice_lines (
            id, gross, flags,
            credited_via_statement_line_id, credit_request_id
          )
        ),
        resolved_invoice_line:invoice_lines!resolved_invoice_line_id (
          id, invoice_id,
          invoices ( invoice_number )
        ),
        resolved_credit_request:credit_requests!resolved_credit_request_id (
          id, total_amount,
          invoice_lines:invoice_lines!credit_request_id (
            invoices ( invoice_number )
          )
        )
      `)
      .eq('statement_id', statement.id)
      .order('line_number');
    if (r.error && /resolved_invoice_line_id|credited_via_statement_line_id/i.test(r.error.message)) {
      // Fallback for pre-0005 databases
      const r2 = await supabase
        .from('statement_lines')
        .select(`
          id, line_number, document_date, document_number, document_type,
          reference, due_date, net, vat, total,
          matched_invoice_id, match_status,
          resolved_credit_request_id,
          invoices:matched_invoice_id (
            id, invoice_number, gross_total, receipt_status,
            invoice_lines ( id, gross, flags, credit_request_id )
          )
        `)
        .eq('statement_id', statement.id)
        .order('line_number');
      lines = (r2.data as unknown as RawLine[] | null) ?? null;
    } else {
      lines = (r.data as unknown as RawLine[] | null) ?? null;
    }
  }

  // Compute credit-pending state per matched invoice.
  //
  // A line is *truly pending* (the supplier still owes us a credit) when:
  //   - it has an exception flag (short/damaged/not_received/returned), AND
  //   - it has NOT been credited via a statement row directly
  //     (credited_via_statement_line_id is null), AND
  //   - it is NOT attached to a credit_request that has been resolved
  //
  // We need to cross-reference invoice_lines against credit_requests
  // resolved on this same statement. Build a set of credit_request_ids
  // that ARE resolved on this statement, then exclude lines whose
  // credit_request_id is in that set.
  type InvoiceLine = {
    id: string;
    gross: number;
    flags: string[];
    credited_via_statement_line_id?: string | null;
    credit_request_id?: string | null;
  };
  type InvoiceJoin = {
    id: string;
    invoice_number: string;
    gross_total: number;
    receipt_status: string;
    invoice_lines: InvoiceLine[];
  };

  function getInvoice(line: RawLine): InvoiceJoin | null {
    if (!line.invoices) return null;
    return Array.isArray(line.invoices)
      ? (line.invoices[0] as InvoiceJoin | undefined) ?? null
      : (line.invoices as InvoiceJoin);
  }

  // Build a set of credit_request_ids resolved on THIS statement (or any
  // earlier statement we know about — but we only have access to this
  // statement's CRED rows here, and a credit_request can only resolve once,
  // so this is sufficient for the on-page calculation).
  const resolvedCreditRequestIds = new Set<string>();
  for (const l of lines ?? []) {
    if (l.resolved_credit_request_id) resolvedCreditRequestIds.add(l.resolved_credit_request_id);
  }

  function pendingCreditFor(line: RawLine): number {
    const inv = getInvoice(line);
    if (!inv) return 0;
    const exceptionFlags = ['short', 'damaged', 'not_received', 'returned'];
    return (inv.invoice_lines ?? [])
      .filter(l => {
        // Must have an exception flag
        if (!l.flags.some(f => exceptionFlags.includes(f))) return false;
        // If already credited via a statement row directly, not pending
        if (l.credited_via_statement_line_id) return false;
        // If linked to a credit_request that's been resolved on this
        // statement, also not pending
        if (l.credit_request_id && resolvedCreditRequestIds.has(l.credit_request_id)) {
          return false;
        }
        return true;
      })
      .reduce((sum, l) => sum + Number(l.gross), 0);
  }

  const allLines = lines ?? [];
  const matchedLines = allLines.filter(l => l.match_status === 'matched');
  const unmatchedLines = allLines.filter(l => l.match_status === 'unmatched' && l.document_type === 'INV');
  const creditLines = allLines.filter(l => l.document_type === 'CRED');
  const matchedSum = matchedLines.reduce((s, l) => s + Number(l.total), 0);
  const variance = Number(statement.gross_total) - matchedSum - creditLines.reduce((s, l) => s + Number(l.total), 0);

  // How many matched invoices have pending credits (delta against statement)
  const creditsPendingLines = matchedLines.filter(l => pendingCreditFor(l) > 0);
  const creditsPendingTotal = creditsPendingLines.reduce((s, l) => s + pendingCreditFor(l), 0);

  // Normalise raw rows into a shape the client component can consume.
  const rows: StatementDetailRow[] = allLines.map(l => {
    const inv = getInvoice(l);
    const resolvedLineRaw = Array.isArray(l.resolved_invoice_line)
      ? l.resolved_invoice_line[0]
      : l.resolved_invoice_line;
    const resolvedLineInvoice = resolvedLineRaw
      ? Array.isArray(resolvedLineRaw.invoices)
        ? resolvedLineRaw.invoices[0]
        : resolvedLineRaw.invoices
      : null;

    // For CRED rows resolved against a credit_request, pull out the first
    // invoice number on that credit_request — most credit requests cover
    // a single invoice in practice; if multi-invoice we just show the
    // first as the primary link.
    const resolvedCRRaw = Array.isArray(l.resolved_credit_request)
      ? l.resolved_credit_request[0]
      : l.resolved_credit_request;
    const resolvedCRInvoiceNumber: string | null = (() => {
      if (!resolvedCRRaw) return null;
      const firstLine = resolvedCRRaw.invoice_lines?.[0];
      if (!firstLine) return null;
      const inv = Array.isArray(firstLine.invoices) ? firstLine.invoices[0] : firstLine.invoices;
      return inv?.invoice_number ?? null;
    })();

    return {
      id: l.id,
      document_date: l.document_date,
      document_number: l.document_number,
      document_type: l.document_type,
      total: Number(l.total),
      match_status: l.match_status,
      matched_invoice_id: l.matched_invoice_id,
      matched_invoice_number: inv?.invoice_number ?? null,
      pending_credit: l.match_status === 'matched' ? pendingCreditFor(l) : 0,
      resolved_invoice_id: resolvedLineRaw?.invoice_id ?? null,
      resolved_invoice_number: resolvedLineInvoice?.invoice_number ?? null,
      resolved_credit_request_id: l.resolved_credit_request_id ?? null,
      resolved_credit_request_invoice_number: resolvedCRInvoiceNumber,
    };
  });

  const warnings = statement.warnings as string[];

  const varianceIsHealthy = Math.abs(variance) <= 0.05;

  return (
    <div>
      <Link
        href="/statements"
        style={{
          fontSize: '12px',
          color: 'var(--muted)',
          textDecoration: 'none',
          marginBottom: '1rem',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
        }}
      >
        <span aria-hidden style={{ fontSize: '14px', lineHeight: 1 }}>←</span>
        Back to statements
      </Link>

      <div className="card" style={{ padding: '1.5rem 1.75rem', marginBottom: '1.5rem' }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '1.75rem',
          gap: '1.5rem',
        }}>
          <div>
            <p className="section-label" style={{ marginBottom: '0.5rem' }}>
              {supplierLabels[statement.supplier] ?? statement.supplier} statement
            </p>
            <h1 style={{
              fontSize: '22px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              margin: 0,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {new Date(statement.statement_date).toLocaleDateString('en-GB')}
            </h1>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{
              fontSize: '26px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.1,
              margin: 0,
            }}>
              £{Number(statement.gross_total).toFixed(2)}
            </p>
            <p style={{
              fontSize: '11px',
              color: 'var(--muted)',
              margin: 0,
              marginTop: '0.25rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}>
              Statement total
            </p>
          </div>
        </div>

        <div className="stat-grid">
          <Stat label="Total rows" value={String(allLines.length)} />
          <Stat
            label="Matched"
            value={String(matchedLines.length)}
            color="var(--status-success-text)"
          />
          <Stat
            label="Unmatched"
            value={String(unmatchedLines.length)}
            color={unmatchedLines.length > 0 ? 'var(--status-warning-text)' : undefined}
          />
          <Stat
            label="Credits pending"
            value={
              creditsPendingLines.length > 0
                ? `${creditsPendingLines.length} · £${creditsPendingTotal.toFixed(2)}`
                : '—'
            }
            color={creditsPendingLines.length > 0 ? 'var(--status-warning-text)' : undefined}
          />
          <Stat
            label="Variance"
            value={`£${variance.toFixed(2)}`}
            color={varianceIsHealthy ? 'var(--status-success-text)' : 'var(--status-warning-text)'}
          />
        </div>

        {warnings.length > 0 && (
          <details style={{ marginTop: '1.5rem' }}>
            <summary style={{ fontSize: '11px', color: 'var(--muted)', cursor: 'pointer' }}>
              Parser warnings ({warnings.length})
            </summary>
            <ul style={{
              margin: '0.625rem 0 0 0',
              padding: '0 0 0 1rem',
              fontSize: '11px',
              color: 'var(--muted)',
              lineHeight: 1.6,
            }}>
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </details>
        )}
      </div>

      <h2 style={{
        fontSize: '15px',
        fontWeight: 600,
        margin: 0,
        marginBottom: '0.75rem',
        letterSpacing: '-0.005em',
      }}>
        Reconciliation
      </h2>
      <StatementDetailTable rows={rows} />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="stat-block">
      <p className="stat-block-label">{label}</p>
      <p className="stat-block-value" style={{ color: color ?? 'var(--foreground)' }}>
        {value}
      </p>
    </div>
  );
}
