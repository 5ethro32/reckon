// Shared by the server page and the client list: values exported from a
// 'use client' module are not usable on the server.
export const INVOICE_PAGE_SIZE = 100;

export type SortKey = 'date' | 'supplier' | 'invoice' | 'total' | 'status';
export type SortDir = 'asc' | 'desc';

export function defaultSortDir(key: SortKey): SortDir {
  return key === 'date' || key === 'total' ? 'desc' : 'asc';
}

/** ?status= on the deliveries list. "open" is what Scan and Home call still to check. */
export const STATUS_FILTERS = ['all', 'open', 'issues', 'done'] as const;
export type StatusFilter = typeof STATUS_FILTERS[number];
