import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatementsList from './statements-list';

export default async function StatementsPage() {
  const supabase = await createClient();

  // Fast path: read the denormalised credits_pending_total column added by
  // migration 0008. If the migration hasn't been applied yet, the SELECT
  // errors with "column does not exist" — fall back to the legacy 4-level
  // join. This keeps the page working during the migration window.
  let rows: Array<{
    id: string;
    supplier: string;
    statement_date: string;
    gross_total: number;
    reconciled_count: number;
    unreconciled_count: number;
    credits_pending: number;
  }> | null = null;

  // Attempt fast path
  {
    const r = await supabase
      .from('statements')
      .select(
        `id, supplier, statement_date, gross_total,
         reconciled_count, unreconciled_count, totals_match, credits_pending_total`,
      )
      .is('deleted_at', null)
      .order('statement_date', { ascending: false });

    if (!r.error) {
      rows = (r.data ?? []).map(s => ({
        id: s.id as string,
        supplier: s.supplier as string,
        statement_date: s.statement_date as string,
        gross_total: Number(s.gross_total),
        reconciled_count: s.reconciled_count as number,
        unreconciled_count: s.unreconciled_count as number,
        credits_pending: Number(s.credits_pending_total ?? 0),
      }));
    } else if (!/credits_pending_total/i.test(r.error.message)) {
      return <ErrorState message={r.error.message} />;
    } else {
      // Fall through to legacy path
      console.warn('credits_pending_total column missing — falling back to nested-join roll-up. Apply migration 0008.');
    }
  }

  // Legacy path: deep join + per-row roll-up. Heavy but functional.
  if (rows === null) {
    const r = await supabase
      .from('statements')
      .select(`
        id, supplier, statement_date, gross_total,
        reconciled_count, unreconciled_count, totals_match,
        statement_lines (
          match_status,
          invoices:matched_invoice_id (
            invoice_lines ( gross, flags )
          )
        )
      `)
      .is('deleted_at', null)
      .order('statement_date', { ascending: false });

    if (r.error) return <ErrorState message={r.error.message} />;

    const exceptionFlags = ['short', 'damaged', 'not_received', 'returned'];
    rows = (r.data ?? []).map(s => {
      const matched = (s.statement_lines ?? []).filter(l => l.match_status === 'matched');
      let creditsPending = 0;
      for (const line of matched) {
        const inv = Array.isArray(line.invoices) ? line.invoices[0] : line.invoices;
        if (!inv) continue;
        for (const il of inv.invoice_lines ?? []) {
          if (il.flags.some((f: string) => exceptionFlags.includes(f))) {
            creditsPending += Number(il.gross);
          }
        }
      }
      return {
        id: s.id as string,
        supplier: s.supplier as string,
        statement_date: s.statement_date as string,
        gross_total: Number(s.gross_total),
        reconciled_count: s.reconciled_count as number,
        unreconciled_count: s.unreconciled_count as number,
        credits_pending: creditsPending,
      };
    });
  }

  if (!rows || rows.length === 0) return <EmptyState />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Statements</h1>
          <p className="page-header-subtitle">
            {rows.length} statement{rows.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link href="/upload" className="btn btn-secondary">Upload PDFs</Link>
      </div>

      <StatementsList rows={rows} />
    </div>
  );
}

function EmptyState() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Statements</h1>
          <p className="page-header-subtitle">No statements uploaded yet</p>
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
          <path d="M8 13h8M8 17h6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0, marginBottom: '0.375rem' }}>
          No statements yet
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, marginBottom: '1.5rem' }}>
          Upload a wholesaler statement to reconcile against your deliveries.
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
