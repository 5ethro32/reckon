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
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Read persisted state on mount (avoids hydration mismatch by rendering
  // expanded-state on first paint, then snapping to persisted value).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === '1') setCollapsed(true);
    } catch {
      // ignore — privacy mode etc
    }
    setHydrated(true);
  }, []);

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
    <div style={{ minHeight: '100vh', background: 'var(--surface-raised)' }}>
      <CollapsibleSidebar
        collapsed={collapsed}
        onToggle={toggle}
        userEmail={userEmail}
      />

      <div
        style={{
          marginLeft: sidebarWidth,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          // Match the sidebar's transition exactly so they move together.
          // On first paint we suppress transition to avoid a 200ms slide
          // from 15rem to 4rem if the user had it collapsed.
          transition: hydrated ? 'margin-left 200ms ease' : 'none',
        }}
      >
        <Topbar pharmacyName={pharmacyName} userEmail={userEmail} />
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
