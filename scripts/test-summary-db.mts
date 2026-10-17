// Migration 0018: the SQL summaries must agree with summarise(), and the rewritten RLS must isolate pharmacies.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { summarise, sortSuppliers, type Invoice, type Line, type Claim, type SupplierRow } from '../app/lib/operations-summary.ts';
const db = new PGlite();
await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
create table auth.users(id uuid primary key); create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid,bucket_id text,name text);
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
for (const f of readdirSync('supabase/migrations').filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
  await db.exec(readFileSync('supabase/migrations/' + f, 'utf8').replace(/create extension[^;]+;/g, ''));
}
// Supabase grants table access to both API roles by default; RLS does the scoping.
await db.exec(`grant usage on schema public,auth to authenticated,anon;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant select on public.pharmacies, public.invoices to anon;`);
const u1 = '00000000-0000-0000-0000-0000000000a1', u2 = '00000000-0000-0000-0000-0000000000a2';
const p1 = '00000000-0000-0000-0000-0000000000b1', p2 = '00000000-0000-0000-0000-0000000000b2', p3 = '00000000-0000-0000-0000-0000000000b3';
await db.exec(`insert into auth.users values('${u1}'),('${u2}');
insert into pharmacies(id,name) values('${p1}','One'),('${p2}','Two'),('${p3}','Three');
insert into pharmacy_memberships(pharmacy_id,user_id) values('${p1}','${u1}'),('${p2}','${u1}'),('${p3}','${u2}');`);

// Deterministic synthetic history: every line state, deleted invoices, every claim status.
let seed = 42;
const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const now = Date.parse('2026-10-14T12:00:00Z');
const flagSets = ['[]', '[]', '[]', '["short"]', '["damaged"]', '["short","damaged"]', '{}'];
for (let i = 0; i < 60; i++) {
  const pharmacy = [p1, p2, p3][rand(3)], supplier = ['aah', 'aver', 'phoenix'][rand(3)];
  const created = new Date(now - (rand(5) + 1) * 86400000 * 3).toISOString(); // some uploads share a timestamp
  const inv = (await db.query<{ id: string }>(`insert into invoices(pharmacy_id,supplier,invoice_number,invoice_date,gross_total,created_at,deleted_at)
    values($1,$2,$3,date '2026-09-01' + $4::int,$5,$6,$7) returning id`,
  [pharmacy, supplier, 'INV' + i, rand(40), (rand(100000) / 100).toFixed(2), created, rand(10) === 0 ? new Date(now).toISOString() : null])).rows[0].id;
  const lineCount = rand(6), mode = rand(3); // no lines, mixed, fully received, or received with issues
  for (let n = 1; n <= lineCount; n++) {
    const ordered = rand(4) + 1;
    const received = mode === 0 ? [null, ordered, ordered, Math.max(0, ordered - 1)][rand(4)] : mode === 1 ? ordered : [ordered, ordered - 1][rand(2)];
    const flags = mode === 1 ? '[]' : flagSets[rand(flagSets.length)];
    await db.query(`insert into invoice_lines(invoice_id,pharmacy_id,line_number,supplier_sku,description,qty_ordered,qty_received,unit_price,net,vat_rate,vat_amount,gross,flags)
      values($1,$2,$3,'sku','Synthetic',$4,$5,1,1,0,0,1,$6::jsonb)`, [inv, pharmacy, n, ordered, received, flags]);
  }
}
for (let i = 0; i < 60; i++) {
  const status = ['draft', 'sent', 'sent', 'overdue', 'resolved', 'cancelled'][rand(6)];
  const sentAt = status === 'draft' || rand(5) === 0 ? null : new Date(now - rand(30) * 86400000 - (i === 0 ? 0 : rand(3600000))).toISOString();
  await db.query(`insert into credit_requests(pharmacy_id,supplier,status,total_amount,sent_at) values($1,$2,$3,$4,$5)`,
    [[p1, p2, p3][rand(3)], ['aah', 'aver', 'zeta'][rand(3)], status, (rand(5000) / 100).toFixed(2), sentAt]);
}
// A claim sent exactly 14 days ago is aged in both implementations.
await db.query(`insert into credit_requests(pharmacy_id,supplier,status,total_amount,sent_at) values($1,'aah','sent',1,$2)`, [p1, new Date(now - 14 * 86400000).toISOString()]);

// Reference: what the app computed before, from rows the user can see.
const iso = (col: string) => `to_char(${col} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
async function reference(pharmacies: string[]) {
  await db.exec('reset role');
  const invoices = (await db.query<Invoice>(`select id,pharmacy_id,supplier,invoice_number,invoice_date::text,gross_total,${iso('created_at')} created_at from invoices where deleted_at is null and pharmacy_id = any($1) order by id`, [pharmacies])).rows;
  const lines = (await db.query<Line>(`select id,invoice_id,qty_ordered,qty_received,flags,credit_request_id from invoice_lines where pharmacy_id = any($1) order by id`, [pharmacies])).rows;
  const claims = (await db.query<Claim>(`select id,pharmacy_id,supplier,status,total_amount,${iso('sent_at')} sent_at from credit_requests where status in ('draft','sent','overdue') and pharmacy_id = any($1) order by id`, [pharmacies])).rows;
  return summarise(invoices, lines, claims, now);
}
async function as(user: string | null, role = 'authenticated') {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user ?? ''}',false); set role ${role}`);
}
type Summary = { receipt_count: number; unfinished_count: number; issue_count: number; open_count: number; open_total: number; aged_count: number;
  unfinished: { id: string; lines: number; pending: number }[]; aged: { id: string }[]; suppliers: SupplierRow[] };

for (const [user, pharmacies] of [[u1, [p1, p2]], [u2, [p3]]] as const) {
  const ref = await reference([...pharmacies]);
  await as(user);
  const sql = (await db.query<{ s: Summary }>(`select dashboard_summary($1) s`, [new Date(now).toISOString()])).rows[0].s;
  const unfinished = ref.receipts.filter(r => !r.lines || r.pending > 0).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  assert.equal(sql.receipt_count, ref.receipts.length);
  assert.equal(sql.unfinished_count, unfinished.length);
  assert.deepEqual(sql.unfinished.map(r => [r.id, r.lines, r.pending]), unfinished.slice(0, 8).map(r => [r.id, r.lines, r.pending]));
  assert.equal(sql.issue_count, ref.receipts.filter(r => r.exceptions > 0).length);
  assert.equal(sql.open_count, ref.openClaims.length);
  assert.equal(Number(sql.open_total).toFixed(2), ref.openClaims.reduce((s, c) => s + Number(c.total_amount), 0).toFixed(2));
  assert.equal(sql.aged_count, ref.agedClaims.length);
  const aged = ref.agedClaims.sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? '') || a.id.localeCompare(b.id));
  assert.deepEqual(sql.aged.map(c => c.id), aged.slice(0, 6).map(c => c.id));
  const round = (rows: SupplierRow[]) => rows.map(r => ({ ...r, invoiceGross: Number(r.invoiceGross).toFixed(2), claimTotal: Number(r.claimTotal).toFixed(2) }));
  assert.deepEqual(round(sortSuppliers(sql.suppliers)).sort((a, b) => (a.pharmacy + a.supplier).localeCompare(b.pharmacy + b.supplier)),
    round(ref.suppliers).sort((a, b) => (a.pharmacy + a.supplier).localeCompare(b.pharmacy + b.supplier)));
  // The invoices list view carries the same per-invoice counts.
  const view = (await db.query<{ id: string; line_count: number; full_count: number; pending_count: number; issue_count: number; pharmacy_id: string }>(
    'select id,pharmacy_id,line_count,full_count,pending_count,issue_count from invoice_receipt_summary order by id')).rows;
  assert.deepEqual(view.map(v => [v.id, v.line_count, v.full_count, v.pending_count, v.issue_count]),
    ref.receipts.map(r => [r.id, r.lines, r.fullCount, r.pending, r.exceptions]));
  assert.ok(view.every(v => (pharmacies as readonly string[]).includes(v.pharmacy_id)));
  const counts = (await db.query<{ n: number }>('select coalesce(sum(invoice_count),0)::int n from invoice_supplier_counts')).rows[0].n;
  assert.equal(counts, ref.receipts.length);
}

// RLS still isolates pharmacies, for reads and writes, with membership checked once per statement.
await as(u2);
assert.equal((await db.query<{ n: number }>(`select count(*)::int n from invoices where pharmacy_id in ($1,$2)`, [p1, p2])).rows[0].n, 0);
assert.equal((await db.query<{ n: number }>(`select count(*)::int n from pharmacy_memberships`)).rows[0].n, 1);
await assert.rejects(db.query(`insert into invoices(pharmacy_id,supplier,invoice_number,invoice_date) values($1,'aah','X1',current_date)`, [p1]));
await db.query(`insert into invoices(pharmacy_id,supplier,invoice_number,invoice_date) values($1,'aah','X1',current_date)`, [p3]);
const plan = (await db.query<{ 'QUERY PLAN': string }>('explain select * from invoice_lines')).rows.map(r => r['QUERY PLAN']).join('\n');
assert.match(plan, /SubPlan|InitPlan/);
assert.doesNotMatch(plan, /user_belongs_to_pharmacy/);
// Without a session: no rows and no errors from the policies; the summaries refuse.
await as(null, 'anon');
assert.equal((await db.query<{ n: number }>('select count(*)::int n from pharmacies')).rows[0].n, 0);
assert.equal((await db.query<{ n: number }>('select count(*)::int n from invoices')).rows[0].n, 0);
await assert.rejects(db.query('select * from invoice_receipt_summary'));
await assert.rejects(db.query('select dashboard_summary()'));
await as(null);
await assert.rejects(db.query('select dashboard_summary()'), /Sign in/);

// Search text and the credits page filter: '[]' means no flags, '{}' is not "no flags".
await db.exec('reset role');
await db.query(`insert into invoices(id,pharmacy_id,supplier,invoice_number,invoice_date,gross_total) values('00000000-0000-0000-0000-0000000000c1',$1,'aver','AB-77',date '2026-10-01',12.50)`, [p1]);
assert.equal((await db.query<{ s: string }>(`select search_text s from invoice_receipt_summary where id='00000000-0000-0000-0000-0000000000c1'`)).rows[0].s,
  ['aver', 'ab-77', '01/10/2026', '12.5'].join(String.fromCharCode(31)));
const unclaimed = (await db.query<{ flags: unknown }>('select flags from invoice_lines where credit_request_id is null')).rows;
const flaggedSql = (await db.query<{ n: number }>(`select count(*)::int n from invoice_lines where credit_request_id is null and flags <> '[]'::jsonb`)).rows[0].n;
const flaggedJs = unclaimed.filter(r => JSON.stringify(r.flags) !== '[]').length;
assert.equal(flaggedSql, flaggedJs);
assert.ok(unclaimed.filter(r => Array.isArray(r.flags) && r.flags.length > 0).length <= flaggedSql);
console.log('Summary SQL matches summarise(); RLS isolates pharmacies with one membership lookup per query.');
