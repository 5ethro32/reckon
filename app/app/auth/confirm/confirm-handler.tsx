'use client';

/**
 * Reads the URL fragment (#access_token=...&refresh_token=...) and feeds
 * the tokens into the Supabase browser client, which stores them in a
 * cookie. Then redirects to /dashboard or /no-access.
 *
 * Runs once on mount via useEffect.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function ConfirmHandler() {
  const router = useRouter();
  const [status, setStatus] = useState<string>('Verifying link...');

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const hash = window.location.hash.slice(1); // strip leading '#'
      if (!hash) {
        setStatus('No token in URL — redirecting…');
        router.replace('/?error=missing_token');
        return;
      }

      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const errorDesc = params.get('error_description');

      if (errorDesc) {
        setStatus(`Auth error: ${errorDesc}`);
        router.replace(`/?error=${encodeURIComponent(errorDesc)}`);
        return;
      }

      if (!accessToken || !refreshToken) {
        setStatus('Tokens missing — redirecting…');
        router.replace('/?error=missing_tokens');
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (cancelled) return;

      if (error) {
        setStatus(`Sign-in failed: ${error.message}`);
        router.replace(`/?error=${encodeURIComponent(error.message)}`);
        return;
      }

      // Session is set — check membership
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/?error=no_user');
        return;
      }

      const { data: memberships } = await supabase
        .from('pharmacy_memberships')
        .select('pharmacy_id')
        .eq('user_id', user.id)
        .limit(1);

      if (cancelled) return;

      // Clear the fragment so a refresh doesn't re-process expired tokens
      window.history.replaceState({}, '', window.location.pathname);

      if (!memberships || memberships.length === 0) {
        router.replace('/no-access');
      } else {
        router.replace('/dashboard');
      }
    }

    run();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <p style={{ fontSize: '11px', color: 'var(--muted-light)', marginTop: '0.5rem' }}>
      {status}
    </p>
  );
}
