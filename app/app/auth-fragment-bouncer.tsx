'use client';

/**
 * Tiny client component that lives at the top of the homepage.
 *
 * If the URL contains a `#access_token=...` fragment (Supabase implicit-flow
 * magic link landed on the homepage by mistake), bounce to /auth/confirm
 * which knows how to read the fragment and set the session.
 *
 * Server components can't see URL fragments — only the browser can.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AuthFragmentBouncer() {
  const router = useRouter();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (hash && hash.includes('access_token=')) {
      // Preserve the fragment when redirecting
      router.replace('/auth/confirm' + hash);
    }
  }, [router]);
  return null;
}
