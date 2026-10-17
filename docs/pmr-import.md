# Dispensing system import

Reckon can read report exports from Positive Solutions (PSL) Pharmacy Manager. With them, the Dispensing page shows, for each product, the packs dispensed each month, the stock on hand when the last stock report was run, and the packs bought on invoices over the same months.

The figures are product level only. Reckon does not read or store patient details or prescription references.

## Which reports to export

| Report | What Reckon takes from it | How often |
| --- | --- | --- |
| Product Usage | Packs (and units) dispensed per product per month, per branch when the export covers several | Monthly, covering at least the last full month |
| Stock Value | Packs held per product at each stock location (for example BDRowa, Manual), and packs on order | Whenever you want the on-hand figure refreshed, ideally at month end |
| Items Processed | The PIP code PSL used for each product | Occasionally; it improves matching to invoices that print PIP codes |

Export each report from Pharmacy Manager to Excel (`.xlsx`). Menu names vary between Pharmacy Manager versions; the reports are the standard ones with these titles. Keep the file names PSL gives them: a Stock Value file is named with the date and time it was run (for example `Stock Value - 14-10-26 15-16-49.xlsx`), and Reckon uses that date for the stock snapshot. If the date is missing from the name, the upload date is used.

## Uploading

Drop the `.xlsx` files on the Upload page, alongside or instead of PDFs. Reckon recognises the report from its column headings, so no setting is needed. After each file it shows the report, the period or stock date, the number of rows and products, how many products were found in dm+d, and the names of those that were not.

Uploading again is safe:

- A Product Usage export replaces the figures for the months and branches it covers. Other months stay.
- A Stock Value export replaces any earlier stock report with the same date.
- Items Processed updates PIP codes and fills them in on figures already loaded.

## How products are matched

PSL names products as the NHS Dictionary of Medicines and Devices (dm+d) does, for example `Aciclovir 200mg tablets (Crescent Pharma Ltd) 25 tablet 5 x 5 tablets`.

1. **To dm+d.** The name is looked up as a dm+d actual pack. PSL's own virtual products, such as `Losartan 100mg tablets (V-Pip) [DPS=28]`, are looked up by their generic pack name (`Losartan 100mg tablets 28 tablet`). Every brand and manufacturer of the same pack is then shown as one product. A pack size that disagrees with dm+d rejects the match. Products not found stay in the figures, shown as "Not in dm+d", and are listed after upload.
2. **To invoice lines.** An invoice line counts towards a product when its pack barcode is printed on the invoice or saved in your verified barcodes, when its PIP code matches (Phoenix prints PIP codes), or when its description names the same medicine, strength, form and pack size as exactly one product. Lines that fit more than one product, or none, are not counted, and the page says how many.

The dm+d lookup uses the pack list loaded by `scripts/import-dmd.mts` (see `SETUP.md`). Products whose dm+d packs have no barcode are not in that list, so load the latest release for the best match rate.

## What the figures mean

- **Dispensed** is what PSL recorded as dispensed. It does not include sales, returns to suppliers or other stock adjustments.
- **On hand** is the stock in the latest Stock Value report, excluding anything listed under On Order. It is a snapshot, not a live stock level.
- **Bought** is the quantity on invoices dated within the months shown, in packs, before any credits.
- An export that covers several branches (PSL "Spoke") is stored per branch. Invoices belong to the pharmacy that uploaded them, so choose its branch on the Dispensing page when comparing.

## Setting up

Run migration `supabase/migrations/0019_pmr_import.sql`. It adds the import, dispensing, stock snapshot and PIP code tables, readable only by members of the pharmacy, and the functions the upload uses to write them.
