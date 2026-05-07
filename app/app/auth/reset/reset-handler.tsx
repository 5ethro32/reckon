'use client';

/**
 * Reset-password handler. Establishes the recovery session (from PKCE
 * code or implicit fragment), then shows a "set new password" form.
 * After save, signs the user out so the recovery session can't be reused.
 *
 * Phase machine: verifying → ready → saving → done | error.
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Phase = 'verifying' | 'ready' | 'saving' | 'done' | 'error';

const MIN_PASSWORD_LENGTH = 8;

export default function ResetHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>('verifying');
  const [statusText, setStatusText] = useState('Verifying link…');
  const [errorMessage, setErrorMessage] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 1: establish the recovery session from whatever shape the link took
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const code = searchParams.get('code');
      const errorDesc = searchParams.get('error_description');

      if (errorDesc) {
        if (cancelled) return;
        setPhase('error');
        setErrorMessage(errorDesc);
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (error) {
          setPhase('error');
          setErrorMessage(error.message);
          return;
        }
        setPhase('ready');
        return;
      }

      // No code in the query — try the implicit fragment.
      const hash = window.location.hash.slice(1);
      if (hash) {
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const fragErr = params.get('error_description');
        if (fragErr) {
          if (cancelled) return;
          setPhase('error');
          setErrorMessage(fragErr);
          return;
        }
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (cancelled) return;
          if (error) {
            setPhase('error');
            setErrorMessage(error.message);
            return;
          }
          // Strip the fragment so a refresh doesn't replay expired tokens
          window.history.replaceState({}, '', window.location.pathname);
          setPhase('ready');
          return;
        }
      }

      // Last resort: maybe the user already has a session (clicked link
      // earlier in the same browser). If so, let them set a password.
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (user) {
        setPhase('ready');
        return;
      }

      setPhase('error');
      setErrorMessage('Invalid or expired reset link.');
    }
    run();
    return () => { cancelled = true; };
  }, [searchParams]);

  // Step 2: handle the new-password submit
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const isSaving = phase === 'saving';
  const passwordsValid =
    newPassword.length >= MIN_PASSWORD_LENGTH && newPassword === confirmPassword;
  const canSubmit = (phase === 'ready' || phase === 'saving') && passwordsValid && !isSaving;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPhase('saving');
    setErrorMessage('');

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (updateError) {
      setPhase('error');
      setErrorMessage(updateError.message);
      return;
    }

    // Sign out so the recovery session can't be reused. The user must
    // re-login with the new password — clearer mental model + safer.
    await supabase.auth.signOut();
    setPhase('done');
    setStatusText('Password updated. Redirecting to sign in…');
    setTimeout(() => router.replace('/'), 1500);
  }

  if (phase === 'verifying') {
    return (
      <div style={{ textAlign: 'center', padding: '0.75rem 0' }}>
        <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
          {statusText}
        </p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div style={{ textAlign: 'center', width: '100%' }}>
        <h1 style={{
          fontSize: '18px',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: 0,
          marginBottom: '0.5rem',
        }}>
          Link expired or invalid
        </h1>
        <p style={{
          fontSize: '12px',
          color: 'var(--status-critical-text)',
          margin: 0,
          marginBottom: '1.5rem',
          padding: '0.5rem 0.75rem',
          background: 'var(--status-critical-bg)',
          border: '1px solid var(--status-critical-border)',
          borderRadius: '0.375rem',
        }}>
          {errorMessage || 'This reset link is no longer usable.'}
        </p>
        <Link href="/forgot" className="btn btn-primary" style={{ width: '100%' }}>
          Request a new link
        </Link>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div style={{ textAlign: 'center', padding: '0.75rem 0' }}>
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
          {statusText}
        </p>
      </div>
    );
  }

  // ready / saving — render the form
  const inlineHint = mismatch
    ? 'Passwords don’t match'
    : tooShort
    ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    : null;

  return (
    <div style={{ width: '100%' }}>
      <h1 style={{
        fontSize: '22px',
        fontWeight: 600,
        letterSpacing: '-0.02em',
        margin: 0,
        marginBottom: '0.5rem',
        textAlign: 'center',
      }}>
        Set a new password
      </h1>
      <p style={{
        fontSize: '13px',
        color: 'var(--muted)',
        margin: 0,
        marginBottom: '2rem',
        textAlign: 'center',
        lineHeight: 1.5,
      }}>
        Choose something only you would know.
      </p>

      <form
        onSubmit={handleSave}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}
      >
        <div>
          <label htmlFor="reset-new" className="label">New password</label>
          <input
            id="reset-new"
            type="password"
            required
            autoFocus
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="input"
          />
        </div>

        <div>
          <label htmlFor="reset-confirm" className="label">Confirm new password</label>
          <input
            id="reset-confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className="input"
          />
        </div>

        {inlineHint && (
          <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
            {inlineHint}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="btn btn-primary"
          style={{ width: '100%' }}
        >
          {isSaving ? 'Updating…' : 'Update password'}
        </button>

        {errorMessage && (
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
    </div>
  );
}
