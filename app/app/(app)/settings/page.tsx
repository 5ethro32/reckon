/**
 * Settings page — server component.
 *
 * Fetches the current user's profile data (display_name, email) and their
 * pharmacy name, then hands off to the SettingsForm client component.
 *
 * The user and membership come from the request cache the layout already
 * filled, so this page adds no Supabase round trips of its own.
 */
import { redirect } from 'next/navigation';
import { getCurrentMembership, getCurrentUser } from '@/lib/session';
import SettingsForm from './settings-form';

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  const membership = await getCurrentMembership();
  if (!membership) redirect('/no-access');
  const pharmacy = membership.pharmacy;
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
