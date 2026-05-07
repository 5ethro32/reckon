'use client';

/**
 * AppShell — client wrapper around the sidebar + main content area.
 *
 * Owns the collapse state for the sidebar. Persists to localStorage so the
 * preference survives navigation and reloads.
 *
 * The layout is structured so that:
 *   - Sidebar is position: fixed on the left with a width transition
 *   - <main> has a margin-left that matches the sidebar width and animates
 *     in lockstep — no layout jump on toggle
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import CollapsibleSidebar from './collapsible-sidebar';
import Topbar from './topbar';

const STORAGE_KEY = 'reckon.sidebar.collapsed';

export default function AppShell({
  userEmail,
  pharmacyName,
  children,
}: {
  userEmail: string;
  pharmacyName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === '1') setCollapsed(true);
    } catch {
      // ignore — privacy mode etc
    }
    setHydrated(true);
  }, []);

  // Close mobile drawer on route change (so tapping a nav link dismisses it).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open — otherwise the page
  // behind the backdrop scrolls when the user swipes the drawer.
  useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [mobileOpen]);

  function toggle() {
    setCollapsed(prev => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }

  const sidebarWidth = collapsed ? '4rem' : '15rem';

  return (
    <div
      className="app-shell"
      data-mobile-open={mobileOpen ? 'true' : 'false'}
      style={{ minHeight: '100vh', background: 'var(--surface-raised)' }}
    >
      <CollapsibleSidebar
        collapsed={collapsed}
        onToggle={toggle}
        userEmail={userEmail}
      />

      {/* Backdrop sits between page content (z-auto) and the drawer (z:50).
       * Tapping it closes the drawer. Only visible when mobile-open via CSS. */}
      <button
        type="button"
        aria-label="Close menu"
        className="mobile-drawer-backdrop"
        onClick={() => setMobileOpen(false)}
      />

      <div
        className="app-main"
        style={{
          marginLeft: sidebarWidth,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          transition: hydrated ? 'margin-left 200ms ease' : 'none',
        }}
      >
        <Topbar
          pharmacyName={pharmacyName}
          userEmail={userEmail}
          onMenuClick={() => setMobileOpen(true)}
        />
        <main
          style={{
            flex: 1,
            padding: '2rem 2.5rem',
            overflow: 'auto',
          }}
        >
          <div style={{ maxWidth: '78rem', margin: '0 auto' }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
