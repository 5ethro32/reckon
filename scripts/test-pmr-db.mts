import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
create table auth.users(id uuid primary key); create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid,bucket_id text,name text);
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
// 0019 depends only on the base schema and the dm+d reference table (0015).
for (const f of readdirSync('supabase/migrations').filter((f) => /^(000[1-9]|001[0-7]|0019)_.*sql$/.test(f)).sort()) {
  await db.exec(readFileSync('supabase/migrations/' + f, 'utf8').replace(/create extension[^;]+;/g, ''));
}
const user = '00000000-0000-0000-0000-000000000001', pharmacy = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003', stranger = '00000000-0000-0000-0000-000000000099';
await db.exec(`insert into auth.users values('${user}'),('${stranger}');insert into pharmacies(id,name) values('${pharmacy}','Synthetic pharmacy'),('${other}','Other pharmacy');
insert into pharmacy_memberships(pharmacy_id,user_id) values('${pharmacy}','${user}');
insert into dmd_packs(gtin,ampp_id,name,generic_name,pack_qty) values('05000000000001','1000001','Synthetic 10mg tablets (Maker Ltd) 28 tablet','Synthetic 10mg tablets 28 tablet',28);
grant usage on schema public,auth to authenticated;grant select,insert,update,delete on all tables in schema public to authenticated;`);
await db.exec('set role authenticated');
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
await as(user);
const record = (tenant: string, imp: object, rows: object[]) => db.query<{ id: string }>('select pmr_record_import($1,$2,$3) id', [tenant, JSON.stringify(imp), JSON.stringify(rows)]);
const usage = (month: string, packs: number, site = 'Branch A') => ({ site, month, description: 'Synthetic 10mg tablets (Maker Ltd) 28 tablet', product_key: 'synthetic 10mg tablets 28 tablet', pack_size: 28, packs, units: packs * 28, value: packs * 1.5, dmd_source: 'ampp', dmd_ampp_id: '1000001', dmd_name: 'Synthetic 10mg tablets 28 tablet' });
const imp = { source_system: 'psl', report: 'product_usage', file_name: 'Product Usage.xlsx', period_start: '2026-08-01', period_end: '2026-09-30', sites: ['Branch A'], matched_count: 1, unmatched_count: 0 };

await record(pharmacy, imp, [usage('2026-08-01', 3), usage('2026-09-01', 4), usage('2026-09-01', 1, 'Branch B')]);
// The same site and month in a newer import replaces the older figures; other months and sites stay.
await record(pharmacy, imp, [usage('2026-09-01', 6)]);
const disp = (await db.query<{ site: string; month: string; packs: string }>(`select site, to_char(month,'YYYY-MM') as month, packs::text as packs from pmr_dispensing order by site, 2`)).rows;
assert.deepEqual(disp.map((r) => [r.site, r.month, Number(r.packs)]), [['Branch A', '2026-08', 3], ['Branch A', '2026-09', 6], ['Branch B', '2026-09', 1]]);
// Duplicate rows in one import are summed rather than rejected.
await record(pharmacy, imp, [usage('2026-07-01', 1), usage('2026-07-01', 2)]);
assert.equal(Number((await db.query<{ p: string }>(`select packs::text p from pmr_dispensing where month='2026-07-01'`)).rows[0]!.p), 3);

await assert.rejects(() => record(other, imp, [usage('2026-08-01', 1)]), /not available/);
await assert.rejects(() => record(pharmacy, { ...imp, source_system: 'other' }, []), /Unsupported source/);
await assert.rejects(() => record(pharmacy, { ...imp, report: 'patients' }, []));
await assert.rejects(() => record(pharmacy, imp, [{ ...usage('2026-08-15', 1) }]));
await assert.rejects(() => record(pharmacy, imp, [{ ...usage('2026-08-01', 1), pip: 'P12' }]));

const stock = (quantity: number, location = 'BDRowa') => ({ location, description: 'Synthetic 10mg tablets (Maker Ltd) 28 tablet', product_key: 'synthetic 10mg tablets 28 tablet', pack_size: 28, quantity, tariff: 1.5, value: quantity * 1.5, status: 'In Stock' });
const sv = { source_system: 'psl', report: 'stock_value', file_name: 'sample-stock-value-14-10-26 15-16-49.xlsx', snapshot_date: '2026-10-14' };
await record(pharmacy, sv, [stock(5), stock(2, 'Manual')]);
await record(pharmacy, sv, [stock(7), stock(1, 'Manual')]);
await record(pharmacy, { ...sv, snapshot_date: '2026-10-01' }, [stock(9)]);
assert.deepEqual((await db.query<{ d: string; q: string }>(`select to_char(snapshot_date,'YYYY-MM-DD') d, sum(quantity)::text q from pmr_stock_snapshots group by 1 order by 1`)).rows.map((r) => [r.d, Number(r.q)]), [['2026-10-01', 9], ['2026-10-14', 8]]);

// Items Processed fills PIP codes on stored rows and on later imports.
await record(pharmacy, { source_system: 'psl', report: 'items_processed', file_name: 'Items Processed.xlsx' }, [{ description: 'Synthetic 10mg tablets (Maker Ltd) 28 tablet', pip: '1234567' }]);
assert.equal((await db.query(`select 1 from pmr_dispensing where pip is distinct from '1234567'`)).rows.length, 0);
assert.equal((await db.query(`select 1 from pmr_stock_snapshots where pip is distinct from '1234567'`)).rows.length, 0);
await record(pharmacy, imp, [usage('2026-06-01', 1)]);
assert.equal((await db.query<{ pip: string }>(`select pip from pmr_dispensing where month='2026-06-01'`)).rows[0]!.pip, '1234567');

// dm+d lookup ignores case and finds AMPP and VMPP names.
const found = (await db.query<{ lookup: string; ampp_id: string }>(`select * from pmr_dmd_lookup(array['SYNTHETIC 10MG TABLETS (maker ltd) 28 tablet','synthetic 10mg tablets 28 tablet','nothing'])`)).rows;
assert.deepEqual(found.map((r) => r.lookup).sort(), ['synthetic 10mg tablets (maker ltd) 28 tablet', 'synthetic 10mg tablets 28 tablet']);

// Members read only their own pharmacy; direct writes are refused; anon has no access.
const counts = async () => (await db.query<{ n: string }>(`select (select count(*) from pmr_imports)+(select count(*) from pmr_dispensing)+(select count(*) from pmr_stock_snapshots)+(select count(*) from pmr_pip_codes) n`)).rows[0]!.n;
assert.ok(Number(await counts()) > 0);
await assert.rejects(() => db.query(`insert into pmr_dispensing(pharmacy_id,import_id,month,description,product_key,packs) select pharmacy_id,id,'2026-01-01','x','x',1 from pmr_imports limit 1`));
assert.equal((await db.query(`update pmr_dispensing set packs=999 returning id`)).rows.length, 0);
assert.equal((await db.query(`delete from pmr_stock_snapshots returning id`)).rows.length, 0);
await as(stranger);
assert.equal(Number(await counts()), 0);
await assert.rejects(() => record(pharmacy, imp, [usage('2026-08-01', 1)]), /not available/);
await db.exec('reset role; set role anon');
await assert.rejects(() => db.query('select * from pmr_dispensing'));
await assert.rejects(() => db.query(`select pmr_record_import('${pharmacy}','{}','[]')`));
console.log('PASS: PMR imports are atomic per report, replace overlapping months and snapshot dates, sum duplicate rows, fill PIP codes, look up dm+d by name, and stay within pharmacy membership (no direct writes, no anon access).');
await db.close();
