/**
 * Root proxy (Next.js 16 — formerly middleware.ts).
 *
 * Note: imports here MUST use relative paths, not the @/ alias.
 * Next.js 16.2 + Turbopack has a known bug where proxy.ts compiled in an
 * isolated graph can't resolve aliased imports (TypeError: adapterFn is
 * not a function). Relative imports work around it.
 */

import { type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const proxyConfig = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
