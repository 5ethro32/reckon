# Security Policy

Reckon stores invoice data for UK independent pharmacies. We take security
reports seriously.

## Reporting a vulnerability

If you discover a security issue:

1. **Do not open a public GitHub issue.** Vulnerabilities should not be
   discussed in public until fixed.
2. Email the maintainer (see `NEXT_PUBLIC_CONTACT_EMAIL` in your deployment,
   or open a [GitHub Security Advisory](https://github.com/5ethro32/reckon/security/advisories/new)).
3. Include:
   - A description of the issue
   - Steps to reproduce
   - Affected version / commit hash
   - Your assessment of impact

We will acknowledge receipt within 72 hours and aim to provide an initial
response (fix, mitigation, or follow-up questions) within 7 days.

## Scope

This policy covers the source code in this repository. It does not cover:

- The hosted instance at any specific URL — please report those issues to the
  operator listed in that instance's privacy notice.
- Vulnerabilities in upstream dependencies (Next.js, Supabase, pdf-parse,
  tesseract.js, etc.) — please report those upstream.

## Security model

Reckon is multi-tenant. The threat model assumes:

- All authenticated users are trusted by their own pharmacy, but a user from
  pharmacy A must never be able to see pharmacy B's data.
- Postgres Row Level Security (RLS) is enabled on every table that holds
  pharmacy data. Application-level checks are a defence in depth, not the
  primary boundary.
- The Supabase service-role key bypasses RLS. It is only used in trusted
  server contexts (`app/lib/supabase/admin.ts`) and never reaches client code.
- File uploads go to a Supabase Storage bucket gated by RLS path policies.

If you find a way to read or write data across the pharmacy boundary, that
is a critical vulnerability. Please report it.

## What is *not* in scope

- Brute-forcing or rate-limiting the password endpoint without finding an
  authentication bypass.
- Spam / abuse via the magic-link email flow that does not bypass Supabase's
  rate limits.
- Social engineering of the maintainer or operator.
- Findings that require attacker-controlled compromise of an end-user device.
