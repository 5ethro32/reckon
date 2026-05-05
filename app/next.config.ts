import type { NextConfig } from 'next';
import { join } from 'node:path';

const nextConfig: NextConfig = {
  // Tell Turbopack the workspace root is one directory up (the monorepo root)
  // so it stops picking up the stray ~/package-lock.json in the home directory.
  turbopack: {
    root: join(__dirname, '..'),
  },

  // Mark the parser as transpilable so Turbopack handles its TypeScript source
  // when imported from server components / route handlers.
  transpilePackages: ['@reckon/parser'],

  // Native Node binaries used by the OCR fallback can't be bundled by
  // Turbopack — they're loaded dynamically at runtime via Node's require().
  // This list tells Next.js to leave them out of the bundle and resolve
  // them from node_modules at runtime.
  serverExternalPackages: [
    '@napi-rs/canvas',
    'tesseract.js',
    'tesseract.js-core',
    'pdf-parse',
  ],
};

export default nextConfig;
