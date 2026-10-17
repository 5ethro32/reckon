'use client';

/**
 * Deliveries list — client component with filter bar + sortable headers.
 *
 * Mirrors the structure of statements-list.tsx so the two list pages
 * have identical interaction patterns. Search, supplier, sort and page live
 * in the URL and the server filters and pages the invoices, so the browser
 * only ever holds one page.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FilterBar, type SupplierOption } from '../filter-bar';
import { INVOICE_PAGE_SIZE, defaultSortDir, type SortDir, type SortKey } from './list-params';

const supplierLabels: Record<string, string> = {
  aah: 'AAH', aver: 'Aver', phoenix: 'Phoenix',
  alliance: 'Alliance', ethigen: 'Ethigen', numark: 'Numark',
};

export type InvoiceRow = {
  id: string;
  supplier: string;
  invoice_number: string;
  invoice_date: string;          // YYYY-MM-DD
  gross_total: number;
  line_count: number;
  full_count: number;
  exception_count: number;
};

type ListState = { q: string; supplier: string; sort: SortKey; dir: SortDir; page: number };

function listHref(pathname: string, s: ListState): string {
  const params = new URLSearchParams();
  if (s.q.trim()) params.set('q', s.q.trim());
  if (s.supplier !== 'all') params.set('supplier', s.supplier);
  if (s.sort !== 'date') params.set('sort', s.sort);
  if (s.dir !== defaultSortDir(s.sort)) params.set('dir', s.dir);
  if (s.page > 1) params.set('page', String(s.page));
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export default function InvoicesList({
  rows, suppliers, matchCount, allCount, ...state
}: ListState & { rows: InvoiceRow[]; suppliers: string[]; matchCount: number; allCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(state.q);
  const lastSent = useRef(state.q);
  const { supplier, sort: sortKey, dir: sortDir, page } = state;

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

  const supplierOptions: SupplierOption[] = suppliers.map(s => ({
    value: s,
    label: supplierLabels[s] ?? s,
  }));

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
        placeholder="Search by invoice number, date, or amount"
        resultCount={matchCount}
        totalCount={allCount}
      />

      <div className="card" style={{ overflow: 'hidden', opacity: pending ? 0.6 : 1 }} aria-busy={pending}>
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <SortableHeader label="Supplier" sortKey="supplier" current={sortKey} dir={sortDir} onClick={clickHeader} />
              <SortableHeader label="Invoice #" sortKey="invoice" current={sortKey} dir={sortDir} onClick={clickHeader} />
              <SortableHeader label="Date" sortKey="date" current={sortKey} dir={sortDir} onClick={clickHeader} />
              <SortableHeader label="Total" sortKey="total" current={sortKey} dir={sortDir} onClick={clickHeader} numeric />
              <SortableHeader label="Status" sortKey="status" current={sortKey} dir={sortDir} onClick={clickHeader} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2.5rem 1rem', fontSize: '12px' }}>
                  No invoices match your filters.
                </td>
              </tr>
            ) : rows.map(inv => {
              const allFull = inv.line_count > 0 && inv.exception_count === 0;
              const label = inv.line_count === 0
                ? 'Pending'
                : allFull
                ? 'All received'
                : `${inv.full_count}/${inv.line_count} received`;
              const badgeClass = inv.line_count === 0
                ? 'badge badge-neutral'
                : allFull
                ? 'badge badge-success'
                : 'badge badge-warning';
              const href = `/invoices/${inv.id}`;
              return (
                <tr key={inv.id} style={{ cursor: 'pointer' }}>
                  <td>
                    <Link href={href} className="row-link" style={{ color: 'var(--muted)' }}>
                      {supplierLabels[inv.supplier] ?? inv.supplier}
                    </Link>
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    <Link href={href} className="row-link">
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>
                    <Link href={href} className="row-link" style={{ color: 'inherit' }}>
                      {new Date(inv.invoice_date).toLocaleDateString('en-GB')}
                    </Link>
                  </td>
                  <td className="num" style={{ fontWeight: 500 }}>
                    £{inv.gross_total.toFixed(2)}
                  </td>
                  <td>
                    <span className={badgeClass}>{label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {pageCount > 1 && (
        <nav aria-label="Invoice pages" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.875rem', fontSize: '12px', color: 'var(--muted)' }}>
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
    <th className={numeric ? 'num' : undefined}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className="sort-header"
        aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        <span className={`sort-indicator${isActive ? ' is-active' : ''}`} aria-hidden>
          {isActive ? (dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}
