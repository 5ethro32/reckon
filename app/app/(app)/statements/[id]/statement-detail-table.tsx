'use client';

/**
 * Statement detail reconciliation table — client component with a
 * search box that filters by document number, type, or amount.
 *
 * Why client-side: a statement has up to ~150 rows; client filtering
 * on a server-fetched dataset is the simplest UX with no extra
 * round-trips. Same pattern as the list pages.
 *
 * Three reconciliation states are surfaced per row:
 *
 *   - INV row, matched + no pending exceptions → "Matched" (green)
 *   - INV row, matched + has pending exceptions → "Matched" + amber
 *     "£X.XX credit pending" sub-badge (we expect a future credit)
 *   - INV row, unmatched → "No invoice" (amber)
 *   - CRED row, resolved against an invoice line → "Credit note"
 *     + green "linked to invoice <number>" sub-badge
 *   - CRED row, unresolved → "Credit note" (neutral)
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';

const docTypeLabels: Record<string, string> = {
  INV: 'Invoice', CRED: 'Credit', OTHER: 'Other',
};

export type StatementDetailRow = {
  id: string;
  document_date: string;            // YYYY-MM-DD
  document_number: string;
  document_type: string;            // 'INV' | 'CRED' | 'OTHER'
  total: number;
  match_status: string;             // 'matched' | 'unmatched'
  matched_invoice_id: string | null;
  matched_invoice_number: string | null;
  pending_credit: number;            // 0 if no pending credit on this matched invoice
  resolved_invoice_id: string | null; // for CRED rows, the invoice the credit was for
  resolved_invoice_number: string | null;
};

export default function StatementDetailTable({ rows }: { rows: StatementDetailRow[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => {
      const date = new Date(r.document_date).toLocaleDateString('en-GB');
      return (
        r.document_number.toLowerCase().includes(q)
        || (r.matched_invoice_number ?? '').toLowerCase().includes(q)
        || (r.resolved_invoice_number ?? '').toLowerCase().includes(q)
        || (docTypeLabels[r.document_type] ?? '').toLowerCase().includes(q)
        || date.toLowerCase().includes(q)
        || String(Math.abs(r.total)).includes(q)
      );
    });
  }, [rows, query]);

  return (
    <>
      <SearchBar
        query={query}
        onChange={setQuery}
        resultCount={filtered.length}
        totalCount={rows.length}
      />

      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Document</th>
              <th>Type</th>
              <th className="num">Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2.5rem 1rem', fontSize: '12px' }}>
                  No rows match your search.
                </td>
              </tr>
            ) : filtered.map(row => {
              const isMatched = row.match_status === 'matched';
              const isCredit = row.document_type === 'CRED';
              const hasPendingCredit = row.pending_credit > 0;
              const creditLinked = isCredit && row.resolved_invoice_id;
              return (
                <tr
                  key={row.id}
                  className={!isMatched && !isCredit ? 'is-warning' : undefined}
                >
                  <td style={{ color: 'var(--muted)' }}>
                    {new Date(row.document_date).toLocaleDateString('en-GB')}
                  </td>
                  <td style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                    {isMatched && row.matched_invoice_id ? (
                      <Link
                        href={`/invoices/${row.matched_invoice_id}`}
                        style={{ color: 'var(--foreground)', textDecoration: 'none' }}
                      >
                        {row.document_number}
                      </Link>
                    ) : (
                      row.document_number
                    )}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{docTypeLabels[row.document_type]}</td>
                  <td
                    className="num"
                    style={row.total < 0 ? { color: 'var(--status-warning-text)' } : undefined}
                  >
                    £{row.total.toFixed(2)}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
                      {isCredit ? (
                        <span className="badge badge-neutral">Credit note</span>
                      ) : isMatched ? (
                        <span className="badge badge-success">Matched</span>
                      ) : (
                        <span className="badge badge-warning">No invoice</span>
                      )}

                      {/* Sub-badge: pending credit (matched invoice with flagged lines). */}
                      {hasPendingCredit && (
                        <span
                          className="badge badge-warning"
                          title="This invoice has lines you've flagged as short, damaged, returned or not received. The supplier hasn't yet credited the difference."
                        >
                          £{row.pending_credit.toFixed(2)} credit pending
                        </span>
                      )}

                      {/* Sub-badge: credit note auto-linked to a returned line. */}
                      {creditLinked && row.resolved_invoice_number && row.resolved_invoice_id && (
                        <Link
                          href={`/invoices/${row.resolved_invoice_id}`}
                          className="badge badge-success"
                          style={{ textDecoration: 'none' }}
                          title="This credit note has been auto-linked to a line you marked as returned on this invoice."
                        >
                          Linked → {row.resolved_invoice_number}
                        </Link>
                      )}
                    </div>
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

/** Local search bar — same styling as the list-page filter bar but no
 *  supplier filter (a single statement has only one supplier). */
function SearchBar({
  query,
  onChange,
  resultCount,
  totalCount,
}: {
  query: string;
  onChange: (v: string) => void;
  resultCount: number;
  totalCount: number;
}) {
  const isFiltered = query.trim().length > 0;
  return (
    <div className="filter-bar">
      <div className="filter-bar-search">
        <svg
          className="filter-bar-search-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={e => onChange(e.target.value)}
          placeholder="Search this statement — invoice number, credit number, amount"
          className="filter-bar-input"
          aria-label="Search statement rows"
        />
        {query && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="filter-bar-clear"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>
      <div className="filter-bar-count">
        {isFiltered ? (
          <span>
            <span style={{ fontWeight: 500, color: 'var(--foreground)' }}>{resultCount}</span>{' '}
            of {totalCount}
          </span>
        ) : (
          <span>{totalCount} rows</span>
        )}
      </div>
    </div>
  );
}
