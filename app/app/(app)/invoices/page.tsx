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
import { INVOICE_PAGE_SIZE, STATUS_FILTERS, defaultSortDir, type SortKey, type StatusFilter } from './list-params';

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
  const status: StatusFilter = (STATUS_FILTERS as readonly string[]).includes(param('status')) ? param('status') as StatusFilter : 'all';

  const supabase = await getRequestClient();
  let list = supabase
    .from('invoice_receipt_summary')
    .select('id,supplier,invoice_number,invoice_date,gross_total,line_count,full_count,pending_count,issue_count', { count: 'exact' });
  if (supplier !== 'all') list = list.eq('supplier', supplier);
  // Same meaning as Home: still to check = lines not yet recorded, or no lines read.
  if (status === 'open') list = list.or('pending_count.gt.0,line_count.eq.0');
  if (status === 'issues') list = list.gt('issue_count', 0);
  if (status === 'done') list = list.eq('status_rank', 2);
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
    pending_count: inv.pending_count, issue_count: inv.issue_count,
  }));
  const matchCount = pastEnd ? 0 : result.count ?? rows.length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Invoices</h1>
          <p className="page-header-subtitle">{status === 'open'
            ? 'Deliveries still to check. Open one to scan its packs or tick its lines.'
            : 'Every invoice, and how far its delivery has been checked.'}</p>
        </div>
        <Link href="/upload" className="btn btn-secondary">Upload invoices</Link>
      </div>

      <InvoicesList
        rows={rows}
        suppliers={suppliers.map(s => s.supplier)}
        matchCount={matchCount}
        allCount={allCount}
        q={q} supplier={supplier} status={status} sort={sort} dir={dir} page={page}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Invoices</h1>
          <p className="page-header-subtitle">Upload an invoice to start checking deliveries.</p>
        </div>
      </div>
      <div className="card empty-card">
        <h2>No invoices yet</h2>
        <p>Upload a wholesaler invoice and Reckon reads every line, so you can mark what arrived short, damaged or not at all.</p>
        <Link href="/upload" className="btn btn-primary">Upload invoices</Link>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="card notice notice-bad" role="alert">
      <strong>Invoices did not load</strong>
      <p>{message}</p>
    </div>
  );
}
