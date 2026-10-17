'use client';
import { useEffect, useState } from 'react';
import { money, supplierName, supplierTone } from '@/lib/goods-in/supplier';
import type { SupplierSlice } from '@/lib/home/home-data';

type View = { key: string; label: string; aside: string; centre: string; empty: string; slices: SupplierSlice[] };

/**
 * Wholesalers as a ring, one view at a time (spend this month, money owed).
 * Hover a slice or legend row to preview a wholesaler; tap or click pins it.
 * The centre then shows that wholesaler's value and the others fade.
 */
export default function SupplierDonut({ views }: { views: View[] }) {
  const [viewKey, setViewKey] = useState(views[0]?.key);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const view = views.find(v => v.key === viewKey) ?? views[0];
  const active = hovered ?? pinned;

  useEffect(() => {
    if (!pinned) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest?.('[data-pick]')) setPinned(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [pinned]);

  const total = view.slices.reduce((s, x) => s + x.value, 0);
  const picked = view.slices.find(s => s.supplier === active);
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const bind = (key: string) => ({
    'data-pick': '',
    onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHovered(key); },
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHovered(null); },
    onClick: () => { setHovered(null); setPinned(p => (p === key ? null : key)); },
  });

  // Ring geometry: arcs from twelve o'clock with a 2px gap between slices.
  const size = 120, stroke = 14, r = (size - stroke) / 2, c = size / 2;
  const gap = view.slices.length > 1 ? 2 / r : 0;
  let at = 0;
  const arcs = view.slices.map(s => {
    const sweep = total ? (s.value / total) * Math.PI * 2 : 0;
    const a0 = at + gap / 2, a1 = at + sweep - gap / 2;
    at += sweep;
    if (a1 - a0 <= 0.002) return null;
    const props = {
      fill: 'none', stroke: supplierTone(s.supplier), strokeWidth: stroke,
      className: `hm-arc${active && active !== s.supplier ? ' is-faded' : ''}`, ...bind(s.supplier),
    };
    const title = <title>{`${supplierName(s.supplier)}: ${money(s.value)}, ${pct(s.value)}%`}</title>;
    return view.slices.length === 1
      ? <circle key={s.supplier} cx={c} cy={c} r={r} {...props}>{title}</circle>
      : <path key={s.supplier} d={arc(c, r, a0, a1)} {...props}>{title}</path>;
  });

  return (
    <section className="gi-card hm-donut-card" aria-labelledby="hm-donut-title">
      <div className="gi-card-head">
        <h2 id="hm-donut-title">By wholesaler</h2>
        <span className="gi-aside">{view.aside}</span>
      </div>
      {views.length > 1 && (
        <div className="hm-seg" role="tablist" aria-label="Show">
          {views.map(v => (
            <button key={v.key} type="button" role="tab" aria-selected={v.key === view.key}
              onClick={() => { setViewKey(v.key); setPinned(null); setHovered(null); }}>{v.label}</button>
          ))}
        </div>
      )}
      <div className="hm-donut">
        <div className="hm-ring">
          <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={total ? `${view.label}: ${money(total)}. ${view.slices.map(s => `${supplierName(s.supplier)} ${pct(s.value)}%`).join(', ')}.` : view.empty}>
            <circle cx={c} cy={c} r={r} fill="none" stroke="var(--gi-track)" strokeWidth={stroke} />
            {arcs}
          </svg>
          <div className="hm-ring-centre" aria-live="polite">
            <strong className="tnum">{money(picked ? picked.value : total, true)}</strong>
            <span>{picked ? supplierName(picked.supplier) : view.centre}</span>
          </div>
        </div>
        {total > 0 ? (
          <ul className="hm-legend">
            {view.slices.map(s => (
              <li key={s.supplier} {...bind(s.supplier)} className={active && active !== s.supplier ? 'is-faded' : undefined}>
                <i style={{ background: supplierTone(s.supplier) }} aria-hidden="true" />
                <span className="hm-legend-name">{supplierName(s.supplier)}</span>
                <span className="tnum">{money(s.value)}</span>
                <span className="tnum hm-legend-pct">{pct(s.value)}%</span>
              </li>
            ))}
          </ul>
        ) : <p className="hm-legend-empty">{view.empty}</p>}
      </div>
    </section>
  );
}

function arc(c: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => `${(c + r * Math.sin(a)).toFixed(2)} ${(c - r * Math.cos(a)).toFixed(2)}`;
  return `M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
}
