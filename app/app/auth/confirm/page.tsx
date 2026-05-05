/**
 * Implicit-flow magic link handler.
 *
 * Server-side redirects from /auth/callback land here when the auth token
 * came back as a URL fragment (#access_token=...) instead of a query param.
 *
 * The fragment is only readable in the browser, so this page is purely
 * client-side. It reads the fragment, hands it to the Supabase client
 * (which sets the session cookie), then redirects to /dashboard or
 * /no-access depending on membership.
 */

import ConfirmHandler from './confirm-handler';

export default function ConfirmPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      background: 'var(--surface-raised)',
    }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '13px', color: 'var(--muted)' }}>Signing you in…</p>
        <ConfirmHandler />
      </div>
    </div>
  );
}
