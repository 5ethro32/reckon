/**
 * Privacy notice — public page, no auth required.
 *
 * Sits outside the (app) route group so it gets only the root layout. UK
 * GDPR-aware copy: specific, plain-English, honest about subprocessors and
 * data location.
 */
import Link from 'next/link';
import { CONTACT_EMAIL, OPERATOR_NAME } from '@/lib/contact';

export default function PrivacyPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--background)',
        color: 'var(--foreground)',
      }}
    >
      <div
        style={{
          maxWidth: '42rem',
          margin: '0 auto',
          padding: '3rem 1.5rem 4rem',
        }}
      >
        <header style={{ marginBottom: '2.5rem' }}>
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              textDecoration: 'none',
              color: 'var(--foreground)',
              marginBottom: '2rem',
            }}
          >
            <BrandMark />
            <span style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-0.015em' }}>
              Reckon
            </span>
          </Link>

          <h1
            style={{
              fontSize: '22px',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              margin: 0,
              marginBottom: '0.5rem',
            }}
          >
            Privacy notice
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
            Plain English. UK GDPR-aware. No tracking.
          </p>
        </header>

        <h2 style={h2Style}>Who we are</h2>
        <p style={bodyStyle}>
          This instance of Reckon is operated by {OPERATOR_NAME}. You can
          reach us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
        <p style={bodyStyle}>
          For your data, the pharmacy is the data controller; {OPERATOR_NAME}{' '}
          is the data processor.
        </p>

        <h2 style={h2Style}>What we collect</h2>
        <p style={bodyStyle}>
          We collect only what we need to run the service:
        </p>
        <ul style={listStyle}>
          <li style={liStyle}>Your email address, used to sign you in via magic link.</li>
          <li style={liStyle}>Your name and pharmacy name, set during onboarding.</li>
          <li style={liStyle}>The PDFs you upload (wholesaler invoices and statements), stored in our database.</li>
          <li style={liStyle}>The data parsed from those PDFs: invoice headers, line items, statement rows, credit requests, and supplier contact preferences.</li>
        </ul>

        <p style={bodyStyle}>What we do <strong>not</strong> collect:</p>
        <ul style={listStyle}>
          <li style={liStyle}>Passwords. We use magic-link authentication, so there are no passwords to leak.</li>
          <li style={liStyle}>Patient data. Reckon only sees supplier invoices, not anything related to your patients.</li>
          <li style={liStyle}>Payment information. The service is free.</li>
          <li style={liStyle}>Tracking cookies, analytics, or advertising identifiers.</li>
        </ul>

        <h2 style={h2Style}>Why we collect it</h2>
        <p style={bodyStyle}>
          We process this data to provide the reconciliation service you signed
          up to use. Our legal basis is legitimate interest — the bare minimum
          to make the product work.
        </p>

        <h2 style={h2Style}>Where we store it</h2>
        <p style={bodyStyle}>
          Your data lives entirely in the UK and EU:
        </p>
        <ul style={listStyle}>
          <li style={liStyle}>The database is hosted on Supabase in the eu-west-2 (London) region.</li>
          <li style={liStyle}>The application is hosted on Vercel in their Frankfurt region.</li>
        </ul>
        <p style={bodyStyle}>
          We do not transfer your data outside the UK or EU.
        </p>

        <h2 style={h2Style}>Who can access it</h2>
        <ul style={listStyle}>
          <li style={liStyle}>You — through the app.</li>
          <li style={liStyle}>{OPERATOR_NAME} for support purposes, but only with your explicit permission for any specific support request, or for system maintenance like applying schema migrations.</li>
          <li style={liStyle}>Supabase Inc — they host the database and have technical access, but contractually do not access customer data.</li>
          <li style={liStyle}>Vercel Inc — they host the application code; they do not have access to database contents.</li>
        </ul>

        <h2 style={h2Style}>How long we keep it</h2>
        <p style={bodyStyle}>
          We keep your data for as long as you keep using the service. If you
          ask us to delete it, we will, within 30 days.
        </p>

        <h2 style={h2Style}>Your rights</h2>
        <p style={bodyStyle}>
          Under UK GDPR, you can ask us to:
        </p>
        <ul style={listStyle}>
          <li style={liStyle}>Send you a copy of all the data we hold on you.</li>
          <li style={liStyle}>Delete your account and all associated data.</li>
          <li style={liStyle}>Correct anything that is wrong.</li>
          <li style={liStyle}>Stop processing your data while a complaint is investigated.</li>
        </ul>
        <p style={bodyStyle}>
          To exercise any of these, email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          We will respond within 30 days.
        </p>

        <h2 style={h2Style}>Cookies</h2>
        <p style={bodyStyle}>
          We use one essential cookie to keep you signed in (the Supabase auth
          session). No tracking, no analytics, no advertising.
        </p>

        <h2 style={h2Style}>Security</h2>
        <p style={bodyStyle}>
          Every connection is HTTPS-only. Authentication is by magic link, so
          there are no passwords for an attacker to steal. Inside the database,
          Postgres Row Level Security enforces that you can only see your own
          pharmacy&apos;s data — that protection is at the database level, not
          just in the application code.
        </p>

        <h2 style={h2Style}>If something goes wrong</h2>
        <p style={bodyStyle}>
          If a breach affecting your data is detected, we will notify you by
          email within 72 hours, as required under UK GDPR.
        </p>

        <h2 style={h2Style}>Subprocessors</h2>
        <p style={bodyStyle}>
          We use the following providers to run the service:
        </p>
        <ul style={listStyle}>
          <li style={liStyle}>Supabase Inc — database, authentication, file storage.</li>
          <li style={liStyle}>Vercel Inc — application hosting.</li>
        </ul>

        <h2 style={h2Style}>Changes to this notice</h2>
        <p style={bodyStyle}>
          If we materially change how we handle your data, we will email you
          before the change takes effect.
        </p>

        <h2 style={h2Style}>Contact</h2>
        <p style={bodyStyle}>
          Questions, requests, complaints — all welcome. Email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <p
          style={{
            marginTop: '3rem',
            fontSize: '12px',
            color: 'var(--muted-light)',
          }}
        >
          Last updated: 5 May 2026
        </p>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <svg
      width="22"
      height="29"
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
  );
}

const h2Style: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  letterSpacing: '-0.015em',
  margin: 0,
  marginTop: '2rem',
  marginBottom: '0.625rem',
};

const bodyStyle: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: 1.7,
  color: 'var(--foreground)',
  margin: 0,
  marginBottom: '0.875rem',
};

const listStyle: React.CSSProperties = {
  margin: 0,
  marginBottom: '1rem',
  paddingLeft: '1.25rem',
};

const liStyle: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: 1.7,
  color: 'var(--foreground)',
  marginBottom: '0.25rem',
};
