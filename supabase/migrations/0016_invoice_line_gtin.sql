-- Some suppliers (Phoenix) print the pack GTIN on each invoice line. Storing it lets a scanned
-- pack find its line exactly, without a pharmacy mapping or a dm+d lookup.
alter table public.invoice_lines add column if not exists gtin text check (gtin is null or gtin ~ '^[0-9]{14}$');
create index if not exists idx_invoice_lines_invoice_gtin on public.invoice_lines(invoice_id, gtin) where gtin is not null;
