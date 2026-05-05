/**
 * Magic link callback (PKCE flow only — server-side).
 *
 * Supabase redirects here with a `code` query param that we exchange for
 * a session cookie. This handles the modern PKCE flow.
 *
 * The IMPLICIT flow (token in URL fragment #access_token=...) is handled
 * by /auth/confirm/page.tsx because the fragment never reaches the server.
 *
 * Self-serve signup: if the authenticated user has no membership yet, we
 * call the setup_new_pharmacy RPC to create one with a placeholder name.
 * The onboarding modal on /dashboard will then prompt for the real names.
 *
 *   - Member of at least one pharmacy → redirect to /dashboard
 *   - Authenticated but no membership → auto-create, then /dashboard
 *   - RPC fails → /no-access fallback
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (!code) {
    // No PKCE code. Bounce to the implicit-flow handler in case the token
    // came back as a URL fragment (which only the browser can read).
    return NextResponse.redirect(`${origin}/auth/confirm`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(error.message)}`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/?error=no_user`);
  }

  const { data: memberships } = await supabase
    .from('pharmacy_memberships')
    .select('pharmacy_id')
    .eq('user_id', user.id)
    .limit(1);

  if (!memberships || memberships.length === 0) {
    // Self-serve signup: create a fresh pharmacy + membership for this user.
    // The onboarding modal on /dashboard then prompts them for the real
    // name. The RPC is idempotent — concurrent retries are safe.
    const { error: rpcError } = await supabase.rpc('setup_new_pharmacy', {
      p_pharmacy_name: 'My Pharmacy',
    });
    if (rpcError) {
      return NextResponse.redirect(
        `${origin}/?error=${encodeURIComponent('Could not set up your account: ' + rpcError.message)}`
      );
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
