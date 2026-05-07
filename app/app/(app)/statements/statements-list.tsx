'use client';

/**
 * Statements list — client component that renders the statements table
 * with a filter bar (search + supplier filter) above.
 *
 * Filtering is purely client-side. We get the full list from the server
 * once; the user types/filters/sorts without round-trips. This is fine for
 * the realistic data volume (a pharmacy gets a handful of statements per
 * supplier per month — even years of history fits in memory comfortably).
 *
 * Sort defaults: newest first by statement date. Click any column header
 * to toggle sort direction; click another header to switch sort key.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FilterBar, type SupplierOption } from '../filter-bar';

const supplierLabels: Record<string, string> = {
  aah: 'AAH', aver: 'Aver', phoenix: 'Phoenix',
  alliance: 'Alliance', ethigen: 'Ethigen', numark: 'Numark',
};

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
    return Array.from(set).map(s => ({
      value: s,
      label: supplierLabels[s] ?? s,
    }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (supplier !== 'all' && r.supplier !== supplier) return false;
      if (!q) return true;
      const date = new Date(r.statement_date).toLocaleDateString('en-GB');
      return (
        (supplierLabels[r.supplier] ?? r.supplier).toLowerCase().includes(q)
        || date.toLowerCase().includes(q)
        || String(r.gross_total).includes(q)
      );
    });
  }, [rows, query, supplier]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = a.statement_date.localeCompare(b.statement_date);
          break;
        case 'supplier':
          cmp = (supplierLabels[a.supplier] ?? a.supplier).localeCompare(
            supplierLabels[b.supplier] ?? b.supplier
          );
          break;
        case 'total':
          cmp = a.gross_total - b.gross_total;
          break;
        case 'matched':
          cmp = a.reconciled_count - b.reconciled_count;
          break;
        case 'pending':
          cmp = a.credits_pending - b.credits_pending;
          break;
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
        placeholder="Search by date, supplier, or amount"
        resultCount={sorted.length}
        totalCount={rows.length}
      />

      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <SortableHeader label="Supplier" sortKey="supplier" current={sortKey} dir={sortDir} onClick={clickHeader} />
              <SortableHeader label="Statement date" sortKey="date" current={sortKey} dir={sortDir} onClick={clickHeader} />
              <SortableHeader label="Total" sortKey="total" current={sortKey} dir={sortDir} onClick={clickHeader} numeric />
              <SortableHeader label="Matched" sortKey="matched" current={sortKey} dir={sortDir} onClick={clickHeader} />
              <SortableHeader label="Credits pending" sortKey="pending" current={sortKey} dir={sortDir} onClick={clickHeader} />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2.5rem 1rem', fontSize: '12px' }}>
                  No statements match your filters.
                </td>
              </tr>
            ) : sorted.map(s => {
              const total = s.reconciled_count + s.unreconciled_count;
              const allMatched = s.unreconciled_count === 0;
              const href = `/statements/${s.id}`;
              return (
                <tr key={s.id} style={{ cursor: 'pointer' }}>
                  <td>
                    <Link href={href} className="row-link" style={{ color: 'var(--muted)' }}>
                      {supplierLabels[s.supplier] ?? s.supplier}
                    </Link>
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    <Link href={href} className="row-link">
                      {new Date(s.statement_date).toLocaleDateString('en-GB')}
                    </Link>
                  </td>
                  <td className="num" style={{ fontWeight: 500 }}>
                    £{s.gross_total.toFixed(2)}
                  </td>
                  <td>
                    <span className={allMatched ? 'badge badge-success' : 'badge badge-warning'}>
                      {s.reconciled_count} / {total}
                    </span>
                  </td>
                  <td>
                    {s.credits_pending > 0 ? (
                      <span className="badge badge-warning">
                        £{s.credits_pending.toFixed(2)}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--muted-light)', fontSize: '12px' }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
