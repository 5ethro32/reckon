/**
 * Auth-refreshing proxy helper (Next.js 16+ uses /proxy.ts not /middleware.ts).
 *
 * Called from the root /proxy.ts for every request. Reads the Supabase session
 * cookie, refreshes the token if it's about to expire, and writes the updated
 * cookie back to the response. Without this, sessions silently expire mid-flow.
 *
 * Defensive belt-and-braces: short-circuit any _next/* / static asset requests
 * BEFORE the proxy even loads Supabase. The matcher in proxy.ts should already
 * exclude these, but if any slip through (percent-encoded paths, etc.) we
 * skip auth here.
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Skip Supabase entirely for static assets and Next internals.
  // This prevents 307 redirects on CSS/JS/font requests.
  if (
    path.startsWith('/_next/') ||
    path.startsWith('/favicon') ||
    /\.(css|js|map|svg|png|jpg|jpeg|gif|webp|ico|woff2?)$/i.test(path)
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Public routes that don't require auth. '/' IS the login page in this app.
  // /privacy and /terms are public so visitors can read them before signing
  // up. Anything under /auth/ is also public (callback, confirm) — those
  // routes establish the session.
  const publicPaths = ['/', '/no-access', '/privacy', '/terms'];
  const isPublic =
    publicPaths.some(p => path === p) ||
    path.startsWith('/auth/');

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}
