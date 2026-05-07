'use client';

/**
 * SettingsForm — client component for the /settings page.
 *
 * Two separate forms (Profile + Pharmacy) so saves are independent. Each
 * tracks isDirty and disables the save button until the value changes from
 * the last-saved state.
 *
 * Save pattern: PATCH /api/profile, show inline success badge that fades
 * after 2s, call router.refresh() so server-rendered values update.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LogoutButton from '@/app/logout-button';
import { CONTACT_EMAIL } from '@/lib/contact';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function SettingsForm({
  initialDisplayName,
  initialPharmacyName,
  pharmacyId,
  userEmail,
}: {
  initialDisplayName: string;
  initialPharmacyName: string;
  pharmacyId: string;
  userEmail: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <ProfileCard
        initialDisplayName={initialDisplayName}
        userEmail={userEmail}
      />
      <PharmacyCard
        initialPharmacyName={initialPharmacyName}
        pharmacyId={pharmacyId}
      />
      <AccountCard />
    </div>
  );
}

function ProfileCard({
  initialDisplayName,
  userEmail,
}: {
  initialDisplayName: string;
  userEmail: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [savedDisplayName, setSavedDisplayName] = useState(initialDisplayName);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isDirty = displayName !== savedDisplayName;

  async function handleSave() {
    if (!isDirty) return;
    setSaveState('saving');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setSavedDisplayName(displayName);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
      router.refresh();
    } catch (err) {
      setSaveState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <p className="section-label" style={{ marginBottom: '1rem' }}>
        Profile
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        <div>
          <label htmlFor="display-name" className="label">
            Display name
          </label>
          <input
            id="display-name"
            className="input"
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="e.g. Sarah Smith"
            maxLength={120}
          />
        </div>

        <div>
          <p className="label" style={{ marginBottom: '0.375rem' }}>
            Email
          </p>
          <p
            style={{
              fontSize: '13px',
              color: 'var(--muted)',
              margin: 0,
              lineHeight: '2.25rem',
            }}
          >
            {userEmail}
          </p>
        </div>
      </div>

      <div
        style={{
          marginTop: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          disabled={!isDirty || saveState === 'saving'}
          onClick={handleSave}
        >
          {saveState === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <SaveFeedback state={saveState} errorMsg={errorMsg} />
      </div>
    </div>
  );
}

function PharmacyCard({
  initialPharmacyName,
  pharmacyId,
}: {
  initialPharmacyName: string;
  pharmacyId: string;
}) {
  const router = useRouter();
  const [pharmacyName, setPharmacyName] = useState(initialPharmacyName);
  const [savedPharmacyName, setSavedPharmacyName] = useState(initialPharmacyName);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isDirty = pharmacyName !== savedPharmacyName;

  async function handleSave() {
    if (!isDirty) return;
    setSaveState('saving');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pharmacyName }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setSavedPharmacyName(pharmacyName);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
      router.refresh();
    } catch (err) {
      setSaveState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <p className="section-label" style={{ marginBottom: '1rem' }}>
        Pharmacy
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        <div>
          <label htmlFor="pharmacy-name" className="label">
            Pharmacy name
          </label>
          <input
            id="pharmacy-name"
            className="input"
            type="text"
            value={pharmacyName}
            onChange={e => setPharmacyName(e.target.value)}
            placeholder="e.g. High Street Pharmacy"
            maxLength={200}
          />
        </div>

        <div>
          <p className="label" style={{ marginBottom: '0.375rem' }}>
            Pharmacy ID
          </p>
          <p
            style={{
              fontSize: '12px',
              color: 'var(--muted)',
              margin: 0,
              lineHeight: 1.5,
              wordBreak: 'break-all',
            }}
          >
            {pharmacyId}
          </p>
        </div>
      </div>

      <div
        style={{
          marginTop: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          disabled={!isDirty || saveState === 'saving'}
          onClick={handleSave}
        >
          {saveState === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <SaveFeedback state={saveState} errorMsg={errorMsg} />
      </div>
    </div>
  );
}

function AccountCard() {
  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <p className="section-label" style={{ marginBottom: '1rem' }}>
        Account
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        <div>
          <LogoutButton variant="standalone" />
        </div>
        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
          To delete your account or export your data, email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </div>
    </div>
  );
}

function SaveFeedback({ state, errorMsg }: { state: SaveState; errorMsg: string | null }) {
  if (state === 'idle') return null;
  if (state === 'saving') {
    return (
      <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Saving…</span>
    );
  }
  if (state === 'saved') {
    return <span className="badge badge-success">Saved</span>;
  }
  return (
    <span
      className="badge badge-critical"
      title={errorMsg ?? undefined}
      style={{ maxWidth: '20rem', overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      {errorMsg ?? 'Save failed'}
    </span>
  );
}
