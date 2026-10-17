'use client';

/**
 * AppShell — the sidebar (desktop), the top bar (desktop), the tab bar
 * (phones and tablets) and the page.
 *
 * The sidebar's open state lives here, so it stays open from page to page
 * (the layout persists across navigations) and a reload starts collapsed.
 */

import { useState } from 'react';
import CollapsibleSidebar from './collapsible-sidebar';
import TabBar from './tab-bar';
import Topbar from './topbar';

export default function AppShell({
  userEmail,
  pharmacyName,
  children,
}: {
  userEmail: string;
  pharmacyName: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="app-shell" data-sidenav={open ? 'open' : 'closed'}>
      <CollapsibleSidebar open={open} onToggle={() => setOpen(o => !o)} />
      <div className="app-main">
        <Topbar pharmacyName={pharmacyName} userEmail={userEmail} />
        <main className="app-content">{children}</main>
      </div>
      <TabBar pharmacyName={pharmacyName} userEmail={userEmail} />
    </div>
  );
}
