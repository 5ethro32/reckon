'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { supplierTone } from '@/lib/goods-in/supplier';

export function SupplierBadge({ supplier }: { supplier: string }) {
  return <span className="gi-badge" style={{ ['--tone' as string]: supplierTone(supplier) }} aria-hidden="true"><i /></span>;
}

/** A slim track: received (green), problems (amber), the rest still to check. */
export function Track({ total, good, warn = 0, ink = 0, label }: { total: number; good: number; warn?: number; ink?: number; label?: string }) {
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : '0%');
  return (
    <span className="gi-track" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {good > 0 && <span className="is-good" style={{ width: pct(good) }} />}
      {warn > 0 && <span className="is-warn" style={{ width: pct(warn) }} />}
      {ink > 0 && <span className="is-ink" style={{ width: pct(ink) }} />}
    </span>
  );
}

export function Chevron({ down = false }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 12 12" className="gi-chev" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d={down ? 'M3 4.5 6 7.5 9 4.5' : 'M4.5 3 7.5 6 4.5 9'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden="true">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M8 9v6M11 9v6M14 9v6M17 9v6" />
    </svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

/** Bottom sheet on phones, a panel from the right on desktop. Escape or the scrim closes it. */
export function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="gi-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="gi-sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="gi-sheet-panel" ref={panel} tabIndex={-1}>
        <span className="gi-sheet-grip" aria-hidden="true" />
        <div className="gi-sheet-head">
          <div style={{ minWidth: 0 }}>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="gi-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <span className="gi-stepper" role="group" aria-label={label}>
      <button type="button" aria-label="One fewer" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="One more" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </span>
  );
}
