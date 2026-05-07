'use client';

/**
 * Deliveries list — client component with filter bar + sortable headers.
 *
 * Mirrors the structure of statements-list.tsx so the two list pages
 * have identical interaction patterns.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FilterBar, type SupplierOption } from '../filter-bar';

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

type SortKey = 'date' | 'supplier' | 'invoice' | 'total' | 'status';
type SortDir = 'asc' | 'desc';

export default function InvoicesList({ rows }: { rows: InvoiceRow[] }) {
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
      const date = new Date(r.invoice_date).toLocaleDateString('en-GB');
      return (
        r.invoice_number.toLowerCase().includes(q)
        || (supplierLabels[r.supplier] ?? r.supplier).toLowerCase().includes(q)
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
          cmp = a.invoice_date.localeCompare(b.invoice_date);
          break;
        case 'supplier':
          cmp = (supplierLabels[a.supplier] ?? a.supplier).localeCompare(
            supplierLabels[b.supplier] ?? b.supplier
          );
          break;
        case 'invoice':
          cmp = a.invoice_number.localeCompare(b.invoice_number, undefined, { numeric: true });
          break;
        case 'total':
          cmp = a.gross_total - b.gross_total;
          break;
        case 'status':
          // Pending (0) < In progress (mid) < All received (full). Lower=more pending.
          cmp = (a.line_count === 0 ? 0 : a.exception_count > 0 ? 1 : 2)
              - (b.line_count === 0 ? 0 : b.exception_count > 0 ? 1 : 2);
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
      setSortDir(key === 'date' || key === 'total' ? 'desc' : 'asc');
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
        placeholder="Search by invoice number, date, or amount"
        resultCount={sorted.length}
        totalCount={rows.length}
      />

      <div className="card" style={{ overflow: 'hidden' }}>
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
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2.5rem 1rem', fontSize: '12px' }}>
                  No invoices match your filters.
                </td>
              </tr>
            ) : sorted.map(inv => {
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
