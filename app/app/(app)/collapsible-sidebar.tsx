'use client';

/**
 * CollapsibleSidebar — Reckon's left navigation, modelled on the Amos QMS
 * sidebar.
 *
 *   • Expanded (15rem): icon + label + section labels + signed-in footer
 *   • Collapsed (4rem):  icon-only rail with hover tooltips
 *   • The brand mark cross-fades to a toggle button on hover (in both
 *     states) so the toggle is invisible chrome until you reach for it.
 *
 * No Tailwind utilities — Reckon disables Tailwind on Windows ARM64 due to
 * lightningcss native-binary issues, so this uses the design-token CSS
 * classes from globals.css plus inline styles.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import LogoutButton from '../logout-button';

type NavLink = {
  id: string;
  label: string;
  href: string;
  /**
   * `prefix` href segments that should also light up this nav item — e.g.
   * `/invoices/abc-123` should activate the Deliveries link.
   */
  matchPrefix?: string;
};

const PRIMARY_LINKS: NavLink[] = [
  { id: 'dashboard',  label: 'Dashboard',  href: '/dashboard' },
  { id: 'deliveries', label: 'Deliveries', href: '/invoices', matchPrefix: '/invoices' },
  { id: 'statements', label: 'Statements', href: '/statements', matchPrefix: '/statements' },
  { id: 'credits',    label: 'Credits',    href: '/credits' },
  { id: 'upload',     label: 'Upload',     href: '/upload' },
];

const SETTINGS_LINKS: NavLink[] = [
  { id: 'suppliers', label: 'Suppliers', href: '/suppliers' },
];

export default function CollapsibleSidebar({
  collapsed,
  onToggle,
  userEmail,
}: {
  collapsed: boolean;
  onToggle: () => void;
  userEmail: string;
}) {
  const pathname = usePathname();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [logoHovered, setLogoHovered] = useState(false);

  function isActive(link: NavLink): boolean {
    const target = link.matchPrefix ?? link.href;
    if (target === pathname) return true;
    if (target !== '/' && pathname.startsWith(target + '/')) return true;
    return false;
  }

  return (
    <aside
      className="sidebar-collapsible"
      data-collapsed={collapsed ? 'true' : 'false'}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100vh',
        width: collapsed ? '4rem' : '15rem',
        background: 'var(--sidebar-bg)',
        color: 'var(--sidebar-text)',
        display: 'flex',
        flexDirection: 'column',
        // No top padding — the brand row owns its own 3rem height to align
        // with the topbar. Side padding keeps nav items from kissing edges.
        padding: collapsed ? '0 0.5rem 0.75rem' : '0 0.75rem 1rem',
        zIndex: 50,
        transition: 'width 200ms ease, padding 200ms ease',
      }}
    >
      {/* ─── Brand mark + toggle (cross-fade) ──────────────────────── */}
      {/* Height matches the topbar (3rem) so the logo aligns horizontally
       * with the pharmacy name across the divider. Bottom margin includes
       * the topbar's 1px border so nav sits right where the topbar ends. */}
      <div
        onMouseEnter={() => setLogoHovered(true)}
        onMouseLeave={() => setLogoHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: collapsed ? '0' : '0 0.75rem',
          height: '3rem',
          marginBottom: '0.75rem',
          flexShrink: 0,
        }}
      >
        {collapsed ? (
          <button
            onClick={onToggle}
            aria-label="Expand sidebar"
            style={{
              position: 'relative',
              width: '2.25rem',
              height: '2.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--sidebar-text-muted)',
              borderRadius: '0.375rem',
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: logoHovered ? 0 : 1,
                transition: 'opacity 150ms ease',
              }}
            >
              <BrandMark />
            </span>
            <span
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: logoHovered ? 1 : 0,
                transition: 'opacity 150ms ease',
              }}
            >
              <ToggleIcon />
            </span>
          </button>
        ) : (
          <>
            <Link
              href="/dashboard"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: 'var(--sidebar-active-text)',
                textDecoration: 'none',
              }}
            >
              <BrandMark />
              <span
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  letterSpacing: '-0.015em',
                }}
              >
                Reckon
              </span>
            </Link>
            <button
              onClick={onToggle}
              aria-label="Collapse sidebar"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '1.75rem',
                height: '1.75rem',
                borderRadius: '0.375rem',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--sidebar-text-muted)',
                transition: 'background 120ms ease, color 120ms ease',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--sidebar-active-bg)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--sidebar-active-text)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--sidebar-text-muted)';
              }}
            >
              <ToggleIcon />
            </button>
          </>
        )}
      </div>

      {/* ─── Nav ────────────────────────────────────────────────────── */}
      <nav
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.125rem',
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {PRIMARY_LINKS.map(link => (
          <NavItem
            key={link.id}
            link={link}
            collapsed={collapsed}
            active={isActive(link)}
            hovered={hoveredId === link.id}
            onHover={() => setHoveredId(link.id)}
            onLeave={() => setHoveredId(null)}
          />
        ))}

        {!collapsed && (
          <p
            className="sidebar-section-label"
            style={{ marginTop: '1.25rem', marginBottom: '0.25rem' }}
          >
            Settings
          </p>
        )}
        {collapsed && (
          <div
            aria-hidden
            style={{
              height: '1px',
              background: 'var(--sidebar-divider)',
              margin: '0.75rem 0.5rem',
            }}
          />
        )}
        {SETTINGS_LINKS.map(link => (
          <NavItem
            key={link.id}
            link={link}
            collapsed={collapsed}
            active={isActive(link)}
            hovered={hoveredId === link.id}
            onHover={() => setHoveredId(link.id)}
            onLeave={() => setHoveredId(null)}
          />
        ))}
      </nav>

      {/* ─── Footer (signed in / logout) ───────────────────────────── */}
      <div
        style={{
          marginTop: 'auto',
          paddingTop: '0.75rem',
          borderTop: '1px solid var(--sidebar-divider)',
        }}
      >
        {!collapsed ? (
          <>
            <p
              className="sidebar-section-label"
              style={{ marginBottom: '0.25rem' }}
            >
              Signed in
            </p>
            <p
              title={userEmail}
              style={{
                fontSize: '12px',
                color: 'var(--sidebar-text)',
                margin: 0,
                padding: '0 0.75rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {userEmail}
            </p>
            <div style={{ marginTop: '0.5rem', padding: '0 0.75rem' }}>
              <LogoutButton />
            </div>
          </>
        ) : (
          <CollapsedAvatar email={userEmail} />
        )}
      </div>
    </aside>
  );
}

// ────────────────────────────────────────────────────────────────────
// NavItem — one link in the sidebar, two render modes (expanded, collapsed)
// ────────────────────────────────────────────────────────────────────

function NavItem({
  link,
  collapsed,
  active,
  hovered,
  onHover,
  onLeave,
}: {
  link: NavLink;
  collapsed: boolean;
  active: boolean;
  hovered: boolean;
  onHover: () => void;
  onLeave: () => void;
}) {
  if (collapsed) {
    return (
      <div
        style={{ position: 'relative' }}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
      >
        <Link
          href={link.href}
          aria-label={link.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2.5rem',
            height: '2.5rem',
            margin: '0 auto',
            borderRadius: '0.5rem',
            background: active
              ? 'var(--sidebar-active-bg)'
              : hovered
              ? 'var(--sidebar-active-bg)'
              : 'transparent',
            color: active ? 'var(--sidebar-active-text)' : 'var(--sidebar-text-muted)',
            transition: 'background 120ms ease, color 120ms ease',
            textDecoration: 'none',
          }}
        >
          <NavIcon id={link.id} active={active} />
        </Link>
        {hovered && <HoverLabel label={link.label} />}
      </div>
    );
  }

  return (
    <Link
      href={link.href}
      className="sidebar-link"
      data-active={active ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        padding: '0.4375rem 0.75rem',
        borderRadius: '0.375rem',
        fontSize: '13px',
        fontWeight: active ? 500 : 500,
        color: active ? 'var(--sidebar-active-text)' : 'var(--sidebar-text-muted)',
        background: active ? 'var(--sidebar-active-bg)' : 'transparent',
        textDecoration: 'none',
        transition: 'background 120ms ease, color 120ms ease',
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1.25rem',
          height: '1.25rem',
          flexShrink: 0,
        }}
      >
        <NavIcon id={link.id} active={active} />
      </span>
      <span>{link.label}</span>
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────
// HoverLabel — floating tooltip when sidebar is collapsed
// ────────────────────────────────────────────────────────────────────

function HoverLabel({ label }: { label: string }) {
  /* Anchored to the parent NavItem (which has position: relative) so the
   * tooltip tracks the icon's vertical position rather than the cursor's
   * last-known coordinate. left: 100% pushes it just outside the sidebar,
   * top: 50% + translateY(-50%) centers it on the icon. */
  return (
    <span
      role="tooltip"
      style={{
        position: 'absolute',
        left: 'calc(100% + 0.5rem)',
        top: '50%',
        transform: 'translateY(-50%)',
        padding: '0.25rem 0.625rem',
        background: 'var(--sidebar-bg)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '0.375rem',
        fontSize: '12px',
        color: 'var(--sidebar-active-text)',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {label}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────
// CollapsedAvatar — bottom of collapsed sidebar
// ────────────────────────────────────────────────────────────────────

function CollapsedAvatar({ email }: { email: string }) {
  const initial = (email[0] ?? '?').toUpperCase();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        title={email}
        style={{
          width: '1.75rem',
          height: '1.75rem',
          borderRadius: '50%',
          border: '1px solid var(--sidebar-divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          fontWeight: 500,
          color: 'var(--sidebar-text-muted)',
        }}
      >
        {initial}
      </div>
      {hovered && <HoverLabel label={email} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Brand mark + toggle icon
// ────────────────────────────────────────────────────────────────────

function BrandMark({ size = 22 }: { size?: number }) {
  /* Geometric R-and-tick: four polygons forming an angular "R" with a check
   * built into the negative space. Cyan + indigo + navy + violet. The viewBox
   * is cropped to the artwork bounds (130-346 x 80-384 in the original 500x500
   * file) so it renders cleanly at small sizes. */
  return (
    <svg
      width={size}
      height={size * (320 / 240)}
      viewBox="120 70 240 320"
      shapeRendering="geometricPrecision"
      aria-hidden
      style={{ display: 'block' }}
    >
      <polygon points="130,120 202,160 202,240 130,200" fill="#67D2F3" />
      <polygon points="130,200 202,160 202,240" fill="#2C2A9A" />
      <polygon points="202,160 346,80 346,160 202,240" fill="#7163F6" />
      <polygon points="130,280 202,240 202,344 130,384" fill="#109DDB" />
    </svg>
  );
}

function ToggleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 4v16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────
// Nav icons — outline 1.5 stroke style, matches Amos quality bar
// ────────────────────────────────────────────────────────────────────

function NavIcon({ id, active }: { id: string; active: boolean }) {
  const stroke = active ? 'var(--sidebar-active-text)' : 'var(--sidebar-text-muted)';
  const cls = { width: '18px', height: '18px', flexShrink: 0 } as const;

  switch (id) {
    case 'dashboard':
      return (
        <svg style={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={stroke}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
          />
        </svg>
      );
    case 'deliveries':
      return (
        <svg style={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={stroke}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"
          />
        </svg>
      );
    case 'statements':
      return (
        <svg style={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={stroke}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
      );
    case 'credits':
      return (
        <svg style={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={stroke}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
          />
        </svg>
      );
    case 'upload':
      return (
        <svg style={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={stroke}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
      );
    case 'suppliers':
      return (
        <svg style={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={stroke}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z"
          />
        </svg>
      );
    default:
      return null;
  }
}
