import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
create table auth.users(id uuid primary key); create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid,bucket_id text,name text);
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
for(const f of readdirSync('supabase/migrations').filter(f=>/^000[1-8]_.*sql$|^0011_.*sql$/.test(f)).sort()) {
 await db.exec(readFileSync('supabase/migrations/'+f,'utf8').replace(/create extension[^;]+;/g,''));
}
const user='00000000-0000-0000-0000-000000000001';
const pharmacy='00000000-0000-0000-0000-000000000002';
await db.exec(`insert into auth.users values('${user}');insert into pharmacies(id,name) values('${pharmacy}','Synthetic pharmacy');
insert into pharmacy_memberships(pharmacy_id,user_id) values('${pharmacy}','${user}');select set_config('request.jwt.claim.sub','${user}',false);
grant usage on schema public,auth to authenticated;grant select,insert,update,delete on all tables in schema public to authenticated;`);

const other='00000000-0000-0000-0000-000000000003';
await db.exec(`insert into pharmacies(id,name) values('${other}','Other pharmacy');`);
async function invoice(tenant:string,supplier='test',deleted=false){
 return (await db.query<{id:string}>(`insert into invoices(pharmacy_id,supplier,invoice_number,invoice_date,deleted_at) values($1,$2,gen_random_uuid()::text,current_date,$3) returning id`,[tenant,supplier,deleted?new Date():null])).rows[0].id;
}
const good=await invoice(pharmacy), alien=await invoice(other), wrong=await invoice(pharmacy,'wrong'), deleted=await invoice(pharmacy,'test',true), second=await invoice(pharmacy);
const line=(await db.query<{id:string}>(`insert into invoice_lines(invoice_id,pharmacy_id,line_number,supplier_sku,description,qty_ordered,unit_price,net,vat_rate,vat_amount,gross) values($1,$2,1,'x','Synthetic',5,1,5,0,0,5) returning id`,[good,pharmacy])).rows[0].id;
await db.exec('set role authenticated');
const receipt='00000000-0000-0000-0000-000000000010';
async function insert(id:string,tenant:string,author=user,linked:string|null=null){return db.query(`insert into uninvoiced_receipts(id,pharmacy_id,supplier,delivery_reference,description,pack_size,quantity,recorded_by,invoice_id) values($1,$2,'test','DEL-1','Synthetic medicine','28',5,$3,$4)`,[id,tenant,author,linked]);}
await insert(receipt,pharmacy);
await assert.rejects(()=>insert('00000000-0000-0000-0000-000000000011',other));
await assert.rejects(()=>insert('00000000-0000-0000-0000-000000000012',pharmacy,'00000000-0000-0000-0000-000000000099'));
await assert.rejects(()=>insert('00000000-0000-0000-0000-000000000013',pharmacy,user,good));
async function link(invoiceId:string){return db.query('select link_uninvoiced_receipt($1,$2)',[receipt,invoiceId]);}
await assert.rejects(()=>link(alien),/not available/);
await assert.rejects(()=>link(wrong),/Supplier must match/);
await assert.rejects(()=>link(deleted),/not available/);
await db.exec(`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',false)`);
assert.equal((await db.query('select * from uninvoiced_receipts')).rows.length,0);
await assert.rejects(()=>link(good),/not available/);
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
await link(good);await link(good);
await assert.rejects(()=>link(second),/already been linked/);
assert.equal((await db.query<{qty_received:number|null}>('select qty_received from invoice_lines where id=$1',[line])).rows[0].qty_received,null);
assert.equal((await db.query<{invoice_id:string}>('select invoice_id from uninvoiced_receipts where id=$1',[receipt])).rows[0].invoice_id,good);
assert.equal((await db.query('update uninvoiced_receipts set quantity=999 where id=$1 returning id',[receipt])).rows.length,0);
assert.equal((await db.query('delete from uninvoiced_receipts where id=$1 returning id',[receipt])).rows.length,0);
console.log('PASS: uninvoiced receipt tenant isolation, authorship, initial link protection, supplier/deleted invoice validation, immutable idempotent linking, no quantity mutation.');
await db.close();
