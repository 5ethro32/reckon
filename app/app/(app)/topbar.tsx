'use client';

/**
 * Topbar — slim chrome above each page.
 *
 *   Left:  pharmacy name (small, muted — context, not a title)
 *   Right: theme toggle, notification bell (placeholder), user avatar
 *
 * The bell is a placeholder hook — it routes to /credits for now since the
 * only real notifications we have are credit-related (unchased >14d, etc).
 * When we add a proper notification feed it'll become a popover.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const THEME_KEY = 'reckon.theme';
type Theme = 'light' | 'dark';

// Maps the first path segment to a human page label. Detail pages
// (/invoices/[id], /statements/[id]) inherit their parent's label —
// the page heading inside the page itself shows the specific record.
const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  invoices: 'Deliveries',
  statements: 'Statements',
  credits: 'Credits',
  upload: 'Upload',
  suppliers: 'Suppliers',
  settings: 'Settings',
};

function getPageLabel(pathname: string): { label: string; href: string } | null {
  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (!first) return null;
  const label = PAGE_LABELS[first];
  if (!label) return null;
  // For detail routes, the breadcrumb still links back to the parent list.
  return { label, href: `/${first}` };
}

export default function Topbar({
  pharmacyName,
  userEmail,
  onMenuClick,
}: {
  pharmacyName: string;
  userEmail: string;
  onMenuClick?: () => void;
}) {
  const pathname = usePathname();
  const page = getPageLabel(pathname);
  const [theme, setTheme] = useState<Theme>('light');
  const [hydrated, setHydrated] = useState(false);

  // Read persisted theme on mount; default to light.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_KEY) as Theme | null;
      const initial: Theme = saved === 'dark' ? 'dark' : 'light';
      setTheme(initial);
      document.documentElement.dataset.theme = initial;
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
  }

  const initial = (userEmail[0] ?? '?').toUpperCase();

  return (
    <header
      style={{
        height: '3rem',
        background: 'var(--card-bg)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '0 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.375rem',
          minWidth: 0,
          fontSize: '12px',
          fontWeight: 500,
          overflow: 'hidden',
        }}
      >
        {/* Hamburger — only renders on mobile via .topbar-menu-toggle CSS rules. */}
        {onMenuClick && (
          <button
            type="button"
            className="topbar-menu-toggle"
            onClick={onMenuClick}
            aria-label="Open menu"
            title="Open menu"
          >
            <MenuIcon />
          </button>
        )}
        <span
          className="topbar-pharmacy-name"
          style={{
            color: 'var(--muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 1,
            minWidth: 0,
          }}
          title={pharmacyName}
        >
          {pharmacyName}
        </span>
        {page && (
          <>
            <span aria-hidden className="topbar-pharmacy-sep" style={{ color: 'var(--muted-light)', flexShrink: 0 }}>/</span>
            <Link
              href={page.href}
              style={{
                color: 'var(--foreground)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {page.label}
            </Link>
          </>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          flexShrink: 0,
        }}
      >
        {/* Theme toggle — only render after hydration to avoid flash of wrong icon */}
        {hydrated && (
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            style={iconButtonStyle}
            onMouseEnter={e => hoverIn(e.currentTarget)}
            onMouseLeave={e => hoverOut(e.currentTarget)}
          >
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </button>
        )}

        {/* Notification bell — placeholder, routes to credits queue */}
        <Link
          href="/credits"
          aria-label="Notifications"
          title="Notifications"
          style={{ ...iconButtonStyle, textDecoration: 'none' }}
          onMouseEnter={e => hoverIn(e.currentTarget)}
          onMouseLeave={e => hoverOut(e.currentTarget)}
        >
          <BellIcon />
        </Link>

        {/* User avatar — links to settings (we'll build that page next) */}
        <Link
          href="/settings"
          aria-label="Settings"
          title={userEmail}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.875rem',
            height: '1.875rem',
            borderRadius: '50%',
            border: '1px solid var(--border)',
            background: 'var(--card-bg)',
            color: 'var(--muted)',
            fontSize: '12px',
            fontWeight: 500,
            textDecoration: 'none',
            marginLeft: '0.375rem',
            transition: 'border-color 120ms ease, color 120ms ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--foreground)';
            e.currentTarget.style.color = 'var(--foreground)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.color = 'var(--muted)';
          }}
        >
          {initial}
        </Link>
      </div>
    </header>
  );
}

// ────────────────────────────────────────────────────────────────────
// Shared icon-button styling
// ────────────────────────────────────────────────────────────────────

const iconButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.875rem',
  height: '1.875rem',
  borderRadius: '0.375rem',
  border: 'none',
  background: 'transparent',
  color: 'var(--muted)',
  cursor: 'pointer',
  transition: 'background 120ms ease, color 120ms ease',
};

function hoverIn(el: HTMLElement) {
  el.style.background = 'var(--surface-hover)';
  el.style.color = 'var(--foreground)';
}

function hoverOut(el: HTMLElement) {
  el.style.background = 'transparent';
  el.style.color = 'var(--muted)';
}

// ────────────────────────────────────────────────────────────────────
// Icons — outline 1.5 stroke style, matches the sidebar
// ────────────────────────────────────────────────────────────────────

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}
