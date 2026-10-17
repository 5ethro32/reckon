/**
 * Authenticated app shell — server-side auth gate, then hands off to the
 * client AppShell which owns sidebar collapse state.
 *
 * Why split: the sidebar is a client component (it persists collapse state
 * to localStorage and renders icons conditionally). The layout itself does
 * a Supabase auth check, so it must stay server-rendered. AppShell is the
 * boundary.
 *
 * Onboarding gate: if the user's pharmacy_memberships.onboarded_at IS NULL,
 * we render OnboardingModal instead of AppShell. The modal is a blocking
 * full-screen overlay — there is no skip. On completion it does
 * window.location.reload() so this layout re-runs and onboarded_at is set.
 */

import { redirect } from 'next/navigation';
import { getCurrentMembership, getCurrentUser } from '@/lib/session';
import AppShell from './app-shell';
import OnboardingModal from './onboarding-modal';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Both are request-cached: pages that also need them reuse these lookups.
  const user = await getCurrentUser();
  if (!user) redirect('/');

  const membership = await getCurrentMembership();
  if (!membership) redirect('/no-access');

  const pharmacy = membership.pharmacy;

  if (!membership.onboarded_at) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--surface-raised)' }}>
        <OnboardingModal currentPharmacyName={pharmacy.name} />
      </div>
    );
  }

  return (
    <AppShell userEmail={user.email ?? ''} pharmacyName={pharmacy.name}>
      {children}
    </AppShell>
  );
}
