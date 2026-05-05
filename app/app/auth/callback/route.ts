/**
 * Magic link callback (PKCE flow only — server-side).
 *
 * Supabase redirects here with a `code` query param that we exchange for
 * a session cookie. This handles the modern PKCE flow.
 *
 * The IMPLICIT flow (token in URL fragment #access_token=...) is handled
 * by /auth/confirm/page.tsx because the fragment never reaches the server.
 *
 * Once authenticated, we check pharmacy_memberships:
 *   - Member of at least one pharmacy → redirect to /dashboard
 *   - Authenticated but no membership → redirect to /no-access
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
    return NextResponse.redirect(`${origin}/no-access`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
