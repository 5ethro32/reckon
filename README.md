# Reckon

Free, open-source invoice and delivery reconciliation for independent community pharmacies, including Scotland. Tick off your wholesaler invoices line-by-line, reconcile against monthly statements, chase credit requests, all in one place.

**Self-host**: see [SETUP.md](./SETUP.md) for instructions.

## What it does

- Upload AAH and Aver invoice and statement PDFs — auto-detected, parsed line-by-line
- Tick off lines as received, short, or damaged with notes and disposition
- Generate credit-request emails with the right account references
- Reconcile statements against uploaded invoices and recorded credits
- Track which credits are still outstanding
- Record received pack quantities against invoices and use verified barcode mappings
- Record deliveries before an invoice arrives, then link the paperwork explicitly

## Development checks

With Node 24, run `npm ci`, `npm test`, `npm run typecheck` and `npm run build`. The default tests use synthetic records and isolated PostgreSQL; no live pharmacy credentials or customer PDFs are needed. `npm run test:parser` is an additional local corpus check and requires your own authorised `parser/test-pdfs` fixtures.

## Stack

- Next.js (App Router)
- Supabase (Postgres + Auth + Storage)
- TypeScript
- pdf-parse + tesseract.js for OCR fallback
- Magic-link or password sign-in

## Status

Active development. Open source under the MIT license. Self-host on your own infrastructure accounts. The MIT licence has no software subscription fee; hosting, email delivery, maintenance and support can still cost money. This is a developing application, not a managed service or a claim of feature equivalence with commercial products.

## Privacy

Uploaded documents and application records use your configured Supabase project. Review hosting, authentication, storage and analytics settings before deployment; choosing a UK database region alone does not establish where every provider processes data. Verify pharmacy isolation with separate test accounts before using real documents. Do not upload patient records. See [SECURITY.md](./SECURITY.md).

## Scope and roadmap

Reckon helps staff record what arrived and follow up financial differences. It does not replace a dispensing system or prove current shelf stock: dispensing, returns, transfers and adjustments also change stock. Scottish reimbursement analysis requires Scottish tariff and payment rules, beyond invoice reconciliation.

Read the [feature review](./docs/feature-review.md) for supported workflows, known gaps and evidence.

## License

MIT — see [LICENSE](./LICENSE).
