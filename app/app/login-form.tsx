'use client';

/**
 * Sign-in form supporting two flows:
 *
 *   1. Email code (default, primary CTA) — Supabase emails a one-time code,
 *      typed in here (verifyOtp). The same email carries a link as a fallback,
 *      but the code is what works when a mail scanner (Microsoft 365 Safe
 *      Links) opens the link first, or the email is read on another device.
 *      Subject to Supabase's 2-emails-per-hour rate limit on the default SMTP.
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
import Link from 'next/link';
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
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

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

  async function handleCode(e: React.FormEvent) {
    e.preventDefault();
    const token = code.replace(/\s+/g, '');
    if (!/^\d{6,10}$/.test(token)) { setErrorMessage('Enter the code from the email.'); return; }
    setVerifying(true);
    setErrorMessage('');
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) {
      setVerifying(false);
      setErrorMessage(/expired|invalid/i.test(error.message) ? 'That code has expired or is wrong. Check the latest email, or send a new code.' : error.message);
      return;
    }
    const failed = await finishSignIn(supabase);
    if (failed) { setVerifying(false); setErrorMessage(failed); }
  }

  /** After any sign-in: make sure the user has a pharmacy, then open the dashboard. Returns an error message, or null. */
  async function finishSignIn(supabase: ReturnType<typeof createClient>): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 'Sign-in succeeded but no user returned. Please try again.';
    const { data: memberships } = await supabase.from('pharmacy_memberships').select('pharmacy_id').eq('user_id', user.id).limit(1);
    if (!memberships || memberships.length === 0) {
      const { error: rpcError } = await supabase.rpc('setup_new_pharmacy', { p_pharmacy_name: 'My Pharmacy' });
      if (rpcError) return 'Could not set up your account: ' + rpcError.message;
    }
    router.push('/dashboard');
    router.refresh();
    return null;
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
      <form className="fade-in" onSubmit={handleCode} style={{ padding: '0.25rem 0' }}>
        <p style={{ fontSize: '14px', fontWeight: 600, margin: 0, marginBottom: '0.25rem' }}>
          Check your inbox
        </p>
        <p style={{ fontSize: '12.5px', color: 'var(--muted)', margin: 0, marginBottom: '0.9rem', lineHeight: 1.5 }}>
          We sent a sign-in code to <span style={{ color: 'var(--foreground)' }}>{email}</span>. Type it here.
        </p>
        <input
          className="input"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="Code"
          aria-label="Sign-in code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ width: '100%', fontSize: '20px', letterSpacing: '0.2em', textAlign: 'center', marginBottom: '0.6rem' }}
        />
        {errorMessage && <p role="alert" style={{ fontSize: '12.5px', color: 'var(--status-error-text, #c0392b)', margin: '0 0 0.6rem' }}>{errorMessage}</p>}
        <button type="submit" className="btn btn-primary" disabled={verifying} style={{ width: '100%' }}>
          {verifying ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className="btn-link" onClick={() => { setStatus('idle'); setCode(''); setErrorMessage(''); }} style={{ display: 'block', margin: '0.75rem auto 0', fontSize: '12.5px', background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer' }}>
          Use a different email
        </button>
      </form>
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
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}>
            <label htmlFor="password" className="label">Password</label>
            <Link
              href="/forgot"
              style={{
                fontSize: '11px',
                color: 'var(--muted)',
                textDecoration: 'underline',
                textDecorationColor: 'var(--border)',
                textUnderlineOffset: '3px',
              }}
            >
              Forgot password?
            </Link>
          </div>
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
          ? (isPassword ? 'Signing in…' : 'Sending code…')
          : (isPassword ? 'Sign in' : 'Email me a sign-in code')}
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
          ? 'Use an email code instead'
          : 'Sign in with password instead'}
      </button>
    </form>
  );
}
