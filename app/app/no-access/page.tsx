import { createClient } from '@/lib/supabase/server';
import LogoutButton from '../logout-button';

export default async function NoAccessPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

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
        {/* Brand mark */}
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
          <span style={{
            fontSize: '17px',
            fontWeight: 600,
            letterSpacing: '-0.015em',
          }}>Reckon</span>
        </div>

        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            fontSize: '20px',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: 0,
            marginBottom: '0.625rem',
          }}>
            Setting up your account
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0, marginBottom: '0.5rem', lineHeight: 1.5 }}>
            Something went wrong creating your account for{' '}
            <span style={{ color: 'var(--foreground)' }}>{user?.email}</span>.
          </p>
          <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0, marginBottom: '1.5rem', lineHeight: 1.5 }}>
            Please try signing in again. If the problem persists, email{' '}
            <a href="mailto:jethrogoldsmith@gmail.com">jethrogoldsmith@gmail.com</a>.
          </p>
          <LogoutButton variant="standalone" />
        </div>
      </main>
    </div>
  );
}
