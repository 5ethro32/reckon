'use client';

/**
 * Statements list — filter bar and one row per statement.
 *
 * Filtering is client-side: a pharmacy gets a handful of statements per
 * supplier a month, so years of history fit in memory. Newest first by
 * default; any header sorts. On phones each row reads as two lines.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FilterBar, type SupplierOption } from '../filter-bar';
import { Status, SupplierTag, money, shortDate, supplierLabel } from '../ui';

export type StatementRow = {
  id: string;
  supplier: string;
  statement_date: string;          // YYYY-MM-DD
  gross_total: number;
  reconciled_count: number;
  unreconciled_count: number;
  credits_pending: number;          // sum of exception gross on matched invoices
};

type SortKey = 'date' | 'supplier' | 'total' | 'matched' | 'pending';
type SortDir = 'asc' | 'desc';

export default function StatementsList({ rows }: { rows: StatementRow[] }) {
  const [query, setQuery] = useState('');
  const [supplier, setSupplier] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const supplierOptions: SupplierOption[] = useMemo(() => {
    const set = new Set(rows.map(r => r.supplier));
    return Array.from(set).map(s => ({ value: s, label: supplierLabel(s) }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (supplier !== 'all' && r.supplier !== supplier) return false;
      if (!q) return true;
      const date = new Date(r.statement_date).toLocaleDateString('en-GB');
      return (
        supplierLabel(r.supplier).toLowerCase().includes(q)
        || date.toLowerCase().includes(q)
        || shortDate(r.statement_date).toLowerCase().includes(q)
        || String(r.gross_total).includes(q)
      );
    });
  }, [rows, query, supplier]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date': cmp = a.statement_date.localeCompare(b.statement_date); break;
        case 'supplier': cmp = supplierLabel(a.supplier).localeCompare(supplierLabel(b.supplier)); break;
        case 'total': cmp = a.gross_total - b.gross_total; break;
        case 'matched': cmp = a.reconciled_count - b.reconciled_count; break;
        case 'pending': cmp = a.credits_pending - b.credits_pending; break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [filtered, sortKey, sortDir]);

  function clickHeader(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'date' || key === 'total' || key === 'pending' ? 'desc' : 'asc');
    }
  }

  return (
    <>
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        supplier={supplier}
        onSupplierChange={setSupplier}
        supplierOptions={supplierOptions}
        placeholder="Date, supplier or amount"
        resultCount={sorted.length}
        totalCount={rows.length}
      />

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="table-scroll">
          <table className="table rows">
            <thead>
              <tr>
                <SortableHeader label="Statement" sortKey="date" current={sortKey} dir={sortDir} onClick={clickHeader} />
                <SortableHeader label="Supplier" sortKey="supplier" current={sortKey} dir={sortDir} onClick={clickHeader} />
                <SortableHeader label="Matched" sortKey="matched" current={sortKey} dir={sortDir} onClick={clickHeader} />
                <SortableHeader label="Total" sortKey="total" current={sortKey} dir={sortDir} onClick={clickHeader} numeric />
                <SortableHeader label="Still owed" sortKey="pending" current={sortKey} dir={sortDir} onClick={clickHeader} />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-row">No statements match these filters.</td>
                </tr>
              ) : sorted.map(s => {
                const lines = s.reconciled_count + s.unreconciled_count;
                return (
                  <tr key={s.id}>
                    <td className="c-title">
                      <Link href={`/statements/${s.id}`} className="row-cover" prefetch={false}>{shortDate(s.statement_date)}</Link>
                    </td>
                    <td className="c-meta"><SupplierTag code={s.supplier} /></td>
                    <td className="c-meta">
                      {s.unreconciled_count === 0
                        ? <span className="text-faint">All {lines} matched</span>
                        : <span>{s.reconciled_count} of {lines} matched</span>}
                    </td>
                    <td className="num c-value">{money(s.gross_total)}</td>
                    <td className="c-status">
                      {s.credits_pending > 0
                        ? <Status tone="warn">{money(s.credits_pending)} owed</Status>
                        : s.unreconciled_count > 0
                        ? <Status tone="neutral">{s.unreconciled_count} to match</Status>
                        : <Status tone="good">Reconciled</Status>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
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
