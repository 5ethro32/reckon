/**
 * /auth/reset — landing page for password recovery emails.
 *
 * The recovery link from supabase.auth.resetPasswordForEmail can arrive
 * in two shapes:
 *   PKCE:     /auth/reset?code=...
 *   Implicit: /auth/reset#access_token=...&type=recovery
 *
 * The fragment form is only readable in the browser, so this page is a
 * thin server wrapper that renders the client handler. The handler
 * establishes the session, then renders the "set new password" form.
 *
 * IMPORTANT: after the new password is saved, the user is signed out so
 * the recovery session can't be reused — they must re-login with the
 * new password.
 */

import { Suspense } from 'react';
import ResetHandler from './reset-handler';

export default function ResetPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      background: 'var(--background)',
    }}>
      <main style={{
        width: '100%',
        maxWidth: '22rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '2rem',
        }}>
          <svg
            width="24"
            height="32"
            viewBox="120 70 240 320"
            shapeRendering="geometricPrecision"
            aria-hidden
            style={{ display: 'block' }}
          >
            <polygon points="130,120 202,160 202,240 130,200" fill="#67D2F3" />
            <polygon points="130,200 202,160 202,240" fill="#2C2A9A" />
            <polygon points="202,160 346,80 346,160 202,240" fill="#7163F6" />
            <polygon points="130,280 202,240 202,344 130,384" fill="#109DDB" />
          </svg>
          <span style={{ fontSize: '17px', fontWeight: 600, letterSpacing: '-0.015em' }}>
            Reckon
          </span>
        </div>
        <Suspense fallback={<p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>Loading…</p>}>
          <ResetHandler />
        </Suspense>
      </main>
    </div>
  );
}
