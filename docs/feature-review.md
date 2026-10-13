# Receiving and reconciliation feature review

Reviewed 13 October 2026. This is a public-source scope assessment, not a hands-on audit or a claim that Reckon replaces a commercial service. Supplier integrations are outside this build. No vendor code, private material or interface assets are used.

## What the public evidence says

StockRx advertises delivery checking, claims and credit follow-up, statement reconciliation, branch checking reports and purchasing analysis. Its supplier connections obtain invoice data ahead of delivery; the public site does not specify each connection method. Prices, service levels and unsupported-supplier behaviour need confirmation. [Official service description](https://www.stockrx.uk/)

The app listing describes barcode receiving. Its release history also names receiving without an invoice, booking several invoices together, pack-level tracking, transfers, multiple credit types per line and mapping GTINs through scans and photos. These are advertised features, not independently verified performance. A free app-store download does not establish that the service is free. [Official App Store listing](https://apps.apple.com/us/app/stockrx/id1669206136)

## Reckon scope

| Workflow | Current code and next requirement |
| --- | --- |
| Import invoices and statements | PDF parsing and document upload exist. Expand with synthetic supplier-format fixtures and show ambiguous extraction for review. |
| Confirm physical receipt | Pack receipt capture records explicit quantities; unchecked lines stay pending. Verified GTIN mappings can be imported from CSV with optional AMPP identifiers. Unknown mappings require explicit product-and-pack confirmation. Camera scanning needs device/browser validation; typed and keyboard-scanner entry remain available. |
| Claims and credits | Credit requests begin as drafts, with explicit sent confirmation. Shortage and return amounts use confirmed affected quantities. Automatic settlement requires an unambiguous reference and amount; amount-only matches stay open. Manual settlement requires a supplier credit reference. Partial credit allocations remain future work. |
| Month-end reconciliation | Statement views exist. Preserve unresolved invoice/credit differences and make missing evidence visible. |
| Receive before the invoice | A separate pending-delivery record captures product, pack, quantity and notes. Later manual invoice linking adds evidence only and does not change received quantities. Staff must review invoice quantities without counting the goods again. Links cannot currently be corrected through the UI; confirm carefully before linking. |
| Several invoices in one delivery | A grouped receiving session remains distinct from checking an individual invoice. |
| Inventory | Receipt counts alone do not provide live stock. Dispensing, transfers, returns, adjustments and opening balances need a separate stock ledger. |
| Reporting | An operations view separates unchecked receipts, exceptions and open credits, with age and next-action information. Purchasing profitability and peer benchmarking remain outside the implemented scope. |
| Claims reminders | Show the next action and chase date; scheduled notifications require an actual scheduler and delivery monitoring. |
| Product photographs | Evidence uploads and image-based identification are different features. A photograph must not silently authorise a product match. |

## Useful for Scottish community pharmacies

Supplier invoice reconciliation does not require a direct supplier connection: a pharmacy can supply its own documents. Automatic feeds can reduce collection work, but are outside this scope.

NHS dm+d publishes an AMPP-to-GTIN mapping file. AMPP means Actual Medicinal Product Pack; a product-level identifier alone is insufficient to resolve different pack sizes. Imports should record source, version and verification status and respect the source’s access and reuse terms. No complete catalogue is bundled or implied. [NHSBSA dm+d releases](https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/nhs-dictionary-medicines-and-devices-dmd/release-dmd-files)

Scottish reimbursement must use the appropriate Scottish Drug Tariff and payment context. Invoice purchase price alone cannot establish dispensing profitability. This project does not currently calculate Scottish NHS reimbursement or compare anonymised peer performance. [National Services Scotland guidance](https://www.nss.nhs.scot/browse/pharmacy-services/pharmacy-prices-and-items-allowed-guidance)

## Release priorities

The current changes focus on dependable receipt evidence, receiving before an invoice and safer credit follow-up. Automated tests exercise pack validation, tenant isolation, no-invoice links and conservative credit matching. A production pilot must still verify the deployed database policies, real document formats, scanner devices and staff workflows. Keep a clear distinction between implemented code, tested workflows and future scope.

A usable free project also needs reliable setup, demo data, backup instructions, clear errors and a documented support route. Software licensing can be free while infrastructure and maintenance still have costs. Public wording should describe verified functionality, without asserting feature parity or guaranteed savings.
