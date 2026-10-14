/**
 * Deliveries page — list of uploaded invoices.
 *
 * Status badge is computed from line states (full vs exception count) so it
 * stays in sync with tick-off interactions without needing a separate
 * invoice-level status update.
 *
 * Search, supplier filter, sort and paging run in the database against the
 * invoice_receipt_summary view (migration 0018), so the page reads one page
 * of invoices with their counts rather than every invoice and line.
 */

import Link from 'next/link';
import { getRequestClient } from '@/lib/session';
import InvoicesList, { type InvoiceRow } from './invoices-list';
import { INVOICE_PAGE_SIZE, defaultSortDir, type SortKey } from './list-params';

const sortColumns: Record<SortKey, string> = {
  date: 'invoice_date', supplier: 'supplier', invoice: 'invoice_number', total: 'gross_total', status: 'status_rank',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const param = (key: string) => { const v = sp[key]; return typeof v === 'string' ? v : ''; };
  const q = param('q').trim().slice(0, 100);
  const supplier = param('supplier') || 'all';
  const sort: SortKey = Object.hasOwn(sortColumns, param('sort')) ? param('sort') as SortKey : 'date';
  const dir = param('dir') === 'asc' || param('dir') === 'desc' ? param('dir') as 'asc' | 'desc' : defaultSortDir(sort);
  const page = Math.max(1, Math.floor(Number(param('page'))) || 1);

  const supabase = await getRequestClient();
  let list = supabase
    .from('invoice_receipt_summary')
    .select('id,supplier,invoice_number,invoice_date,gross_total,line_count,full_count', { count: 'exact' });
  if (supplier !== 'all') list = list.eq('supplier', supplier);
  // search_text is lower-case; escape LIKE wildcards so they match literally.
  if (q) list = list.ilike('search_text', `%${q.toLowerCase().replace(/[\\%_]/g, m => '\\' + m)}%`);
  list = list.order(sortColumns[sort], { ascending: dir === 'asc' });
  if (sort !== 'date') list = list.order('invoice_date', { ascending: false });
  // id follows the date direction so the default sort reads idx_invoices_live_date either way.
  list = list.order('id', { ascending: sort === 'date' ? dir === 'asc' : false }).range((page - 1) * INVOICE_PAGE_SIZE, page * INVOICE_PAGE_SIZE - 1);

  const [result, supplierResult] = await Promise.all([
    list,
    supabase.from('invoice_supplier_counts').select('supplier,invoice_count'),
  ]);
  // A page past the end is an empty page, not an error.
  const pastEnd = result.error?.code === 'PGRST103';
  if ((result.error && !pastEnd) || supplierResult.error) {
    return <ErrorState message="Could not load invoices and receipt lines. Refresh to try again; no partial totals are shown." />;
  }

  const suppliers = supplierResult.data ?? [];
  const allCount = suppliers.reduce((n, s) => n + Number(s.invoice_count), 0);
  if (!allCount) return <EmptyState />;

  const rows: InvoiceRow[] = (pastEnd ? [] : result.data ?? []).map(inv => ({
    id: inv.id, supplier: inv.supplier, invoice_number: inv.invoice_number,
    invoice_date: inv.invoice_date, gross_total: Number(inv.gross_total),
    line_count: inv.line_count, full_count: inv.full_count, exception_count: inv.line_count - inv.full_count,
  }));
  const matchCount = pastEnd ? 0 : result.count ?? rows.length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Invoices &amp; checks</h1>
          <p className="page-header-subtitle">
            {allCount} invoice{allCount === 1 ? '' : 's'}
          </p>
        </div>
        <Link href="/upload" className="btn btn-secondary">Upload PDFs</Link>
      </div>

      <InvoicesList
        rows={rows}
        suppliers={suppliers.map(s => s.supplier)}
        matchCount={matchCount}
        allCount={allCount}
        q={q} supplier={supplier} sort={sort} dir={dir} page={page}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Invoices &amp; checks</h1>
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
          No invoices yet
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
