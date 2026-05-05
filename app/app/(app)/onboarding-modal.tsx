'use client';

/**
 * OnboardingModal — first-login setup gate.
 *
 * Rendered by the authenticated layout when pharmacy_memberships.onboarded_at
 * IS NULL. Blocks the entire app until the user completes setup. There is no
 * skip button.
 *
 * Collects:
 *   - display_name  (user's preferred full name, 1–120 chars)
 *   - pharmacy_name (pharmacy trading name, 1–200 chars, pre-filled)
 *
 * On success calls window.location.reload() so the server re-renders the
 * layout without the modal and the new display_name flows through.
 *
 * No Tailwind — inline styles + CSS classes from globals.css only.
 */

import { useState } from 'react';

function BrandMark() {
  return (
    <svg
      width={32}
      height={32 * (320 / 240)}
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

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
      style={{ animation: 'reckon-spin 700ms linear infinite', flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}

export default function OnboardingModal({
  currentPharmacyName,
}: {
  currentPharmacyName: string;
}) {
  const [displayName, setDisplayName] = useState('');
  const [pharmacyName, setPharmacyName] = useState(currentPharmacyName);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<'displayName' | 'pharmacyName' | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldError(null);

    const trimmedDisplay = displayName.trim();
    const trimmedPharmacy = pharmacyName.trim();

    if (!trimmedDisplay) {
      setFieldError('displayName');
      setError('Please enter your full name.');
      return;
    }
    if (trimmedDisplay.length > 120) {
      setFieldError('displayName');
      setError('Name must be 120 characters or fewer.');
      return;
    }
    if (!trimmedPharmacy) {
      setFieldError('pharmacyName');
      setError('Please enter your pharmacy name.');
      return;
    }
    if (trimmedPharmacy.length > 200) {
      setFieldError('pharmacyName');
      setError('Pharmacy name must be 200 characters or fewer.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmedDisplay, pharmacyName: trimmedPharmacy }),
      });

      const json = (await res.json()) as { ok: boolean; error?: string };

      if (!res.ok || !json.ok) {
        const msg = json.error ?? 'Something went wrong. Please try again.';
        if (msg === 'invalid_display_name') {
          setFieldError('displayName');
          setError('Please check your name — it may be blank or too long.');
        } else if (msg === 'invalid_pharmacy_name') {
          setFieldError('pharmacyName');
          setError('Please check your pharmacy name — it may be blank or too long.');
        } else {
          setError(msg);
        }
        return;
      }

      window.location.reload();
    } catch {
      setError('Network error — please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '24rem',
          borderRadius: '0.75rem',
          background: 'var(--card-bg)',
          boxShadow: 'var(--shadow-lg)',
          padding: '2rem 1.75rem 1.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', textAlign: 'center' }}>
          <BrandMark />
          <div>
            <h1
              id="onboarding-title"
              style={{
                fontSize: '18px',
                fontWeight: 600,
                letterSpacing: '-0.015em',
                color: 'var(--foreground)',
                margin: 0,
                marginBottom: '0.375rem',
              }}
            >
              Welcome to Reckon
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
              Let&apos;s set up your account in 30 seconds.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="label" htmlFor="ob-display-name">
              Your full name
            </label>
            <input
              id="ob-display-name"
              className="input"
              type="text"
              placeholder="e.g. Stuart Burns"
              autoComplete="name"
              autoFocus
              maxLength={120}
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              disabled={loading}
              aria-invalid={fieldError === 'displayName' ? 'true' : undefined}
              style={
                fieldError === 'displayName'
                  ? { borderColor: 'var(--status-critical-text)' }
                  : undefined
              }
            />
          </div>

          <div>
            <label className="label" htmlFor="ob-pharmacy-name">
              Pharmacy name
            </label>
            <input
              id="ob-pharmacy-name"
              className="input"
              type="text"
              placeholder="e.g. Burns Pharmacy Group"
              autoComplete="organization"
              maxLength={200}
              value={pharmacyName}
              onChange={e => setPharmacyName(e.target.value)}
              disabled={loading}
              aria-invalid={fieldError === 'pharmacyName' ? 'true' : undefined}
              style={
                fieldError === 'pharmacyName'
                  ? { borderColor: 'var(--status-critical-text)' }
                  : undefined
              }
            />
          </div>

          {error && (
            <p
              role="alert"
              style={{
                fontSize: '12px',
                color: 'var(--status-critical-text)',
                margin: 0,
                padding: '0.5rem 0.75rem',
                background: 'var(--status-critical-bg)',
                border: '1px solid var(--status-critical-border)',
                borderRadius: '0.375rem',
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn"
            disabled={loading}
            style={{
              width: '100%',
              background: 'var(--brand)',
              color: '#ffffff',
              border: 'none',
              marginTop: '0.25rem',
            }}
            onMouseEnter={e => {
              if (!loading) (e.currentTarget as HTMLButtonElement).style.background = 'var(--brand-hover)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--brand)';
            }}
          >
            {loading ? (
              <>
                <Spinner />
                Setting up&hellip;
              </>
            ) : (
              'Get started'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
