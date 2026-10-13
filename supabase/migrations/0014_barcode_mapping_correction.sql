-- A wrong or outdated verified mapping must be correctable without database access.
-- Owners and admins can remove the mapping that conflicts on an invoice line; the next scan
-- then asks staff to confirm the product and pack again. Past receipt events keep their GTIN.
create function public.remove_barcode_mapping(p_line_id uuid, p_gtin text)
returns boolean language plpgsql security definer set search_path = public as $$
declare l public.invoice_lines; inv public.invoices;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_gtin is null or p_gtin !~ '^[0-9]{14}$' then raise exception 'Invalid GTIN'; end if;
 select * into l from public.invoice_lines where id = p_line_id;
 if l.id is null or not exists (
  select 1 from public.pharmacy_memberships m
  where m.pharmacy_id = l.pharmacy_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
 ) then raise exception 'Only a pharmacy owner or admin can remove a barcode mapping'; end if;
 select * into inv from public.invoices where id = l.invoice_id and pharmacy_id = l.pharmacy_id;
 if inv.id is null then raise exception 'Invoice not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(l.pharmacy_id::text || inv.supplier || p_gtin, 0));
 delete from public.product_barcodes where pharmacy_id = l.pharmacy_id and supplier = inv.supplier and gtin = p_gtin;
 return found;
end $$;
revoke all on function public.remove_barcode_mapping(uuid, text) from public, anon;
grant execute on function public.remove_barcode_mapping(uuid, text) to authenticated;
