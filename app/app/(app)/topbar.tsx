/**
 * Desktop top bar: the pharmacy in view on the left, the account on the
 * right (it opens Settings). Phones have no top bar; the tab bar and the
 * More sheet carry the same things.
 */

import Link from 'next/link';

export default function Topbar({ pharmacyName, userEmail }: { pharmacyName: string; userEmail: string }) {
  const initial = (userEmail[0] ?? '?').toUpperCase();
  return (
    <header className="app-topbar">
      <div className="topbar-context">
        <strong title={pharmacyName}>{pharmacyName}</strong>
      </div>
      <Link href="/settings" className="topbar-account" aria-label={`Settings for ${userEmail}`} title={userEmail}>
        {initial}
      </Link>
    </header>
  );
}
