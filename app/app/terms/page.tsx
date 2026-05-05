/**
 * Terms of use — public page, no auth required.
 *
 * Concise, friendly, no legalese. Mirrors the visual style of /privacy so
 * the trust pages feel like a coherent set.
 */
import Link from 'next/link';

export default function TermsPage() {
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
            Terms of use
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
            Short, friendly, honest.
          </p>
        </header>

        <h2 style={h2Style}>What Reckon is</h2>
        <p style={bodyStyle}>
          Reckon is a free tool for UK pharmacies to reconcile wholesaler
          invoices and statements. We built it because reconciliation is slow
          and error-prone with paper and spreadsheets, and there was no good
          tool for independent pharmacies. It&apos;s operated by Jethro
          Goldsmith.
        </p>

        <h2 style={h2Style}>Free of charge</h2>
        <p style={bodyStyle}>
          The hosted version at reckon.vercel.app is free. There are no fees,
          no service-level agreement, and no warranty. We do our best to keep
          it running, but if it breaks at 2am we are probably asleep.
        </p>

        <h2 style={h2Style}>Your responsibilities</h2>
        <ul style={listStyle}>
          <li style={liStyle}>Only upload data you have the legal right to upload (your own pharmacy&apos;s invoices and statements).</li>
          <li style={liStyle}>Do not try to break the service, scrape other users&apos; data, or interfere with the infrastructure.</li>
          <li style={liStyle}>Do not use the service for anything illegal.</li>
        </ul>

        <h2 style={h2Style}>Our commitments</h2>
        <ul style={listStyle}>
          <li style={liStyle}>We&apos;ll do our best to keep the service running and your data safe.</li>
          <li style={liStyle}>If a breach affecting your data is detected, we&apos;ll email you within 72 hours.</li>
          <li style={liStyle}>If we ever decide to shut down the service, we&apos;ll give you 30 days notice and offer a way to export your data.</li>
        </ul>

        <h2 style={h2Style}>Intellectual property</h2>
        <p style={bodyStyle}>
          Your data is yours. The Reckon code is owned by Jethro Goldsmith and
          made available under the licence in the public GitHub repository.
        </p>

        <h2 style={h2Style}>Liability</h2>
        <p style={bodyStyle}>
          We provide the service as-is. We are not liable for any indirect or
          consequential losses (lost revenue, lost data, missed business
          opportunities). Our total liability is limited to a refund of any
          fees you have paid us — which, since the service is free, is zero.
        </p>
        <p style={bodyStyle}>
          You remain responsible for backing up your own data. Don&apos;t use
          Reckon as your only copy of your invoices.
        </p>

        <h2 style={h2Style}>Privacy</h2>
        <p style={bodyStyle}>
          See our <Link href="/privacy">privacy notice</Link> for details on how
          we handle your data.
        </p>

        <h2 style={h2Style}>Governing law</h2>
        <p style={bodyStyle}>
          These terms are governed by the laws of England and Wales. Any
          dispute is subject to the exclusive jurisdiction of the courts of
          England and Wales.
        </p>

        <h2 style={h2Style}>Changes to these terms</h2>
        <p style={bodyStyle}>
          If we materially change these terms, we&apos;ll email you before the
          change takes effect.
        </p>

        <h2 style={h2Style}>Contact</h2>
        <p style={bodyStyle}>
          Questions? Email{' '}
          <a href="mailto:jethrogoldsmith@gmail.com">jethrogoldsmith@gmail.com</a>.
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
