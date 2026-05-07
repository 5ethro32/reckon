'use client';

/**
 * Forgot-password form. Calls supabase.auth.resetPasswordForEmail and
 * always shows the same success state regardless of whether the email
 * exists — this prevents enumeration of registered addresses.
 *
 * The redirectTo URL MUST be on the Supabase project's "Redirect URLs"
 * allowlist, otherwise Supabase rejects the request. For Reckon that
 * means localhost:3013 (dev) and reckon-pharmacy.vercel.app (prod) need
 * to be on the list with /auth/reset appended.
 */

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Status = 'idle' | 'sending' | 'sent' | 'error';

export default function ForgotForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus('sending');
    setErrorMessage('');

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset`,
    });

    if (error) {
      setStatus('error');
      setErrorMessage(error.message);
    } else {
      setStatus('sent');
    }
  }

  if (status === 'sent') {
    return (
      <div className="fade-in" style={{ textAlign: 'center', padding: '0.75rem 0' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '2.25rem',
          height: '2.25rem',
          borderRadius: '50%',
          background: 'var(--status-success-bg)',
          color: 'var(--status-success-text)',
          marginBottom: '0.75rem',
          fontSize: '14px',
          fontWeight: 600,
        }}>
          ✓
        </div>
        <p style={{ fontSize: '14px', fontWeight: 500, margin: 0, marginBottom: '0.25rem' }}>
          Check your inbox
        </p>
        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
          If an account exists for{' '}
          <span style={{ color: 'var(--foreground)' }}>{email}</span>, we sent
          a password reset link.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}
    >
      <div>
        <label htmlFor="forgot-email" className="label">Email</label>
        <input
          id="forgot-email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@pharmacy.co.uk"
          className="input"
        />
      </div>

      <button
        type="submit"
        disabled={status === 'sending' || !email}
        className="btn btn-primary"
        style={{ width: '100%' }}
      >
        {status === 'sending' ? 'Sending reset link…' : 'Send reset link'}
      </button>

      {status === 'error' && (
        <p style={{
          fontSize: '12px',
          color: 'var(--status-critical-text)',
          margin: 0,
          padding: '0.5rem 0.75rem',
          background: 'var(--status-critical-bg)',
          border: '1px solid var(--status-critical-border)',
          borderRadius: '0.375rem',
        }}>
          {errorMessage}
        </p>
      )}
    </form>
  );
}
