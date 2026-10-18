'use client';

/**
 * Filter bar for the deliveries and statements lists: a search field, a
 * supplier picker (when there are two or more suppliers), any extra pickers
 * the page passes in, and how many rows match.
 *
 * Phones: the search takes the full width and the pickers sit below it.
 */

import type { ReactNode } from 'react';

export type SupplierOption = {
  value: string;
  label: string;
};

export function FilterBar({
  query,
  onQueryChange,
  supplier,
  onSupplierChange,
  supplierOptions,
  placeholder,
  resultCount,
  totalCount,
  filtered,
  children,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  supplier: string;
  onSupplierChange: (v: string) => void;
  supplierOptions: SupplierOption[];
  placeholder: string;
  resultCount: number;
  totalCount: number;
  /** Other filters are on, so show "n of total". */
  filtered?: boolean;
  children?: ReactNode;
}) {
  const showSupplierFilter = supplierOptions.length >= 2;
  const isFiltered = filtered || query.trim().length > 0 || supplier !== 'all';

  return (
    <div className="filter-bar">
      <div className="filter-bar-search">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder={placeholder}
          className="filter-bar-input"
          aria-label="Search"
          enterKeyHint="search"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="filter-bar-clear"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      <div className="filter-bar-pickers">
        {showSupplierFilter && (
          <select
            className="filter-bar-select"
            value={supplier}
            onChange={e => onSupplierChange(e.target.value)}
            aria-label="Filter by supplier"
          >
            <option value="all">All suppliers</option>
            {supplierOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
        {children}
        <div className="filter-bar-count" aria-live="polite">
          {isFiltered ? `${resultCount} of ${totalCount}` : `${totalCount} in all`}
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="filter-bar-search-icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7.5" />
      <line x1="20.5" y1="20.5" x2="16.4" y2="16.4" />
    </svg>
  );
}
