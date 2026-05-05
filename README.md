# Reckon

Invoice and statement reconciliation for UK independent pharmacies. Tick off your wholesaler invoices line-by-line, reconcile against monthly statements, chase credit requests, all in one place.

**Hosted version**: [reckon.vercel.app](https://reckon.vercel.app) — free to use, RLS-secured, hosted in the UK.

**Self-host**: see [SETUP.md](./SETUP.md) for instructions.

## What it does

- Upload wholesaler invoice PDFs (AAH, Aver, Phoenix, Alliance, Ethigen, Numark) — auto-detected, parsed line-by-line
- Tick off lines as received, short, or damaged with notes and disposition
- Generate credit-request emails to suppliers with the right account references
- Reconcile statements against your delivered invoices
- Track which credits are still outstanding

## Stack

- Next.js 16 (App Router)
- Supabase (Postgres + Auth + Storage)
- TypeScript
- pdf-parse + tesseract.js for OCR fallback
- Magic-link auth only — no passwords

## Status

Active development. Used by real pharmacies. Free at the hosted URL above. Self-host if you'd rather own your data.

## Privacy

See [reckon.vercel.app/privacy](https://reckon.vercel.app/privacy).

## Contact

Jethro Goldsmith — jethrogoldsmith@gmail.com
