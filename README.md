# Reckon

Invoice and statement reconciliation for UK independent pharmacies. Tick off your wholesaler invoices line-by-line, reconcile against monthly statements, chase credit requests, all in one place.

**Self-host**: see [SETUP.md](./SETUP.md) for instructions.

## What it does

- Upload wholesaler invoice PDFs — auto-detected, parsed line-by-line
- Tick off lines as received, short, or damaged with notes and disposition
- Generate credit-request emails with the right account references
- Reconcile statements against your delivered invoices
- Track which credits are still outstanding

## Stack

- Next.js 16 (App Router)
- Supabase (Postgres + Auth + Storage)
- TypeScript
- pdf-parse + tesseract.js for OCR fallback
- Magic-link or password sign-in

## Status

Active development. Open source under the MIT license. Self-host on your own Supabase + Vercel project — your data stays in your account, end to end.

## Privacy

Reckon stores only what you upload. Data lives in your own Supabase project (eu-west-2 recommended for UK residency). Row Level Security gates every table by `pharmacy_id`. No analytics, no tracking, no third-party data sharing in the codebase.

## License

MIT — see [LICENSE](./LICENSE).
