'use client';

/**
 * Sign-in form supporting two flows:
 *
 *   1. Magic link (default, primary CTA) — Supabase emails a one-time link.
 *      Subject to Supabase's 2-emails-per-hour-per-recipient rate limit on
 *      the default SMTP. Will be lifted once Resend SMTP is wired up.
 *
 *   2. Password (progressive disclosure, "Sign in with password instead") —
 *      bypasses email entirely. Required as an escape hatch when the magic
 *      link rate limit hits. Also useful for users who prefer passwords.
 *
 * Post-auth, both paths converge: if the user has no pharmacy membership,
 * call setup_new_pharmacy() so the onboarding modal can prompt them. This
 * mirrors the logic in /auth/callback (PKCE) and /auth/confirm (implicit).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Mode = 'magic' | 'password';
type Status = 'idle' | 'sending' | 'sent' | 'error';

export default function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('magic');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus('sending');
    setErrorMessage('');

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus('error');
      setErrorMessage(error.message);
    } else {
      setStatus('sent');
    }
  }

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setStatus('sending');
    setErrorMessage('');

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setStatus('error');
      // Don't leak whether the email exists — generic message either way.
      setErrorMessage(
        error.message === 'Invalid login credentials'
          ? 'Incorrect email or password.'
          : error.message
      );
      return;
    }

    // Session is now set in cookies. Mirror the post-auth flow used by
    // /auth/callback: if no membership exists, create one so the onboarding
    // modal can prompt for the real pharmacy name.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setStatus('error');
      setErrorMessage('Sign-in succeeded but no user returned. Please try again.');
      return;
    }

    const { data: memberships } = await supabase
      .from('pharmacy_memberships')
      .select('pharmacy_id')
      .eq('user_id', user.id)
      .limit(1);

    if (!memberships || memberships.length === 0) {
      const { error: rpcError } = await supabase.rpc('setup_new_pharmacy', {
        p_pharmacy_name: 'My Pharmacy',
      });
      if (rpcError) {
        setStatus('error');
        setErrorMessage('Could not set up your account: ' + rpcError.message);
        return;
      }
    }

    // router.push triggers a server fetch which reads the freshly-set
    // session cookie and renders the authenticated layout.
    router.push('/dashboard');
    router.refresh();
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
          We sent a sign-in link to{' '}
          <span style={{ color: 'var(--foreground)' }}>{email}</span>
        </p>
      </div>
    );
  }

  const isPassword = mode === 'password';

  return (
    <form
      onSubmit={isPassword ? handlePasswordSignIn : handleMagicLink}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}
    >
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@pharmacy.co.uk"
          className="input"
        />
      </div>

      {isPassword && (
        <div>
          <label htmlFor="password" className="label">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            className="input"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={status === 'sending' || !email || (isPassword && !password)}
        className="btn btn-primary"
        style={{ width: '100%' }}
      >
        {status === 'sending'
          ? (isPassword ? 'Signing in…' : 'Sending sign-in link…')
          : (isPassword ? 'Sign in' : 'Send sign-in link')}
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

      <button
        type="button"
        onClick={() => {
          setMode(isPassword ? 'magic' : 'password');
          setStatus('idle');
          setErrorMessage('');
          setPassword('');
        }}
        style={{
          background: 'transparent',
          border: 'none',
          padding: '0.25rem',
          margin: '0 auto',
          fontSize: '12px',
          color: 'var(--muted)',
          cursor: 'pointer',
          textDecoration: 'underline',
          textDecorationColor: 'var(--border)',
          textUnderlineOffset: '3px',
        }}
      >
        {isPassword
          ? 'Use a sign-in link instead'
          : 'Sign in with password instead'}
      </button>
    </form>
  );
}
