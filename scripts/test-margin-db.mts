// Purchase margin against the Drug Tariff and supplier performance (migration 0020), on every migration in order.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as scoring from '../app/lib/supplier-score.ts';
const { scoreSupplier } = ((scoring as { default?: typeof scoring }).default ?? scoring);
const db = new PGlite();
await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
create table auth.users(id uuid primary key); create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid,bucket_id text,name text);
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
for (const f of readdirSync('supabase/migrations').filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort())
  await db.exec(readFileSync('supabase/migrations/' + f, 'utf8').replace(/create extension[^;]+;/g, ''));
const user = '00000000-0000-0000-0000-000000000001', A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
// dm+d: V1 atorvastatin (Category M, 72p from 1 Jul 2026, 61p before); V2 brand only (no tariff price); V3 no price at all.
await db.exec(`insert into auth.users values('${user}'); insert into pharmacies(id,name) values('${A}','A'),('${B}','B');
insert into pharmacy_memberships(pharmacy_id,user_id) values('${A}','${user}');
insert into dmd_vmpps values('1271511000001104','Atorvastatin 20mg tablets 28 tablet',28,'0011','Part VIIIA Category M',72,'2026-07-01',61),
 ('2000000000000002','Brandol 5mg tablets 30 tablet',30,null,null,null,null,null),('3000000000000003','Plainol cream 50 gram',50,null,null,null,null,null);
insert into dmd_ampps values('1000000000000101','1271511000001104','Atorvastatin 20mg tablets (Accord) 28 tablet',150,'2025-01-01',null),
 ('1000000000000102','1271511000001104','Lipitor 20mg tablets 28 tablet',2464,'2005-01-01',2969),
 ('1000000000000103','2000000000000002','Brandol 5mg tablets 30 tablet',1000,'2026-01-01',null),('1000000000000104','3000000000000003','Plainol cream 50 gram',null,null,null);
insert into dmd_packs(gtin,ampp_id,name) values('05000000000011','1000000000000101','Atorvastatin'),('05000000000044','1000000000000104','Plainol');
insert into invoices(id,pharmacy_id,supplier,invoice_number,invoice_date,totals_match) values
 ('${id(1)}','${A}','aah','INV1','2026-08-05',true),('${id(2)}','${A}','phoenix','INV2','2026-08-10',false),
 ('${id(3)}','${A}','aah','INV3','2026-06-15',true),('${id(4)}','${B}','aah','OTHER','2026-08-05',true);
insert into invoice_lines(id,invoice_id,pharmacy_id,line_number,supplier_sku,description,pack_size,qty_ordered,qty_received,unit_price,net,vat_rate,vat_amount,gross,flags,gtin) values
 ('${id(11)}','${id(1)}','${A}',1,'ATO20','Atorvastatin 20mg tabs','28',10,10,0.5,5.00,0,0,5.00,'[]','05000000000011'),
 ('${id(12)}','${id(1)}','${A}',2,'BRA5','Brandol 5mg','30',2,1,12,24.00,0,0,24.00,'["short"]',null),
 ('${id(13)}','${id(1)}','${A}',3,'MYS','Mystery cream','50g',1,null,3,3.00,0,0,3.00,'[]',null),
 ('${id(14)}','${id(2)}','${A}',1,'P-ATO','ATORVASTATIN TABS 20MG','28',20,20,0.8,16.00,0,0,16.00,'["damaged"]',null),
 ('${id(15)}','${id(2)}','${A}',2,'P-PLA','Plainol cream','50',5,5,2,10.00,0,0,10.00,'[]','05000000000044'),
 ('${id(16)}','${id(2)}','${A}',3,'P-X','Conflicting pack','28',1,null,1,1.00,0,0,1.00,'[]','05000000000011'),
 ('${id(17)}','${id(3)}','${A}',1,'ATO20','Atorvastatin 20mg tabs','28',1,1,0.5,0.50,0,0,0.50,'[]','05000000000011'),
 ('${id(18)}','${id(4)}','${B}',1,'ATO20','Atorvastatin 20mg tabs','28',100,100,0.01,1.00,0,0,1.00,'[]','05000000000011');
insert into product_barcodes(pharmacy_id,supplier,supplier_sku,gtin,description,pack_size,ampp_id,verified_by) values
 ('${A}','aah','BRA5','05000000000033','Brandol 5mg','30','1000000000000103','${user}'),
 ('${A}','phoenix','P-X','05000000000033','Conflicting pack','28','1000000000000103','${user}');
insert into receipt_events(id,pharmacy_id,invoice_line_id,gtin,quantity,recorded_by) values('${id(21)}','${A}','${id(14)}','05000000000011',20,'${user}');
insert into credit_requests(pharmacy_id,supplier,status,total_amount,sent_at,resolved_at) values
 ('${A}','aah','resolved',12,'2026-08-06 10:00+00','2026-08-12 10:00+00'),('${A}','aah','sent',3,'2026-08-20 10:00+00',null),
 ('${A}','phoenix','resolved',5,'2026-09-01 10:00+00','2026-09-30 10:00+00'),('${A}','phoenix','cancelled',9,'2026-09-02 10:00+00',null);
insert into statements(pharmacy_id,supplier,statement_date,totals_match,variance) values('${A}','aah','2026-08-31',true,0),('${A}','phoenix','2026-08-31',true,5);
grant usage on schema public to authenticated, anon; grant select on all tables in schema public to authenticated, anon;`);

await db.exec(`set role anon`);
await assert.rejects(db.query(`select * from margin_lines('2026-08-01','2026-09-30')`), /permission denied/);
await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role authenticated`);
type Row = Record<string, string | number | null>;
const q = async (sql: string) => (await db.query<Row>(sql)).rows;
const lines = new Map((await q(`select * from margin_lines('2026-08-01','2026-09-30')`)).map((r) => [r.line_id, r]));
assert.equal(lines.size, 6, 'only this pharmacy, in period');
const l = (n: number) => lines.get(id(n))!;
const num = (v: unknown) => v === null ? null : Number(v);
// Invoice GTIN: 72p tariff, 50p paid.
assert.deepEqual([l(11).match_status, l(11).match_source, l(11).reimbursement_basis, l(11).dt_category], ['matched', 'invoice', 'drug_tariff', 'Part VIIIA Category M']);
assert.deepEqual([num(l(11).reimbursement_per_pack), num(l(11).margin_per_pack), num(l(11).margin), num(l(11).margin_pct), num(l(11).list_price_per_pack)], [0.72, 0.22, 2.2, 30.6, 1.5]);
// Verified mapping to a brand with no tariff price: NHS indicative price, and a loss.
assert.deepEqual([l(12).match_source, l(12).reimbursement_basis, num(l(12).margin), num(l(12).margin_pct)], ['mapping', 'nhs_indicative', -4, -20]);
assert.equal(l(13).match_status, 'unmatched'); assert.equal(l(13).margin, null); assert.equal(l(13).best_price_per_pack, null);
// Scanned packs identify the line; dearer than AAH's 50p, so 30p a pack is leakage.
assert.deepEqual([l(14).match_source, num(l(14).margin), num(l(14).best_price_per_pack), l(14).best_supplier, num(l(14).leakage)], ['scan', -1.6, 0.5, 'aah', 6]);
assert.deepEqual([l(15).match_status, l(15).reimbursement_basis, l(15).margin], ['matched', 'no_price', null]);
// Invoice GTIN and verified mapping disagree on the product: never guessed.
assert.deepEqual([l(16).match_status, l(16).match_source, l(16).vmpp_id, l(16).margin], ['conflict', 'invoice,mapping', null, null]);
// Before the 1 July price change the previous tariff price applies.
const june = await q(`select reimbursement_per_pack, margin from margin_lines('2026-06-01','2026-06-30')`);
assert.deepEqual(june.map((r) => [num(r.reimbursement_per_pack), num(r.margin)]), [[0.61, 0.11]]);

const sup = new Map((await q(`select * from margin_by_supplier('2026-08-01','2026-09-30')`)).map((r) => [r.supplier, r]));
assert.deepEqual(['lines', 'matched_lines', 'priced_lines', 'unmatched_lines', 'spend', 'priced_spend', 'reimbursement', 'margin', 'margin_pct', 'loss_lines', 'loss', 'leakage'].map((k) => num(sup.get('aah')![k])),
  [3, 2, 2, 1, 32, 29, 27.2, -1.8, -6.6, 1, 4, 0]);
assert.deepEqual(['lines', 'matched_lines', 'priced_lines', 'unmatched_lines', 'spend', 'reimbursement', 'margin', 'margin_pct', 'loss', 'leakage'].map((k) => num(sup.get('phoenix')![k])),
  [3, 2, 1, 1, 27, 14.4, -1.6, -11.1, 1.6, 6]);
const atorva = (await q(`select * from margin_by_product('2026-08-01','2026-09-30') where vmpp_id='1271511000001104'`))[0];
assert.deepEqual(['lines', 'packs', 'suppliers', 'spend', 'reimbursement', 'margin', 'margin_pct', 'loss_lines', 'best_price_per_pack', 'reimbursement_per_pack', 'leakage'].map((k) => num(atorva[k])),
  [2, 30, 2, 21, 21.6, 0.6, 2.8, 1, 0.5, 0.72, 6]);
assert.equal(atorva.best_supplier, 'aah');

const perf = new Map((await q(`select * from supplier_performance('2026-08-01','2026-09-30')`)).map((r) => [r.supplier, r]));
assert.equal(perf.size, 2);
const keys = ['invoices', 'invoices_mismatched', 'lines', 'checked_lines', 'packs_ordered', 'packs_received', 'short_lines', 'damaged_lines', 'returned_lines',
  'claims_sent', 'claims_resolved', 'claims_due', 'claims_resolved_14d', 'claims_open_overdue', 'avg_turnaround_days', 'statements', 'statements_with_variance', 'compared_lines', 'compared_spend', 'best_price_spend'];
assert.deepEqual(keys.map((k) => num(perf.get('aah')![k])), [1, 0, 3, 2, 12, 11, 1, 0, 0, 2, 1, 2, 1, 1, 6, 1, 0, 2, 29, 29]);
assert.deepEqual(keys.map((k) => num(perf.get('phoenix')![k])), [1, 1, 3, 2, 25, 25, 0, 1, 0, 1, 1, 1, 0, 0, 29, 1, 1, 2, 26, 20]);
const aah = scoreSupplier(perf.get('aah')!), phoenix = scoreSupplier(perf.get('phoenix')!);
assert.ok(aah.score !== null && phoenix.score !== null && aah.score > phoenix.score);
console.log(`PASS: margin and supplier performance (AAH margin £${sup.get('aah')!.margin}, Phoenix leakage £${sup.get('phoenix')!.leakage}; scores AAH ${aah.score}, Phoenix ${phoenix.score}).`);
