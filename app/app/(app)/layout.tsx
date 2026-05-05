/**
 * Authenticated app shell — server-side auth gate, then hands off to the
 * client AppShell which owns sidebar collapse state.
 *
 * Why split: the sidebar is a client component (it persists collapse state
 * to localStorage and renders icons conditionally). The layout itself does
 * a Supabase auth check, so it must stay server-rendered. AppShell is the
 * boundary.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AppShell from './app-shell';

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
    .select('pharmacy_id, role, pharmacies(id, name)')
    .eq('user_id', user.id)
    .limit(1);

  if (!memberships || memberships.length === 0) {
    redirect('/no-access');
  }

  const pharmacyData = memberships[0]!.pharmacies as
    | { id: string; name: string }
    | { id: string; name: string }[];
  const pharmacy = Array.isArray(pharmacyData) ? pharmacyData[0]! : pharmacyData;

  return (
    <AppShell userEmail={user.email ?? ''} pharmacyName={pharmacy.name}>
      {children}
    </AppShell>
  );
}
