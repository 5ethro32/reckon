'use client';

/**
 * Desktop sidebar (1024px and up; phones and tablets use the tab bar).
 *
 * Collapsed by default to a 64px column of icons under the Reckon mark.
 * Opening it pushes the page across, and it stays open from page to page
 * until folded again; a reload starts collapsed. Hovering the mark turns it
 * into the toggle. Settings and the light/dark switch sit at the foot.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SETTINGS, SIDEBAR, icons, isActive, type NavItem } from './nav';
import { currentTheme, setTheme } from '@/lib/theme';

export default function CollapsibleSidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const path = usePathname();
  return (
    <nav className="sidenav" aria-label="Reckon" data-open={open ? 'true' : 'false'}>
      <div className="sidenav-top">
        {open ? (
          <>
            <Link href="/dashboard" className="sidenav-brand" aria-label="Reckon home">
              <BrandMark />
              Reckon
            </Link>
            <button type="button" className="sidenav-collapse" onClick={onToggle} aria-label="Collapse sidebar" aria-expanded="true">
              <span style={{ width: 18, height: 18, display: 'block' }}>{icons.sidebar}</span>
            </button>
          </>
        ) : (
          <button type="button" className="sidenav-toggle" onClick={onToggle} aria-label="Expand sidebar" aria-expanded="false">
            <span className="mark"><BrandMark /></span>
            <span className="toggle"><span style={{ width: 18, height: 18, display: 'block' }}>{icons.sidebar}</span></span>
          </button>
        )}
      </div>

      <ul className="sidenav-list" style={{ marginTop: 8 }}>
        {SIDEBAR.map(item => <Item key={item.id} item={item} active={isActive(item, path)} open={open} />)}
      </ul>

      <ul className="sidenav-list">
        <li className="sidenav-item"><ThemeToggle open={open} /></li>
        <Item item={SETTINGS} active={isActive(SETTINGS, path)} open={open} />
      </ul>
    </nav>
  );
}

function Item({ item, active, open }: { item: NavItem; active: boolean; open: boolean }) {
  return (
    <li className="sidenav-item">
      <Link
        href={item.href}
        className="sidenav-link"
        aria-current={active ? 'page' : undefined}
        aria-label={open ? undefined : item.label}
      >
        {item.icon}
        {open && <span className="sidenav-label">{item.label}</span>}
      </Link>
      {!open && <span role="tooltip" className="sidenav-tip">{item.label}</span>}
    </li>
  );
}

/** Light or dark for this browser; the label says what a click does. */
function ThemeToggle({ open }: { open: boolean }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(currentTheme() === 'dark');
    sync();
    window.addEventListener('reckon-theme', sync);
    const m = matchMedia('(prefers-color-scheme: dark)');
    m.addEventListener('change', sync);
    return () => { window.removeEventListener('reckon-theme', sync); m.removeEventListener('change', sync); };
  }, []);
  const label = dark ? 'Light mode' : 'Dark mode';
  return (
    <>
      <button type="button" className="sidenav-link" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={open ? undefined : label}>
        {dark ? icons.sun : icons.moon}
        {open && <span className="sidenav-label">{label}</span>}
      </button>
      {!open && <span role="tooltip" className="sidenav-tip">{label}</span>}
    </>
  );
}

/** The Reckon mark in solid brand blues. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size * 0.75} height={size} viewBox="120 70 240 320" aria-hidden style={{ display: 'block' }}>
      <polygon points="130,120 202,160 202,240 130,200" fill="#67D2F3" />
      <polygon points="130,200 202,160 202,240" fill="#0A5F87" />
      <polygon points="202,160 346,80 346,160 202,240" fill="#109DDB" />
      <polygon points="130,280 202,240 202,344 130,384" fill="#109DDB" />
    </svg>
  );
}
