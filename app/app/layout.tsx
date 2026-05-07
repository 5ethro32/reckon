import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Reckon',
  description: 'Invoice and statement reconciliation for UK pharmacies',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} style={{ height: '100%' }}>
      <body style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
        {children}
        {/* Vercel Analytics — privacy-respecting, no cookies, GDPR-friendly.
         * Only fires in production via Vercel's environment detection. */}
        <Analytics />
      </body>
    </html>
  );
}
