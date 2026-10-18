import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { THEME_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Reckon',
  description: 'Invoice and statement reconciliation for UK pharmacies',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the phone tab bar sit above the home indicator.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The theme script sets data-theme before paint, so React must not
    // complain that the attribute differs from the server render.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
        {children}
        {/* Vercel Analytics — privacy-respecting, no cookies, GDPR-friendly.
         * Only fires in production via Vercel's environment detection. */}
        <Analytics />
      </body>
    </html>
  );
}
