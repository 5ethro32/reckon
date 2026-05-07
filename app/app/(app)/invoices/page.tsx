/**
 * Deliveries page — list of uploaded invoices.
 *
 * Status badge is computed from line states (full vs exception count) so it
 * stays in sync with tick-off interactions without needing a separate
 * invoice-level status update.
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import InvoicesList, { type InvoiceRow } from './invoices-list';

export default async function InvoicesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('invoices')
    .select(`
      id, supplier, invoice_number, invoice_date, gross_total, totals_match,
      invoice_lines ( flags )
    `)
    .is('deleted_at', null)
    .order('invoice_date', { ascending: false });

  if (error) return <ErrorState message={error.message} />;
  const raw = data ?? [];
  if (raw.length === 0) return <EmptyState />;

  const rows: InvoiceRow[] = raw.map(inv => {
    const lineCount = inv.invoice_lines.length;
    const fullCount = inv.invoice_lines.filter((l: { flags: string[] }) => l.flags.length === 0).length;
    const exceptionCount = lineCount - fullCount;
    return {
      id: inv.id,
      supplier: inv.supplier,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      gross_total: Number(inv.gross_total),
      line_count: lineCount,
      full_count: fullCount,
      exception_count: exceptionCount,
    };
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Deliveries</h1>
          <p className="page-header-subtitle">
            {raw.length} invoice{raw.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link href="/upload" className="btn btn-secondary">Upload PDFs</Link>
      </div>

      <InvoicesList rows={rows} />
    </div>
  );
}

function EmptyState() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Deliveries</h1>
          <p className="page-header-subtitle">Upload an invoice to start reconciling</p>
        </div>
      </div>
      <div style={{
        textAlign: 'center',
        padding: '4rem 1.5rem',
        border: '1.5px dashed var(--border-subtle)',
        borderRadius: '0.75rem',
        background: 'var(--card-bg)',
      }}>
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted-light)"
          strokeWidth="1.5"
          style={{ marginBottom: '0.875rem' }}
          aria-hidden
        >
          <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 3v6h6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0, marginBottom: '0.375rem' }}>
          No deliveries yet
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '0 auto 1.5rem', maxWidth: '24rem', lineHeight: 1.5 }}>
          Upload a wholesaler invoice PDF and Reckon will pull out every
          line so you can flag what didn’t arrive or arrived broken.
        </p>
        <Link href="/upload" className="btn btn-primary">Upload PDFs</Link>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{
      padding: '1rem 1.25rem',
      borderRadius: '0.5rem',
      background: 'var(--status-critical-bg)',
      border: '1px solid var(--status-critical-border)',
      color: 'var(--status-critical-text)',
    }}>
      <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>Something went wrong</p>
      <p style={{ fontSize: '12px', margin: 0, marginTop: '0.25rem' }}>{message}</p>
    </div>
  );
}
