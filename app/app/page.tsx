/**
 * Landing page = login.
 *
 * No signup, no marketing. Mono / clean / Anthropic-aligned design.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import LoginForm from './login-form';
import AuthFragmentBouncer from './auth-fragment-bouncer';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect('/dashboard');
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      background: 'var(--background)',
      position: 'relative',
    }}>
      {/* Catches magic links that arrive with #access_token in the URL */}
      <AuthFragmentBouncer />

      <main style={{
        width: '100%',
        maxWidth: '22rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        {/* Brand mark — small, restrained */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '2.5rem',
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
          <span style={{
            fontSize: '17px',
            fontWeight: 600,
            letterSpacing: '-0.015em',
          }}>Reckon</span>
        </div>

        <div style={{ width: '100%' }}>
          <h1 style={{
            fontSize: '22px',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: 0,
            marginBottom: '0.5rem',
            textAlign: 'center',
          }}>Sign in to Reckon</h1>
          <p style={{
            fontSize: '13px',
            color: 'var(--muted)',
            margin: 0,
            marginBottom: '2rem',
            textAlign: 'center',
            lineHeight: 1.5,
          }}>
            Enter your email and we&apos;ll send a sign-in link.
          </p>
          <LoginForm />
        </div>
      </main>

      <footer style={{
        position: 'absolute',
        bottom: '1.5rem',
        left: 0,
        right: 0,
        textAlign: 'center',
      }}>
        <p style={{
          fontSize: '11px',
          color: 'var(--muted-light)',
          margin: 0,
        }}>
          Invoice and statement reconciliation for UK pharmacies.
        </p>
      </footer>
    </div>
  );
}
