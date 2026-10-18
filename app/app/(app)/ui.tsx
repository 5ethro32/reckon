/**
 * Small shared pieces for the signed-in pages, styled by globals.css:
 * supplier names with their tone dot, status dots, figure cards, money and
 * dates, and loading skeletons. Safe in server and client components.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

const SUPPLIER_LABELS: Record<string, string> = {
  aah: 'AAH', aver: 'Aver', phoenix: 'Phoenix', alliance: 'Alliance', ethigen: 'Ethigen', numark: 'Numark',
};

export function supplierLabel(code: string): string {
  return SUPPLIER_LABELS[code.toLowerCase()] ?? code;
}

/** A supplier's name with its small tone dot. Every supplier carries the same weight. */
export function SupplierTag({ code, children }: { code: string; children?: ReactNode }) {
  return <span className="sup" data-supplier={code.toLowerCase()}>{children ?? supplierLabel(code)}</span>;
}

export type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'brand';

/** A status: a coloured dot and ink text. */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

/** One value and one line. */
export function Figure({ label, value, line, href, valueClass }: { label: string; value: ReactNode; line: ReactNode; href?: string; valueClass?: string }) {
  const body = <>
    <span className="figure-label">{label}</span>
    <span className={`figure-value${valueClass ? ` ${valueClass}` : ''}`}>{value}</span>
    <span className="figure-line">{line}</span>
  </>;
  return href ? <Link href={href} className="card figure">{body}</Link> : <div className="card figure">{body}</div>;
}

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
export const money = (n: number | string | null | undefined) => n === null || n === undefined ? '–' : gbp.format(Number(n));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Oct 2026" from YYYY-MM-DD or an ISO timestamp, in UK time. Three-letter months, never "Sept". */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '–';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return value;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Loading placeholders that keep the page's shape while it loads. */
export function SkeletonPage({ figures = 0, rows = 8 }: { figures?: number; rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="page-header">
        <div>
          <span className="skeleton" style={{ width: 180, height: 26, marginBottom: 10 }} />
          <span className="skeleton" style={{ width: 260, maxWidth: '80%', height: 14 }} />
        </div>
      </div>
      {figures > 0 && (
        <div className="figures">
          {Array.from({ length: figures }, (_, i) => (
            <div key={i} className="card figure">
              <span className="skeleton" style={{ width: '50%', height: 13 }} />
              <span className="skeleton" style={{ width: '40%', height: 24 }} />
              <span className="skeleton" style={{ width: '70%', height: 12 }} />
            </div>
          ))}
        </div>
      )}
      <div className="card" style={{ overflow: 'hidden' }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', borderTop: i ? '1px solid var(--hairline)' : undefined }}>
            <span className="skeleton" style={{ flex: '1 1 0', maxWidth: 220, height: 14 }} />
            <span className="skeleton" style={{ width: 70, height: 14, marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
