/**
 * Invoice detail — header card + lines table with tick-off UI.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import LinesEditor from './lines-editor';

const supplierLabels: Record<string, string> = {
  aah: 'AAH', aver: 'Aver', phoenix: 'Phoenix',
  alliance: 'Alliance', ethigen: 'Ethigen', numark: 'Numark',
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(`
      id, supplier, invoice_number, invoice_date, due_date, po_number,
      customer_account, customer_name, net_total, vat_total, gross_total,
      totals_match, receipt_status, warnings
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !invoice) notFound();

  const { data: lines } = await supabase
    .from('invoice_lines')
    .select(`
      id, line_number, supplier_sku, description, pack_size,
      qty_ordered, qty_received, qty_returned,
      unit_price, net, vat_rate, vat_amount, gross,
      flags, notes,
      damage_disposition, return_disposition,
      credited_via_statement_line_id
    `)
    .eq('invoice_id', invoice.id)
    .order('line_number');

  const warnings = invoice.warnings as string[];

  // Header summary computed from line states — keeps header in sync with
  // tick-off interactions without needing a separate invoice.receipt_status update.
  const allLines = lines ?? [];
  const fullCount = allLines.filter(l => (l.flags as string[]).length === 0).length;
  const exceptionCount = allLines.length - fullCount;
  const allFull = allLines.length > 0 && exceptionCount === 0;
  const headerStatusLabel = allLines.length === 0
    ? 'Pending'
    : allFull
    ? 'All received'
    : `${fullCount} of ${allLines.length} received`;
  const headerStatusClass = allLines.length === 0
    ? 'badge badge-neutral'
    : allFull
    ? 'badge badge-success'
    : 'badge badge-warning';

  return (
    <div>
      <Link
        href="/invoices"
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
        Back to deliveries
      </Link>

      {/* Invoice header card */}
      <div className="card" style={{ padding: '1.5rem 1.75rem', marginBottom: '1.5rem' }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
          gap: '1.5rem',
        }}>
          <div>
            <p className="section-label" style={{ marginBottom: '0.5rem' }}>
              {supplierLabels[invoice.supplier] ?? invoice.supplier} invoice
            </p>
            <h1 style={{
              fontSize: '22px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              margin: 0,
              marginBottom: '0.625rem',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {invoice.invoice_number}
            </h1>
            <span className={headerStatusClass}>{headerStatusLabel}</span>
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
              £{Number(invoice.gross_total).toFixed(2)}
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
              Gross total
            </p>
          </div>
        </div>

        <dl style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.625rem 2rem',
          margin: 0,
        }}>
          <DefRow label="Invoice date" value={new Date(invoice.invoice_date).toLocaleDateString('en-GB')} />
          <DefRow label="Due date" value={invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('en-GB') : '—'} />
          <DefRow label="PO number" value={invoice.po_number ?? '—'} />
          <DefRow label="Account" value={invoice.customer_account ?? '—'} />
          <DefRow label="Net" value={`£${Number(invoice.net_total).toFixed(2)}`} />
          <DefRow label="VAT" value={`£${Number(invoice.vat_total).toFixed(2)}`} />
        </dl>

        {!invoice.totals_match && (
          <div style={{
            marginTop: '1.25rem',
            padding: '0.75rem 0.875rem',
            borderRadius: '0.5rem',
            background: 'var(--status-warning-bg)',
            border: '1px solid var(--status-warning-border)',
            color: 'var(--status-warning-text)',
            fontSize: '12px',
            lineHeight: 1.5,
          }}>
            <strong style={{ fontWeight: 600 }}>Totals mismatch.</strong> Line sums don&apos;t match the printed total — review carefully.
          </div>
        )}

        {warnings.length > 0 && (
          <details style={{ marginTop: '1.25rem' }}>
            <summary style={{
              fontSize: '11px',
              color: 'var(--muted)',
              cursor: 'pointer',
            }}>
              Parser warnings ({warnings.length})
            </summary>
            <ul style={{
              margin: '0.625rem 0 0 0',
              padding: '0 0 0 1rem',
              fontSize: '11px',
              color: 'var(--muted)',
              listStyle: 'disc',
              lineHeight: 1.6,
            }}>
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </details>
        )}
      </div>

      {/* Lines tick-off + sticky action bar */}
      {lines && <LinesEditor invoiceId={invoice.id} initialLines={lines} />}
    </div>
  );
}

function DefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="def-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
