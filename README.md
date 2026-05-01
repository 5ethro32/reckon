# Reckon

> The shadow ledger for independent pharmacy.

**Reckon** is an open invoice and statement reconciliation tool for community pharmacy. Scan supplier invoices, tick off what physically arrived, auto-draft credit chases, and reconcile every line against the month-end statement — all in one place.

This repo currently contains a **clickable design mock** (single-file HTML). The full Next.js + Postgres app is under active development.

## Why Reckon exists

Independent pharmacies in the UK lose real money to:

- **Short-shipped invoices** that are paid in full because nobody noticed the discrepancy
- **Credit notes never chased** because the request lived in someone's head, not a system
- **Statement variances** that hide silent supplier price rises
- **No cross-supplier visibility** — you can't see who's actually cheapest because product codes don't line up

Reckon turns the paper-and-spreadsheet "shadow ledger" most pharmacies already keep into a real product.

## What's in the demo

Six clickable pages that mirror the real workflow:

| Page | Purpose |
|---|---|
| **Dashboard** | Today's deliveries · April reconciliation progress · credits waiting · cross-supplier insights |
| **Deliveries** | Tick-off workspace — every line defaults to received, click to flag exceptions (short / damaged / not received) |
| **Credit Notes** | Drafts queue with live email preview · `mailto:` send opens Outlook with body pre-filled |
| **Statements** | Invoice-level reconciliation — Invoice total − Credits expected vs Statement total, with variance drill-down |
| **Products** | Canonical product catalogue with cross-supplier price matrix and supplier SKU mapping queue |
| **Suppliers** | Per-wholesaler scorecards: spend, short-ship rate, pending credits, contact reps |

## Try it locally

```bash
git clone https://github.com/<you>/reckon.git
cd reckon
python -m http.server 4747
# open http://localhost:4747
```

No build step, no dependencies. The mock is one HTML file with vanilla JS and Tailwind via CDN.

## Roadmap

- [x] **v0.1 — Clickable mock** (this repo)
- [ ] **v0.2 — Multi-tenant Next.js app** with Supabase Postgres backend
- [ ] **v0.3 — OCR ingest** (Claude Vision against per-supplier templates)
- [ ] **v0.4 — Outlook / Gmail draft via Microsoft Graph + Gmail API** (replaces `mailto:`)
- [ ] **v0.5 — Cross-pharmacy benchmarks** (anonymised pricing + service-level data, opt-in)
- [ ] **v1.0 — Self-hosted release** for pharmacies that want their data on their own infrastructure

## Architecture (planned)

- **Next.js App Router** on Vercel (Fluid Compute)
- **Supabase Postgres** with row-level security per `tenant_id`
- **Vercel Blob** for invoice scan storage
- **Claude Vision** for OCR with per-supplier extraction templates
- **Open-core model**: workflow engine open source under MIT, anonymised benchmark layer closed source

## Status

Pre-alpha. Not yet usable in production. The hosted version will go live at `reckon.app` (TBC) when v0.2 ships.

## Licence

[MIT](./LICENSE) — use it, fork it, run it for your pharmacy. If you ship something useful built on it, a credit is appreciated but not required.

---

Built by [Jethro Goldsmith](https://github.com/5ethro32) — COO at Aver Generics, ex-strategy at McKinsey, doing this in the open because UK pharmacy IT deserves better than what it has.
