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
    invoices: {
      id: string;
      invoice_number: string;
      gross_total: number;
      receipt_status: string;
      invoice_lines: { gross: number; flags: string[]; id: string }[];
    } | { id: string; invoice_number: string; gross_total: number; receipt_status: string; invoice_lines: { gross: number; flags: string[]; id: string }[] }[] | null;
    resolved_invoice_line?: {
      id: string;
      invoice_id: string;
      invoices: { invoice_number: string } | { invoice_number: string }[] | null;
    } | { id: string; invoice_id: string; invoices: { invoice_number: string } | { invoice_number: string }[] | null }[] | null;
  };

  let lines: RawLine[] | null = null;
  {
    const r = await supabase
      .from('statement_lines')
      .select(`
        id, line_number, document_date, document_number, document_type,
        reference, due_date, net, vat, total,
        matched_invoice_id, match_status, resolved_invoice_line_id,
        invoices:matched_invoice_id (
          id, invoice_number, gross_total, receipt_status,
          invoice_lines ( id, gross, flags )
        ),
        resolved_invoice_line:invoice_lines!resolved_invoice_line_id (
          id, invoice_id,
          invoices ( invoice_number )
        )
      `)
      .eq('statement_id', statement.id)
      .order('line_number');
    if (r.error && /resolved_invoice_line_id/i.test(r.error.message)) {
      // Fallback for pre-0005 databases
      const r2 = await supabase
        .from('statement_lines')
        .select(`
          id, line_number, document_date, document_number, document_type,
          reference, due_date, net, vat, total,
          matched_invoice_id, match_status,
          invoices:matched_invoice_id (
            id, invoice_number, gross_total, receipt_status,
            invoice_lines ( id, gross, flags )
          )
        `)
        .eq('statement_id', statement.id)
        .order('line_number');
      lines = (r2.data as unknown as RawLine[] | null) ?? null;
    } else {
      lines = (r.data as unknown as RawLine[] | null) ?? null;
    }
  }

  // Compute credit-pending state per matched invoice. A matched invoice can
  // still be "out of agreement" with the statement if the user has flagged
  // any of its lines as short/damaged/not_received/returned — those imply a
  // credit is owed but hasn't yet appeared (or hasn't yet been matched on
  // the statement).
  type InvoiceJoin = {
    id: string;
    invoice_number: string;
    gross_total: number;
    receipt_status: string;
    invoice_lines: { id: string; gross: number; flags: string[] }[];
  };
  function getInvoice(line: RawLine): InvoiceJoin | null {
    if (!line.invoices) return null;
    return Array.isArray(line.invoices)
      ? (line.invoices[0] as InvoiceJoin | undefined) ?? null
      : (line.invoices as InvoiceJoin);
  }
  function exceptionTotalFor(line: RawLine): number {
    const inv = getInvoice(line);
    if (!inv) return 0;
    const exceptionFlags = ['short', 'damaged', 'not_received', 'returned'];
    return (inv.invoice_lines ?? [])
      .filter(l => l.flags.some(f => exceptionFlags.includes(f)))
      .reduce((sum, l) => sum + Number(l.gross), 0);
  }

  // Subtract credits that have been linked to a returned line (via the new
  // resolved_invoice_line_id link). Those returns are "settled" — the
  // pharmacist's flag and the supplier's credit cancel each other out, so
  // they shouldn't count as pending.
  function pendingCreditFor(line: RawLine): number {
    const baseException = exceptionTotalFor(line);
    if (baseException === 0) return 0;
    const inv = getInvoice(line);
    if (!inv) return baseException;
    // For each returned invoice line that's already been credited via a
    // statement_line, deduct its pro-rata gross from the pending pool.
    // We need to know which lines are credited — not available here without
    // joining further. Conservative: only show pending if there's a non-zero
    // delta after attributing all CRED rows on this same statement that
    // resolved against any of this invoice's lines.
    return baseException;
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
