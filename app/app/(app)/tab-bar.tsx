'use client';

/**
 * Phone and tablet navigation: a floating glass tab bar above the home
 * indicator, with five places. Scan goes to the delivery that needs
 * checking next (see /scan). More opens a sheet with the rest, the pharmacy
 * in view and Appearance.
 *
 * A tapped tab dims until its page arrives, so a slow connection never looks
 * like a tap that did nothing.
 */

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CLAIMS, DELIVERIES, HOME, MORE, icons, isActive, type NavItem } from './nav';
import { setTheme, themeChoice, type ThemeChoice } from '@/lib/theme';

const SCAN: NavItem = { id: 'scan', label: 'Scan', href: '/scan', icon: icons.scan };

export default function TabBar({ pharmacyName, userEmail }: { pharmacyName: string; userEmail: string }) {
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // A new page closes the sheet.
  useEffect(() => setMoreOpen(false), [path]);

  const moreActive = MORE.some(item => isActive(item, path));
  const tab = (item: NavItem) => {
    // Scan has no page of its own; it lands on a delivery, so it is never the active tab.
    const active = item !== SCAN && isActive(item, path);
    return (
      <Link key={item.id} href={item.href} className="tabbar-tab" aria-current={active ? 'page' : undefined} prefetch={item === SCAN ? false : undefined}>
        <TabFace icon={item.icon} label={item.label} />
      </Link>
    );
  };

  return (
    <>
      <nav className="tabbar" aria-label="Reckon">
        <div className="tabbar-band" aria-hidden="true" />
        <div className="tabbar-pill">
          {tab(HOME)}
          {tab(DELIVERIES)}
          {tab(SCAN)}
          {tab(CLAIMS)}
          <button
            type="button"
            className="tabbar-tab"
            data-active={moreActive || moreOpen ? 'true' : undefined}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <span className="tabbar-icon">{icons.more}</span>
            More
          </button>
        </div>
      </nav>
      {moreOpen && <MoreSheet path={path} pharmacyName={pharmacyName} userEmail={userEmail} onClose={() => setMoreOpen(false)} />}
    </>
  );
}

function TabFace({ icon, label }: { icon: ReactNode; label: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span className="tabbar-icon" data-pending={pending ? 'true' : undefined}>{icon}</span>
      {label}
    </>
  );
}

function MoreSheet({ path, pharmacyName, userEmail, onClose }: { path: string; pharmacyName: string; userEmail: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<ThemeChoice>('auto');

  useEffect(() => {
    setChoice(themeChoice());
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const choose = (c: ThemeChoice) => { setTheme(c); setChoice(c); };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="More">
      <button type="button" className="sheet-backdrop" aria-label="Close" onClick={onClose} />
      <div className="sheet-panel" ref={panel} tabIndex={-1}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <strong>{pharmacyName}</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Done</button>
        </div>
        <ul className="sheet-group">
          {MORE.map(item => (
            <li key={item.id}>
              <Link href={item.href} className="sheet-row" aria-current={isActive(item, path) ? 'page' : undefined} onClick={onClose}>
                {item.icon}
                {item.label}
                <span className="chev">{icons.chevron}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="sheet-meta">Appearance</p>
        <div className="segmented" role="group" aria-label="Appearance" style={{ marginBottom: 12 }}>
          {(['auto', 'light', 'dark'] as const).map(c => (
            <button key={c} type="button" aria-pressed={choice === c} onClick={() => choose(c)}>
              {c === 'auto' ? 'Auto' : c === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
        <p className="sheet-meta">Signed in as {userEmail}</p>
      </div>
    </div>
  );
}
