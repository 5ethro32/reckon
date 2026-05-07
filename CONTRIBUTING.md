# Contributing to Reckon

Thanks for considering contributing. Reckon is built primarily for UK
pharmacies and welcomes both bug reports and code contributions.

## Reporting a bug

The fastest way to report a bug is to open a GitHub issue. The repository
has an automated Claude Code agent wired up that will read your issue, look
at the codebase, and where possible open a pull request with a proposed fix.
A human (the maintainer) reviews every PR before it merges.

When opening an issue, please:

- **Describe what you were doing** when the bug appeared.
- **Describe what you expected** to happen.
- **Describe what actually happened**.
- Include the URL of the page you were on, if relevant.
- Include a screenshot if the issue is visual.

### What NOT to include in issues

This repository is public. Anyone can read the issues. So please do **not**
paste the following into issue bodies, comments, or screenshots:

- **Real invoice or statement contents** — line items, prices, account
  numbers, signed credit notes. Describe the structure of the problem
  ("the parser drops zero-pence rows on AAH invoices") rather than pasting
  a real PDF excerpt.
- **Patient data** — Reckon does not handle patient data anywhere, but if
  you happen to have a screenshot showing patient names, redact them first.
- **Login credentials, API keys, magic-link URLs** — never. If you need to
  share auth-related diagnostics, email the maintainer directly.
- **Personal data of staff / pharmacists** — names and roles are fine, but
  not full contact details, home addresses, etc.

## Asking the AI agent for help

Tag `@claude` in any issue or PR comment to invoke the Claude agent. It can:

- Investigate a bug and propose a fix as a PR
- Explain how a piece of the codebase works
- Add tests for code that lacks them

It will **not** be able to:

- Read your live database or Supabase project (the agent has no env vars)
- Touch authentication, secrets, or env files
- Push commits without going through the PR review flow

## Submitting a pull request

If you want to contribute code directly:

1. Fork the repo
2. Create a branch off `main` named for your change (e.g. `fix/parser-zero-pence`)
3. Make the change with a clean commit message in the convention used in
   `git log` (lowercase scope, present-tense imperative)
4. Run `npm run build` to ensure TypeScript and Next.js are happy
5. Open a PR against `main` with a description of the change

## Code style

- TypeScript strict mode. No `.js` extensions in imports.
- No Tailwind — we use plain CSS with custom properties (`var(--foreground)` etc.)
- Server components by default. `"use client"` only when needed for interactivity.
- RLS is the security boundary, not application code. Every query that
  reads or writes pharmacy-scoped data must go through the standard
  Supabase client (which respects RLS). Use `lib/supabase/admin.ts` only
  in trusted server contexts where bypassing RLS is genuinely necessary.

### Badges vs form controls

The `.badge` / `.badge-success` / `.badge-warning` / `.badge-critical` /
`.badge-neutral` classes are for **read-only `<span>` elements** that
display state. Do not combine them with interactive form controls
(`<select>`, `<input>`, `<button>`).

Reason: native `<option>` lists inherit the host `<select>`'s background
and text colour. The badge backgrounds in dark mode are translucent
greens / ambers / reds that some browsers render with collapsed contrast
when the dropdown menu opens.

For interactive controls that need to convey state, use neutral chrome
plus a state indicator. The status select on the invoice detail page
(`app/(app)/invoices/[id]/lines-editor.tsx`) is the canonical example:
neutral input background, chevron right, coloured dot left, the dot
colour switched via a CSS custom property (`--status-dot-color`).

## License

By contributing you agree that your contributions will be licensed under
the same MIT license as the rest of the project.
