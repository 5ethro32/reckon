'use client';

/**
 * Deliveries list — filter bar, sortable headers and one row per invoice.
 *
 * Search, supplier, status, sort and page live in the URL and the server
 * filters and pages the invoices, so the browser only ever holds one page.
 * On phones each row reads as two lines (globals.css, .table.rows).
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FilterBar, type SupplierOption } from '../filter-bar';
import { Status, SupplierTag, money, shortDate, supplierLabel, type Tone } from '../ui';
import { INVOICE_PAGE_SIZE, defaultSortDir, type SortDir, type SortKey, type StatusFilter } from './list-params';

export type InvoiceRow = {
  id: string;
  supplier: string;
  invoice_number: string;
  invoice_date: string;          // YYYY-MM-DD
  gross_total: number;
  line_count: number;
  full_count: number;
  exception_count: number;
  pending_count: number;
  issue_count: number;
};

type ListState = { q: string; supplier: string; status: StatusFilter; sort: SortKey; dir: SortDir; page: number };

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'Any status', open: 'Still to check', issues: 'With issues', done: 'All received',
};

function listHref(pathname: string, s: ListState): string {
  const params = new URLSearchParams();
  if (s.q.trim()) params.set('q', s.q.trim());
  if (s.supplier !== 'all') params.set('supplier', s.supplier);
  if (s.status !== 'all') params.set('status', s.status);
  if (s.sort !== 'date') params.set('sort', s.sort);
  if (s.dir !== defaultSortDir(s.sort)) params.set('dir', s.dir);
  if (s.page > 1) params.set('page', String(s.page));
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Where an invoice's check stands, as one dot and a few words. */
function receiptStatus(inv: InvoiceRow): { tone: Tone; label: string } {
  if (inv.line_count === 0) return { tone: 'neutral', label: 'No lines read' };
  if (inv.issue_count > 0) return { tone: 'warn', label: `${inv.issue_count} issue${inv.issue_count === 1 ? '' : 's'}` };
  if (inv.pending_count === inv.line_count) return { tone: 'neutral', label: 'To check' };
  if (inv.pending_count > 0) return { tone: 'neutral', label: `${inv.line_count - inv.pending_count} of ${inv.line_count} checked` };
  return { tone: 'good', label: 'All received' };
}

export default function InvoicesList({
  rows, suppliers, matchCount, allCount, ...state
}: ListState & { rows: InvoiceRow[]; suppliers: string[]; matchCount: number; allCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(state.q);
  const lastSent = useRef(state.q);
  const { supplier, status, sort: sortKey, dir: sortDir, page } = state;

  function go(next: Partial<ListState>) {
    const merged = { ...state, q: query, page: 1, ...next };
    lastSent.current = merged.q;
    startTransition(() => router.replace(listHref(pathname, merged), { scroll: false }));
  }

  // Debounce typing so each keystroke does not fetch a page.
  useEffect(() => {
    if (query === lastSent.current) return;
    const t = setTimeout(() => go({ q: query }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const supplierOptions: SupplierOption[] = suppliers.map(s => ({ value: s, label: supplierLabel(s) }));

  function clickHeader(key: SortKey) {
    if (sortKey === key) go({ dir: sortDir === 'asc' ? 'desc' : 'asc' });
    else go({ sort: key, dir: defaultSortDir(key) });
  }

  const pageCount = Math.max(1, Math.ceil(matchCount / INVOICE_PAGE_SIZE));

  return (
    <>
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        supplier={supplier}
        onSupplierChange={v => go({ supplier: v })}
        supplierOptions={supplierOptions}
        placeholder="Invoice number, date or amount"
        resultCount={matchCount}
        totalCount={allCount}
        filtered={status !== 'all'}
      >
        <select
          className="filter-bar-select"
          value={status}
          onChange={e => go({ status: e.target.value as StatusFilter })}
          aria-label="Filter by status"
        >
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map(k => <option key={k} value={k}>{STATUS_LABELS[k]}</option>)}
        </select>
      </FilterBar>

      <div className="card" style={{ overflow: 'hidden', opacity: pending ? 0.6 : 1, transition: 'opacity 150ms ease' }} aria-busy={pending}>
        <div className="table-scroll">
          <table className="table rows">
            <thead>
              <tr>
                <SortableHeader label="Invoice" sortKey="invoice" current={sortKey} dir={sortDir} onClick={clickHeader} />
                <SortableHeader label="Supplier" sortKey="supplier" current={sortKey} dir={sortDir} onClick={clickHeader} />
                <SortableHeader label="Date" sortKey="date" current={sortKey} dir={sortDir} onClick={clickHeader} />
                <SortableHeader label="Total" sortKey="total" current={sortKey} dir={sortDir} onClick={clickHeader} numeric />
                <SortableHeader label="Check" sortKey="status" current={sortKey} dir={sortDir} onClick={clickHeader} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-row">No invoices match these filters.</td>
                </tr>
              ) : rows.map(inv => {
                const st = receiptStatus(inv);
                return (
                  <tr key={inv.id}>
                    <td className="c-title">
                      {/* One link per row, not prefetched: a hundred invoice prefetches cost more than they save. */}
                      <Link href={`/invoices/${inv.id}`} className="row-cover" prefetch={false}>{inv.invoice_number}</Link>
                    </td>
                    <td className="c-meta"><SupplierTag code={inv.supplier} /></td>
                    <td className="c-meta text-faint">{shortDate(inv.invoice_date)}</td>
                    <td className="num c-value">{money(inv.gross_total)}</td>
                    <td className="c-status"><Status tone={st.tone}>{st.label}</Status></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pageCount > 1 && (
        <nav aria-label="Invoice pages" className="pager">
          <span>Page {page} of {pageCount}</span>
          {page > 1 && <Link className="btn btn-secondary btn-sm" href={listHref(pathname, { ...state, page: page - 1 })}>Previous</Link>}
          {page < pageCount && <Link className="btn btn-secondary btn-sm" href={listHref(pathname, { ...state, page: page + 1 })}>Next</Link>}
        </nav>
      )}
    </>
  );
}

function SortableHeader({
  label,
  sortKey,
  current,
  dir,
  onClick,
  numeric,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  numeric?: boolean;
}) {
  const isActive = current === sortKey;
  return (
    <th className={numeric ? 'num' : undefined} aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onClick(sortKey)} className="sort-header">
        <span>{label}</span>
        <span className={`sort-indicator${isActive ? ' is-active' : ''}`} aria-hidden>
          {isActive ? (dir === 'asc' ? '↑' : '↓') : ''}
        </span>
      </button>
    </th>
  );
}
