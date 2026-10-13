# Reckon

Free, open-source invoice and delivery reconciliation for independent community pharmacies, including Scotland. Tick off your wholesaler invoices line-by-line, reconcile against monthly statements, chase credit requests, all in one place.

**Self-host**: see [SETUP.md](./SETUP.md) for instructions.

## What it does

- Upload AAH, Aver and Phoenix invoice and statement PDFs — auto-detected, parsed line-by-line (Phoenix bundles of several invoices are split)
- Tick off lines as received, short, or damaged with notes and disposition
- Generate credit-request emails with the right account references
- Reconcile statements against uploaded invoices and recorded credits
- Track which credits are still outstanding
- Record received pack quantities by scanning packs: the scan finds its invoice line from the GTIN printed on the invoice, your verified mappings, or NHS dm+d
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

See the [roadmap](./docs/roadmap.md) for what is supported today and what comes next.

## NHS dm+d

Pack names and barcodes come from the NHS Dictionary of Medicines and Devices (dm+d), published by the NHSBSA through NHS TRUD. Contains public sector information licensed under the Open Government Licence v3.0. Load a release with `scripts/import-dmd.mts` (see SETUP.md).

## License

MIT — see [LICENSE](./LICENSE).
