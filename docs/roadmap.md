# Roadmap

What Reckon does today, and what is planned next.

## Supported today

| Area | What works |
| --- | --- |
| Invoices and statements | Upload PDFs from AAH, Aver and Phoenix. Each line is read with quantity, pack size, price and VAT, and totals are checked against the printed figures. Phoenix PDFs holding several invoices are split. |
| Receiving | Record what arrived line by line, or scan packs with a phone camera or handheld scanner. A scan finds its invoice line from the barcode printed on the invoice, your saved barcodes, or the NHS dm+d pack list. Deliveries can be recorded before the invoice arrives and linked later. |
| Claims and credits | Shortages, damages and returns become credit requests that stay as drafts until you confirm they were sent. Credits on statements close claims only when the supplier reference matches. |
| Month end | Statements are matched to invoices and credits, and anything unresolved stays visible. |
| Margin analysis | Purchase margin against the Drug Tariff for each invoice line, product and supplier, using the Drug Tariff price per pack from NHS dm+d (or the NHS indicative price where a pack has no tariff price). Loss-making lines, the best price paid for each pack in a period and the cost of buying above it are shown, with CSV downloads. Lines are matched to dm+d only through the invoice barcode, a verified barcode or scanned packs; unmatched lines are listed, not estimated. This is not profit: dispensing, Category M adjustments and discount deductions are not included. |
| Supplier ratings | A score per supplier and pharmacy for a chosen period, built from fill rate, damages and returns, credit turnaround, invoice and statement accuracy, and price against the best price paid elsewhere. Each component and the formula are shown, and the table downloads as CSV. |

## Planned

- Alliance Healthcare invoices and statements.
- Phoenix credit notes as a document type.
- Several invoices received as one delivery.
- Reminders when a credit is overdue.
- Correcting a delivery linked to the wrong invoice.

## Out of scope

Reckon records what arrived and follows up money owed. It is not a dispensing system and does not keep live stock levels.
