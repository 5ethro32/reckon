// Shared by the server page and the client list: values exported from a
// 'use client' module are not usable on the server.
export const INVOICE_PAGE_SIZE = 100;

export type SortKey = 'date' | 'supplier' | 'invoice' | 'total' | 'status';
export type SortDir = 'asc' | 'desc';

export function defaultSortDir(key: SortKey): SortDir {
  return key === 'date' || key === 'total' ? 'desc' : 'asc';
}
