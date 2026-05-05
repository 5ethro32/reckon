# Self-host setup

This guide walks you through running your own copy of Reckon. **It requires technical comfort with command-line tools, Supabase, and Vercel.** If that sounds like a lot, just use the hosted version at [reckon.vercel.app](https://reckon.vercel.app) — it's free.

## Prerequisites

- A GitHub account
- Node.js 20 or newer (`node --version`)
- A Supabase account ([supabase.com](https://supabase.com), free tier works)
- A Vercel account ([vercel.com](https://vercel.com), free tier works)
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
2. Pick the **eu-west-2 (London)** region — keeps your data in the UK.
3. Wait a couple of minutes for the project to provision.

### Run the migrations

Open the SQL editor in your Supabase dashboard. Run these files **in order**, copy-paste each one and click Run:

1. `supabase/migrations/0001_initial_schema.sql`
2. `supabase/migrations/0002_credits_and_suppliers.sql`
3. `supabase/migrations/0003_damage_disposition_and_line_notes.sql`
4. `supabase/migrations/0004_user_profile_and_signup.sql`

If any migration errors with "already exists", that's fine — they're idempotent.

### Configure auth

1. In your Supabase dashboard, go to **Authentication → Providers**.
2. Disable Email/Password (we only use magic links).
3. Make sure **Email** provider is enabled with magic link enabled.
4. Go to **Authentication → URL Configuration**.
5. Set **Site URL** to your eventual production URL (e.g. `https://your-reckon.vercel.app`).
6. Add your local URL to **Redirect URLs**: `http://localhost:3000/auth/callback`.
7. After deploying, also add `https://your-reckon.vercel.app/auth/callback` to **Redirect URLs**.

## 4. Configure environment variables

Copy the example env file:

```bash
cp .env.example app/.env.local
```

Get your Supabase credentials from the dashboard at **Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL` — Project URL (e.g. `https://xxxxx.supabase.co`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon/public key

Paste both values into `app/.env.local`.

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
- **"column does not exist" errors**: a migration didn't apply. Re-run the migration in the Supabase SQL editor.
- **Magic link emails not arriving**: check Supabase's email rate limit on the free tier (~30/hour). For production usage, configure custom SMTP in Supabase auth settings.

## Stuck?

Open an issue on GitHub or email jethrogoldsmith@gmail.com.
