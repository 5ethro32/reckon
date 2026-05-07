'use client';

/**
 * Shared filter bar used on /statements and /invoices list pages.
 *
 * Two controls + a result counter:
 *   1. Search input (left-icon, debounced via useEffect on the parent)
 *   2. Supplier select (only renders if there are 2+ suppliers in the list)
 *
 * The bar sits above the table card; its background blends into the page
 * (transparent) so it reads as part of the page chrome, not a sub-toolbar.
 */

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
}: {
  query: string;
  onQueryChange: (v: string) => void;
  supplier: string;
  onSupplierChange: (v: string) => void;
  supplierOptions: SupplierOption[];
  placeholder: string;
  resultCount: number;
  totalCount: number;
}) {
  const showSupplierFilter = supplierOptions.length >= 2;
  const isFiltered = query.trim().length > 0 || supplier !== 'all';

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

      <div className="filter-bar-count">
        {isFiltered ? (
          <span>
            <span style={{ fontWeight: 500, color: 'var(--foreground)' }}>{resultCount}</span>{' '}
            of {totalCount}
          </span>
        ) : (
          <span>{totalCount} total</span>
        )}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
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
  );
}
