/**
 * Settings page — server component.
 *
 * Fetches the current user's profile data (display_name, email) and their
 * pharmacy name, then hands off to the SettingsForm client component.
 *
 * Query mirrors the layout.tsx membership select, extended to also pull
 * display_name from pharmacy_memberships.
 */
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SettingsForm from './settings-form';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const { data: memberships, error } = await supabase
    .from('pharmacy_memberships')
    .select('display_name, pharmacy_id, pharmacies(id, name)')
    .eq('user_id', user.id)
    .limit(1);

  if (error || !memberships || memberships.length === 0) {
    redirect('/no-access');
  }

  const membership = memberships[0]!;
  const pharmacyRaw = membership.pharmacies as
    | { id: string; name: string }
    | { id: string; name: string }[]
    | null;
  const pharmacy = Array.isArray(pharmacyRaw) ? pharmacyRaw[0]! : pharmacyRaw!;

  return (
    <div style={{ maxWidth: '36rem' }}>
      <div className="page-header" style={{ marginBottom: '1.75rem' }}>
        <div>
          <h1 className="page-header-title">Settings</h1>
          <p className="page-header-subtitle">
            Manage your name, pharmacy details, and account.
          </p>
        </div>
      </div>

      <SettingsForm
        initialDisplayName={membership.display_name ?? ''}
        initialPharmacyName={pharmacy.name}
        pharmacyId={pharmacy.id}
        userEmail={user.email ?? ''}
      />
    </div>
  );
}
