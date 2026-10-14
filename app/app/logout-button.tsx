'use client';

import { useRouter } from 'next/navigation';

type Props = {
  variant?: 'sidebar' | 'standalone';
};

export default function LogoutButton({ variant = 'sidebar' }: Props) {
  const router = useRouter();

  async function handleLogout() {
    // Loaded on click: the sidebar renders this on every signed-in page, and
    // supabase-js is otherwise the largest library those pages would ship.
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  }

  if (variant === 'standalone') {
    return (
      <button onClick={handleLogout} className="btn btn-secondary btn-sm">
        Sign out
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        fontSize: '12px',
        color: 'var(--sidebar-text-muted)',
        cursor: 'pointer',
        textDecoration: 'underline',
        textUnderlineOffset: '3px',
        fontFamily: 'inherit',
      }}
    >
      Sign out
    </button>
  );
}
