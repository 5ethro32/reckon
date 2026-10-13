# Self-host setup

This guide walks you through running your own copy of Reckon. **It requires technical comfort with command-line tools, Supabase, and Vercel.**

## Prerequisites

- A GitHub account
- A supported Node.js LTS version compatible with the versions in `package.json` (`node --version`)
- A Supabase account ([supabase.com](https://supabase.com), check the current plan limits and permitted use)
- A Vercel account ([vercel.com](https://vercel.com), check the current plan limits and permitted use)
- An email address you can sign in with

## 1. Clone the repo

```bash
git clone https://github.com/<your-fork>/reckon.git
cd reckon
```

## 2. Install dependencies

This is an npm workspace with two packages (`@reckon/parser` and the Next.js app). One install at the root handles both.

```bash
npm install
```

## 3. Set up Supabase

### Create a project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a new project.
2. Pick the **eu-west-2 (London)** region for the database location; separately check the locations and terms of other services.
3. Wait a couple of minutes for the project to provision.

### Run the migrations

For a new database, apply every top-level SQL file in `supabase/migrations/` in filename order. Inspect the list from your checkout:

```bash
find supabase/migrations -maxdepth 1 -name '*.sql' | sort
```

Use the Supabase SQL editor to run each file, or your normal migration runner. Do not also apply files under `chunks/`; those are alternative partial scripts. Keep a record of applied migrations. For an existing deployment, back up first and apply only outstanding migrations in order. Stop and investigate errors; do not assume an “already exists” error means the whole migration succeeded.

### Configure auth

1. In your Supabase dashboard, go to **Authentication → Providers**.
2. Make sure the **Email** provider is enabled with both magic link and password sign-in.
3. Go to **Authentication → URL Configuration**.
4. Set **Site URL** to your eventual production URL (e.g. `https://your-reckon.vercel.app`).
5. Add your local URL to **Redirect URLs**: `http://localhost:3000/auth/callback`.
6. After deploying, also add `https://your-reckon.vercel.app/auth/callback` to **Redirect URLs**.

## 4. Configure environment variables

Copy the example env file:

```bash
cp .env.example app/.env.local
```

Get your Supabase credentials from the dashboard at **Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL` — Project URL (e.g. `https://xxxxx.supabase.co`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon/public key

Paste both values into `app/.env.local`. Configure the operator name and contact email there too. Any `SUPABASE_SERVICE_ROLE_KEY` is a server-only secret and must never have a `NEXT_PUBLIC_` prefix or appear in browser code. Set it only where a server route or operator tool requires it.

## 5. Run locally

From the `app/` directory:

```bash
cd app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter your email, click the magic link, and you're in. The first sign-in triggers the onboarding modal.

## 6. Deploy to Vercel

1. Push your fork to GitHub.
2. In Vercel, click **New Project** and import the repository.
3. Set the **Root Directory** to `app/`.
4. Set the framework preset to **Next.js**.
5. Add the environment variables from `app/.env.local`.
6. Click **Deploy**.

Once deployed, go back to your Supabase dashboard and add the production URL to **Authentication → URL Configuration → Redirect URLs**.

## 7. Custom domain (optional)

In Vercel, go to your project settings → Domains, then add your domain. Vercel will give you DNS records to point at — add them at your registrar. Update the Supabase redirect URLs to match the new domain.

## Troubleshooting

- **Magic link redirects to `localhost` in production**: you forgot to add the production URL to Supabase's redirect URLs list.
- **"column does not exist" errors**: check the applied migration history and apply missing migrations in order; do not rerun unknown scripts blindly.
- **Magic link emails not arriving**: check Supabase's email rate limit on the free tier (see your current Supabase limits). For production usage, configure custom SMTP in Supabase auth settings.

## Stuck?

Open an issue on GitHub.

## Before using live invoices

Test with synthetic documents first. Check that an unchecked line stays pending, received quantities are recorded explicitly, product and pack mismatches remain visible, and credit requests remain open until evidence of a credit exists. Use two independent pharmacy accounts to verify that neither can see the other’s documents or records. Test backups and restore, password recovery, and your actual scanner/browser combination.

Barcode receipt capture depends on an accurate product-pack mapping. A valid check digit identifies a syntactically valid barcode, not the right medicine or quantity. Confirm unknown mappings against the physical pack and invoice; never guess from similar product names. Hardware scanners that type into an input are a useful fallback when a browser camera cannot decode a pack.

Run the repository checks from its root:

```bash
npm run test:parser
npm run build
```

Additional tests, where present, should be run using the scripts in `package.json`. Keep supplier documents, credentials and pharmacy-specific mappings out of public issues and commits.
