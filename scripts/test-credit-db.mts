import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
create table auth.users(id uuid primary key); create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid,bucket_id text,name text);
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
for(const f of readdirSync('supabase/migrations').filter(f=>/^000[1-8]_.*sql$|^001[023]_.*sql$/.test(f)).sort()) {
 await db.exec(readFileSync('supabase/migrations/'+f,'utf8').replace(/create extension[^;]+;/g,''));
}
const user='00000000-0000-0000-0000-000000000001';
const pharmacy='00000000-0000-0000-0000-000000000002';
await db.exec(`insert into auth.users values('${user}');insert into pharmacies(id,name) values('${pharmacy}','Synthetic pharmacy');
insert into pharmacy_memberships(pharmacy_id,user_id) values('${pharmacy}','${user}');select set_config('request.jwt.claim.sub','${user}',false);
grant usage on schema public,auth to authenticated;grant select,insert,update,delete on all tables in schema public to authenticated;`);
async function scenario(reference: string | null, count: number, note?: string) {
 const invoice=(await db.query<{id:string}>(`insert into invoices(pharmacy_id,supplier,invoice_number,invoice_date) values($1,'test',gen_random_uuid()::text,current_date) returning id`,[pharmacy])).rows[0].id;
 const invNo=(await db.query<{invoice_number:string}>('select invoice_number from invoices where id=$1',[invoice])).rows[0].invoice_number;
 const claims:string[]=[];
 for(let i=0;i<count;i++) {
  const cr=(await db.query<{id:string}>(`insert into credit_requests(pharmacy_id,supplier,status,total_amount,external_credit_note_number) values($1,'test','sent',12,$2) returning id`,[pharmacy,note??null])).rows[0].id;
  claims.push(cr);
  await db.query(`insert into invoice_lines(invoice_id,pharmacy_id,line_number,supplier_sku,description,qty_ordered,qty_received,unit_price,net,vat_rate,vat_amount,gross,flags,credit_request_id) values($1,$2,$3,'x','Synthetic pack',1,0,10,10,20,2,12,'["not_received"]',$4)`,[invoice,pharmacy,i+1,cr]);
 }
 const st=(await db.query<{id:string}>(`insert into statements(pharmacy_id,supplier,statement_date) values($1,gen_random_uuid()::text,current_date) returning id`,[pharmacy])).rows[0].id;
 await db.query(`update statements set supplier='test',statement_date=current_date+(select count(*)::int from statements) where id=$1`,[st]);
 const row=(await db.query<{id:string}>(`insert into statement_lines(statement_id,pharmacy_id,line_number,document_date,document_number,document_type,reference,net,vat,total) values($1,$2,1,current_date,$3,'CRED',$4,-10,-2,-12) returning id`,[st,pharmacy,note??crypto.randomUUID(),reference==='invoice'?invNo:reference])).rows[0].id;
 return {row,claims,invoice};
}
const amountOnly=await scenario(null,1);
assert.equal((await db.query<{x:string|null}>('select try_match_credit_row_safely($1) as x',[amountOnly.row])).rows[0].x,null);
const ambiguous=await scenario('invoice',2);
assert.equal((await db.query<{x:string|null}>('select try_match_credit_row_safely($1) as x',[ambiguous.row])).rows[0].x,null);
const exact=await scenario('invoice',1);
assert.equal((await db.query<{x:string|null}>('select try_match_credit_row_safely($1) as x',[exact.row])).rows[0].x,exact.claims[0]);
assert.equal((await db.query<{x:string|null}>('select try_match_credit_row_safely($1) as x',[exact.row])).rows[0].x,null);
const note=await scenario(null,1,'CN-EXACT');
assert.equal((await db.query<{x:string|null}>('select try_match_credit_row_safely($1) as x',[note.row])).rows[0].x,note.claims[0]);
const reused=await scenario(null,1,'CN-EXACT');
assert.equal((await db.query<{x:string|null}>('select try_match_credit_row_safely($1) as x',[reused.row])).rows[0].x,null);
const loose=await scenario('invoice',1);
await db.query(`insert into invoice_lines(invoice_id,pharmacy_id,line_number,supplier_sku,description,qty_ordered,qty_received,unit_price,net,vat_rate,vat_amount,gross,flags) values($1,$2,2,'y','Another pack',1,0,10,10,20,2,12,'["not_received"]')`,[loose.invoice,pharmacy]);
assert.equal((await db.query<{x:string|null}>('select try_match_credit_row_safely($1) as x',[loose.row])).rows[0].x,null);
assert.equal(Number((await db.query<{x:string}>(`select expected_credit_gross('["short"]',120,10,null,null) x`)).rows[0].x),0);
assert.equal(Number((await db.query<{x:string}>(`select expected_credit_gross('["short"]',120,10,9,null) x`)).rows[0].x),12);
const freeLine=(await db.query<{id:string}>(`select id from invoice_lines where invoice_id=$1 and credit_request_id is null`,[loose.invoice])).rows[0].id;
await assert.rejects(db.query('select create_credit_request_from_lines($1,$2)',[[freeLine],{supplier:'test',total_amount:99}]));
const before=Number((await db.query<{n:string}>('select count(*) n from credit_requests')).rows[0].n);
await db.query('select create_credit_request_from_lines($1,$2)',[[freeLine],{supplier:'test',total_amount:12,email_to:'test@example.invalid'}]);
await assert.rejects(db.query('select create_credit_request_from_lines($1,$2)',[[freeLine],{supplier:'test',total_amount:12}]));
assert.equal(Number((await db.query<{n:string}>('select count(*) n from credit_requests')).rows[0].n),before+1);
// The app's pence arithmetic must agree with the database for awkward partial credits.
{
 const { creditShare, creditValue } = await import('../app/lib/credit-amount.ts');
 const inv=(await db.query<{id:string}>(`insert into invoices(pharmacy_id,supplier,invoice_number,invoice_date) values($1,'test',gen_random_uuid()::text,current_date) returning id`,[pharmacy])).rows[0].id;
 for (const [n,gross,ordered,received] of [[1,10.03,2,1],[2,10.10,4,1],[3,0.05,3,1]] as const) {
  const id=(await db.query<{id:string}>(`insert into invoice_lines(invoice_id,pharmacy_id,line_number,supplier_sku,description,qty_ordered,qty_received,unit_price,net,vat_rate,vat_amount,gross,flags) values($1,$2,$3,'p','Partial pack',$4,$5,1,$6,0,0,$6,'["short"]') returning id`,[inv,pharmacy,n,ordered,received,gross])).rows[0].id;
  const total=creditValue(gross,creditShare({flags:['short'],qtyOrdered:ordered,qtyReceived:received,qtyReturned:null}));
  await db.query('select create_credit_request_from_lines($1,$2)',[[id],{supplier:'test',total_amount:total,email_to:'test@example.invalid'}]);
 }
}
const alien=await scenario('invoice',1);
await db.exec(`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',false);set role authenticated;`);
assert.equal((await db.query<{x:string|null}>('select try_match_credit_row_safely($1) as x',[alien.row])).rows[0].x,null);
console.log('PASS: actual migrations; partial credits agree to the penny; amount-only and ambiguous credits stay open; exact references resolve once; cross-tenant access denied.');
await db.close();
