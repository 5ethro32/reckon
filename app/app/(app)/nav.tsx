/**
 * The places in Reckon, in one order everywhere: the desktop sidebar, the
 * phone tab bar and the phone More sheet all read from here.
 */

import type { ReactNode } from 'react';

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
  /** Other path prefixes that light this item up (detail pages). */
  also?: string[];
};

export function isActive(item: NavItem, path: string): boolean {
  return [item.href, ...(item.also ?? [])].some(p => path === p || path.startsWith(p + '/'));
}

const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const icons = {
  home: <svg {...stroke}><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></svg>,
  deliveries: <svg {...stroke}><path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" /><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" /></svg>,
  receiving: <svg {...stroke}><rect x="4.5" y="4" width="15" height="16.5" rx="2" /><path d="M9 4V3h6v1M8.5 11l2.5 2.5 4.5-4.5M8.5 16.5h7" /></svg>,
  claims: <svg {...stroke}><path d="M6 3.5h12a1 1 0 0 1 1 1v16l-2.5-1.5-2.5 1.5-2-1.5-2 1.5-2.5-1.5L5 20.5v-16a1 1 0 0 1 1-1z" /><path d="M14 8.6a2.1 2.1 0 0 0-3.9 1.1c0 1.6.6 2.2.6 3.6 0 .9-.4 1.6-1.2 2.2h5M9.3 12h3.6" /></svg>,
  statements: <svg {...stroke}><path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" /><path d="M14 3.5V8h4.5M9 12h6M9 16h6" /></svg>,
  suppliers: <svg {...stroke}><path d="M3.5 20.5h17M5 20.5V9l7-4.5L19 9v11.5" /><path d="M9.5 20.5v-6h5v6" /></svg>,
  margin: <svg {...stroke}><path d="M4 19.5h16" /><path d="M7 16v-4M12 16V8M17 16V5" /></svg>,
  dispensing: <svg {...stroke}><rect x="3.4" y="9" width="17.2" height="6.5" rx="3.25" transform="rotate(-45 12 12.25)" /><path d="m9.3 9.4 5.4 5.4" /></svg>,
  upload: <svg {...stroke}><path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4.5 14.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3.5" /></svg>,
  settings: <svg {...stroke}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
  scan: <svg {...stroke}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M8 8v8M11 8v8M14 8v8M17 8v8" /></svg>,
  more: <svg {...stroke}><circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" /></svg>,
  moon: <svg {...stroke}><path d="M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7z" /></svg>,
  sun: <svg {...stroke}><circle cx="12" cy="12" r="4" /><path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1" /></svg>,
  signOut: <svg {...stroke}><path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4.5" /></svg>,
  sidebar: <svg {...stroke}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9.5 4.5v15" /></svg>,
  chevron: <svg {...stroke} width="16" height="16"><path d="m9.5 6 6 6-6 6" /></svg>,
};

export const HOME: NavItem = { id: 'home', label: 'Home', href: '/dashboard', icon: icons.home };
export const DELIVERIES: NavItem = { id: 'deliveries', label: 'Invoices', href: '/invoices', icon: icons.deliveries };
export const RECEIVING: NavItem = { id: 'receiving', label: 'Before the invoice', href: '/receiving', icon: icons.receiving };
export const CLAIMS: NavItem = { id: 'claims', label: 'Claims', href: '/credits', icon: icons.claims };
export const STATEMENTS: NavItem = { id: 'statements', label: 'Statements', href: '/statements', icon: icons.statements };
export const SUPPLIERS: NavItem = { id: 'suppliers', label: 'Suppliers', href: '/suppliers', icon: icons.suppliers };
export const MARGIN: NavItem = { id: 'margin', label: 'Margin', href: '/margin', icon: icons.margin };
export const DISPENSING: NavItem = { id: 'dispensing', label: 'Dispensing', href: '/dispensing', icon: icons.dispensing };
export const UPLOAD: NavItem = { id: 'upload', label: 'Upload', href: '/upload', icon: icons.upload };
export const SETTINGS: NavItem = { id: 'settings', label: 'Settings', href: '/settings', icon: icons.settings };

/** Desktop sidebar, top group. Settings and the theme switch sit at its foot. */
export const SIDEBAR: NavItem[] = [HOME, DELIVERIES, RECEIVING, CLAIMS, STATEMENTS, SUPPLIERS, MARGIN, DISPENSING, UPLOAD];

/** Phone More sheet: everything not in the tab bar. */
export const MORE: NavItem[] = [STATEMENTS, SUPPLIERS, MARGIN, DISPENSING, UPLOAD, RECEIVING, SETTINGS];
