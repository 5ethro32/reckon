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
import { createClient } from '@/lib/supabase/server';
import AppShell from './app-shell';
import OnboardingModal from './onboarding-modal';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const { data: memberships } = await supabase
    .from('pharmacy_memberships')
    .select('pharmacy_id, role, onboarded_at, pharmacies(id, name)')
    .eq('user_id', user.id)
    .limit(1);

  if (!memberships || memberships.length === 0) {
    redirect('/no-access');
  }

  const membership = memberships[0]!;

  const pharmacyData = membership.pharmacies as
    | { id: string; name: string }
    | { id: string; name: string }[];
  const pharmacy = Array.isArray(pharmacyData) ? pharmacyData[0]! : pharmacyData;

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
