-- Physical receipts recorded before an invoice is available. Linking is evidence only:
-- it never increments invoice quantities or creates a second stock receipt.
create table public.uninvoiced_receipts (
 id uuid primary key,
 pharmacy_id uuid not null references public.pharmacies(id),
 supplier text not null check(length(trim(supplier)) between 1 and 150),
 delivery_reference text not null check(length(trim(delivery_reference)) between 1 and 150),
 description text not null check(length(trim(description)) between 1 and 500),
 pack_size text not null check(length(trim(pack_size)) between 1 and 100),
 quantity integer not null check(quantity between 1 and 100000),
 notes text not null default '' check(length(notes)<=2000),
 received_at timestamptz not null default now(),
 recorded_by uuid not null references auth.users(id),
 invoice_id uuid references public.invoices(id),
 linked_at timestamptz,
 linked_by uuid references auth.users(id)
);
alter table public.uninvoiced_receipts enable row level security;
create policy uninvoiced_read on public.uninvoiced_receipts for select to authenticated
 using (public.user_belongs_to_pharmacy(pharmacy_id));
create policy uninvoiced_create on public.uninvoiced_receipts for insert to authenticated
 with check (public.user_belongs_to_pharmacy(pharmacy_id) and recorded_by=auth.uid()
 and invoice_id is null and linked_at is null and linked_by is null);
create function public.link_uninvoiced_receipt(p_receipt_id uuid,p_invoice_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.uninvoiced_receipts; i public.invoices;
begin
 select * into r from public.uninvoiced_receipts where id=p_receipt_id for update;
 if auth.uid() is null or r.id is null or not public.user_belongs_to_pharmacy(r.pharmacy_id) then
 raise exception 'Receipt is not available'; end if;
 select * into i from public.invoices where id=p_invoice_id and pharmacy_id=r.pharmacy_id and deleted_at is null;
 if i.id is null then raise exception 'Invoice is not available for this pharmacy'; end if;
 if lower(trim(i.supplier))<>lower(trim(r.supplier)) then raise exception 'Supplier must match before linking'; end if;
 if r.invoice_id is not null then
  if r.invoice_id=p_invoice_id then return; end if;
  raise exception 'This receipt has already been linked';
 end if;
 update public.uninvoiced_receipts set invoice_id=i.id,linked_at=now(),linked_by=auth.uid() where id=r.id;
end $$;
revoke all on function public.link_uninvoiced_receipt(uuid,uuid) from public,anon;
grant execute on function public.link_uninvoiced_receipt(uuid,uuid) to authenticated;
