-- Verified pack mappings are local to a pharmacy and supplier product code.
create table public.product_barcodes (
  pharmacy_id uuid not null references public.pharmacies(id),
  supplier text not null,
  supplier_sku text not null,
  gtin text not null check (gtin ~ '^[0-9]{14}$'),
  description text not null,
  pack_size text,
  ampp_id text check (ampp_id ~ '^[0-9]{6,18}$'),
  verified_by uuid not null references auth.users(id),
  verified_at timestamptz not null default now(),
  primary key (pharmacy_id, supplier, gtin)
);
create table public.receipt_events (
  id uuid primary key,
  pharmacy_id uuid not null references public.pharmacies(id),
  invoice_line_id uuid not null references public.invoice_lines(id),
  gtin text not null,
  quantity integer not null check (quantity > 0),
  batch text,
  serial text,
  expiry date,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);
alter table public.product_barcodes enable row level security;
alter table public.receipt_events enable row level security;
create policy barcode_read on public.product_barcodes for select to authenticated
 using (public.user_belongs_to_pharmacy(pharmacy_id));
create policy receipt_read on public.receipt_events for select to authenticated
 using (public.user_belongs_to_pharmacy(pharmacy_id));
-- Mutations go through a transaction that validates the product, tenant and quantity.
create function public.record_pack_receipt(p_line_id uuid, p_gtin text, p_quantity integer,
 p_event_id uuid, p_confirm_mapping boolean default false, p_batch text default null, p_expiry date default null, p_serial text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.invoice_lines; inv public.invoices; mapping public.product_barcodes;
 existing public.receipt_events; new_quantity integer; checksum integer := 0; i integer;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 -- Lock the retry key before the line so retries on different lines cannot race.
 perform pg_advisory_xact_lock(hashtextextended('receipt:' || coalesce(p_event_id::text,''),0));
 select * into l from public.invoice_lines where id = p_line_id for update;
 if l.id is null or auth.uid() is null or not public.user_belongs_to_pharmacy(l.pharmacy_id) then
  raise exception 'Receipt is not available';
 end if;
 select * into inv from public.invoices where id = l.invoice_id and deleted_at is null;
 if inv.id is null or inv.pharmacy_id <> l.pharmacy_id then raise exception 'Invoice is not available'; end if;
 if p_gtin is null or p_gtin !~ '^[0-9]{14}$' or p_quantity is null or p_quantity < 1 or p_quantity > 100000 or p_event_id is null then
  raise exception 'Valid barcode, quantity and receipt reference are required';
 end if;
 for i in 1..13 loop checksum := checksum + substring(p_gtin,i,1)::integer * case when i % 2 = 1 then 3 else 1 end; end loop;
 if (10 - checksum % 10) % 10 <> right(p_gtin,1)::integer then raise exception 'Invalid barcode check digit'; end if;
 select * into existing from public.receipt_events where id = p_event_id;
 if existing.id is not null then
  if existing.invoice_line_id <> p_line_id or existing.gtin <> p_gtin or existing.quantity <> p_quantity
   or existing.recorded_by <> auth.uid() or existing.serial is distinct from p_serial
   or existing.batch is distinct from p_batch or existing.expiry is distinct from p_expiry then
   raise exception 'Receipt reference already used';
  end if;
  return jsonb_build_object('quantity',l.qty_received,'replayed',true);
 end if;
 if p_expiry is not null and p_expiry < current_date then raise exception 'Expired pack: record as an exception rather than a normal receipt'; end if;
 if length(coalesce(p_serial,'')) > 100 then raise exception 'Serial is too long'; end if;
 if p_serial is not null and exists(select 1 from public.receipt_events where pharmacy_id=l.pharmacy_id and gtin=p_gtin and serial=p_serial) then raise exception 'This serialised pack was already recorded'; end if;
 if p_serial is not null and p_quantity <> 1 then raise exception 'A serialised barcode represents one pack'; end if;
 if length(coalesce(p_batch,'')) > 100 then raise exception 'Batch is too long'; end if;
 -- Serialize creation of the same mapping across invoice lines.
 perform pg_advisory_xact_lock(hashtextextended(l.pharmacy_id::text || inv.supplier || p_gtin,0));
 select * into mapping from public.product_barcodes where pharmacy_id=l.pharmacy_id and supplier=inv.supplier and gtin=p_gtin;
 if nullif(trim(l.supplier_sku),'') is null or nullif(trim(l.pack_size),'') is null then raise exception 'Verify the invoice product code and pack size before creating a barcode mapping'; end if;
 if mapping.gtin is null then
  if not p_confirm_mapping then raise exception 'Confirm the product and pack before saving a new barcode'; end if;
  insert into public.product_barcodes (pharmacy_id,supplier,supplier_sku,gtin,description,pack_size,verified_by,verified_at) values(l.pharmacy_id,inv.supplier,l.supplier_sku,p_gtin,l.description,l.pack_size,auth.uid(),now());
 elsif mapping.supplier_sku <> l.supplier_sku or mapping.pack_size is distinct from l.pack_size
  or lower(regexp_replace(trim(mapping.description),'\s+',' ','g')) is distinct from lower(regexp_replace(trim(l.description),'\s+',' ','g')) then
  raise exception 'This barcode belongs to a different product or pack';
 end if;
 if l.flags <> '[]'::jsonb then raise exception 'This line has an exception. Review it before scanning further receipts'; end if;
 new_quantity := coalesce(l.qty_received,0) + p_quantity;
 if new_quantity > l.qty_ordered then raise exception 'Quantity exceeds the invoice. Investigate the extra packs'; end if;
 insert into public.receipt_events (id,pharmacy_id,invoice_line_id,gtin,quantity,batch,expiry,recorded_by,recorded_at,serial) values(p_event_id,l.pharmacy_id,l.id,p_gtin,p_quantity,p_batch,p_expiry,auth.uid(),now(),p_serial);
 update public.invoice_lines set qty_received=new_quantity where id=l.id;
 return jsonb_build_object('quantity',new_quantity,'replayed',false);
end $$;
revoke all on function public.record_pack_receipt(uuid,text,integer,uuid,boolean,text,date,text) from public, anon;
grant execute on function public.record_pack_receipt(uuid,text,integer,uuid,boolean,text,date,text) to authenticated;

-- A serialized physical pack may only be received once at this pharmacy.
create unique index receipt_serial_once on public.receipt_events(pharmacy_id,gtin,serial) where serial is not null;
create index receipt_line_history on public.receipt_events(invoice_line_id,recorded_at);

create function public.import_barcode_catalog(p_line_id uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare tenant uuid; r jsonb; mapped public.product_barcodes; checksum integer; i integer; n integer:=0; barcode text;
begin
 select l.pharmacy_id into tenant from public.invoice_lines l join public.invoices inv on inv.id=l.invoice_id
 where l.id=p_line_id and inv.deleted_at is null and inv.pharmacy_id=l.pharmacy_id;
 if tenant is null or auth.uid() is null or not public.user_belongs_to_pharmacy(tenant) then raise exception 'Invoice is not available'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Catalog must be a list'; end if;
 if jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Import between 1 and 1000 rows'; end if;
 -- Consistent lock order prevents imports with overlapping GTINs from deadlocking.
 for r in select value from jsonb_array_elements(p_rows) order by value->>'supplier',value->>'gtin' loop
  barcode:=r->>'gtin';
  if barcode is null or barcode !~ '^[0-9]{14}$' then raise exception 'Invalid GTIN'; end if;
  checksum:=0;
  for i in 1..13 loop checksum:=checksum+substring(barcode,i,1)::integer*case when i%2=1 then 3 else 1 end; end loop;
  if (10-checksum%10)%10 <> right(barcode,1)::integer then raise exception 'Invalid GTIN check digit'; end if;
  if nullif(trim(r->>'supplier'),'') is null or nullif(trim(r->>'supplier_sku'),'') is null or nullif(trim(r->>'description'),'') is null or nullif(trim(r->>'pack_size'),'') is null then raise exception 'Supplier, product code, description and pack size are required'; end if;
  if greatest(length(r->>'supplier'),length(r->>'supplier_sku'),length(r->>'description'),length(r->>'pack_size'))>300 then raise exception 'Catalog field exceeds 300 characters'; end if;
  if r->>'ampp_id' is not null and (r->>'ampp_id') !~ '^[0-9]{6,18}$' then raise exception 'Invalid AMPP identifier'; end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text || (r->>'supplier') || barcode,0));
  select * into mapped from public.product_barcodes where pharmacy_id=tenant and supplier=r->>'supplier' and gtin=barcode;
  if found then
   if mapped.supplier_sku is distinct from r->>'supplier_sku' or mapped.pack_size is distinct from r->>'pack_size' or mapped.ampp_id is distinct from r->>'ampp_id'
    or lower(regexp_replace(trim(mapped.description),'\s+',' ','g')) is distinct from lower(regexp_replace(trim(r->>'description'),'\s+',' ','g')) then raise exception 'Catalog conflicts with an existing verified product or pack'; end if;
  else
   insert into public.product_barcodes(pharmacy_id,supplier,supplier_sku,gtin,description,pack_size,ampp_id,verified_by)
   values(tenant,r->>'supplier',r->>'supplier_sku',barcode,r->>'description',r->>'pack_size',r->>'ampp_id',auth.uid());
   n:=n+1;
  end if;
 end loop;
 return n;
end $$;
revoke all on function public.import_barcode_catalog(uuid,jsonb) from public,anon;
grant execute on function public.import_barcode_catalog(uuid,jsonb) to authenticated;
