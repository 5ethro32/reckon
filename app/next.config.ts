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
};

export default nextConfig;
