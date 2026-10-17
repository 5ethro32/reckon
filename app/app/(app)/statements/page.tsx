import Link from 'next/link';
import { getRequestClient } from '@/lib/session';
import StatementsList from './statements-list';
import { Figure, money, shortDate } from '../ui';

export default async function StatementsPage() {
  const supabase = await getRequestClient();

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

  // What is still owed: credits pending on matched invoices, and statement
  // lines not yet matched to an invoice.
  const owed = rows.reduce((n, r) => n + r.credits_pending, 0);
  const owedOn = rows.filter(r => r.credits_pending > 0).length;
  const unmatched = rows.reduce((n, r) => n + r.unreconciled_count, 0);
  const unmatchedOn = rows.filter(r => r.unreconciled_count > 0).length;
  const latest = rows[0]!;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Statements</h1>
          <p className="page-header-subtitle">Each statement lined up against your invoices, and the credits still owed.</p>
        </div>
        <Link href="/upload" className="btn btn-secondary">Upload statements</Link>
      </div>

      <section className="figures" aria-label="Across all statements">
        <Figure
          label="Still owed to you"
          value={money(owed)}
          line={owed > 0 ? `Credits pending on ${owedOn} statement${owedOn === 1 ? '' : 's'}` : 'No credits pending'}
        />
        <Figure
          label="Lines not matched"
          value={String(unmatched)}
          line={unmatched > 0 ? `On ${unmatchedOn} statement${unmatchedOn === 1 ? '' : 's'}` : 'Every line matches an invoice'}
        />
        <Figure
          label="Latest statement"
          value={shortDate(latest.statement_date)}
          line={`${rows.length} statement${rows.length === 1 ? '' : 's'} in all`}
        />
      </section>

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
          <p className="page-header-subtitle">Upload a statement to check what you are being billed.</p>
        </div>
      </div>
      <div className="card empty-card">
        <h2>No statements yet</h2>
        <p>Upload a wholesaler statement and Reckon lines it up against your invoices, so a missed credit stands out.</p>
        <Link href="/upload" className="btn btn-primary">Upload statements</Link>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="card notice" role="alert">
      <strong>Statements did not load</strong>
      <p>{message}</p>
    </div>
  );
}
