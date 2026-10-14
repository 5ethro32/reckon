/**
 * Load NHS dm+d pack barcodes into public.dmd_packs (migration 0015), and reimbursement prices into
 * public.dmd_vmpps and public.dmd_ampps (migration 0020): the Drug Tariff price and payment category per
 * VMPP (VMPP DTINFO) and the NHS indicative price per AMPP (AMPP PRICE_INFO, price basis 0001).
 *
 * Download the weekly dm+d release and its GTIN file from NHS TRUD (free, registration required),
 * unzip both into one folder, then:
 *
 *   npx tsx scripts/import-dmd.mts --dir ./dmd --csv dmd_packs.csv          # write a CSV only
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/import-dmd.mts --dir ./dmd --load
 *
 * Needs f_ampp2_*.xml, f_vmpp2_*.xml, f_lookup2_*.xml and f_gtin2_*.xml (the GTIN file may be in a gtin/ subfolder).
 * Prices are in pence, as published. --csv also writes <name>.vmpps.csv and <name>.ampps.csv.
 * Contains public sector information licensed under the Open Government Licence v3.0.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type DmdVmpp = { vmpp_id: string; name: string; pack_qty: number | null; dt_category_code: string | null; dt_category: string | null; dt_price_pence: number | null; dt_price_date: string | null; dt_prev_price_pence: number | null };
export type DmdAmpp = { ampp_id: string; vmpp_id: string; name: string; nhs_price_pence: number | null; price_date: string | null; prev_price_pence: number | null };
export type DmdPack = { gtin: string; ampp_id: string; name: string; generic_name: string | null; pack_qty: number | null; discontinued: boolean; gtin_start: string | null; gtin_end: string | null };

function findFile(dir: string, prefix: string): string {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { try { return findFile(path, prefix); } catch { continue; } }
    if (entry.startsWith(prefix) && entry.endsWith('.xml')) return path;
  }
  throw new Error(`No ${prefix}*.xml under ${dir}`);
}
const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? null;
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
function* blocks(xml: string, name: string): Generator<string> {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g');
  for (let m = re.exec(xml); m; m = re.exec(xml)) yield m[1];
}
function checkGtin(raw: string): string | null {
  const digits = raw.trim();
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return null;
  const d = digits.split('').map(Number); const check = d.pop()!;
  const sum = d.reverse().reduce((t, x, i) => t + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? digits.padStart(14, '0') : null;
}

export function readDmd(dir: string): { release: string; packs: DmdPack[] } {
  const vmpp = new Map<string, { name: string; qty: number | null }>();
  for (const b of blocks(readFileSync(findFile(dir, 'f_vmpp2_'), 'utf8'), 'VMPP')) {
    const id = tag(b, 'VPPID'); if (!id) continue;
    const qty = tag(b, 'QTYVAL');
    vmpp.set(id, { name: decode(tag(b, 'NM') ?? ''), qty: qty === null ? null : Number(qty) });
  }
  const ampp = new Map<string, { name: string; vppid: string | null; discontinued: boolean }>();
  for (const b of blocks(readFileSync(findFile(dir, 'f_ampp2_'), 'utf8'), 'AMPP')) {
    const id = tag(b, 'APPID'); if (!id) continue;
    ampp.set(id, { name: decode(tag(b, 'NM') ?? ''), vppid: tag(b, 'VPPID'), discontinued: tag(b, 'DISCCD') !== null });
  }
  const gtinFile = findFile(dir, 'f_gtin2_');
  const release = gtinFile.match(/f_gtin2_(\d+)\.xml$/)?.[1] ?? 'unknown';
  const packs = new Map<string, DmdPack>();
  for (const b of blocks(readFileSync(gtinFile, 'utf8'), 'AMPP')) {
    const id = tag(b, 'AMPPID'); const a = id ? ampp.get(id) : undefined;
    if (!id || !a) continue;
    const v = a.vppid ? vmpp.get(a.vppid) : undefined;
    for (const g of blocks(b, 'GTINDATA')) {
      const gtin = checkGtin(tag(g, 'GTIN') ?? ''); if (!gtin) continue;
      const end = tag(g, 'ENDDT');
      const key = `${gtin}:${id}`; const prior = packs.get(key);
      // A GTIN can be listed twice for one pack (e.g. 13- and 14-digit forms); keep the current one.
      if (prior && prior.gtin_end === null) continue;
      packs.set(key, { gtin, ampp_id: id, name: a.name, generic_name: v?.name ?? null, pack_qty: v?.qty ?? null, discontinued: a.discontinued, gtin_start: tag(g, 'STARTDT'), gtin_end: end });
    }
  }
  return { release, packs: [...packs.values()] };
}

const int = (v: string | null) => v === null || v.trim() === '' ? null : Number(v);

/** Reimbursement prices. Concepts flagged invalid are skipped; prices stay in pence. */
export function readDmdPrices(dir: string): { vmpps: DmdVmpp[]; ampps: DmdAmpp[] } {
  const categories = new Map<string, string>();
  for (const section of blocks(readFileSync(findFile(dir, 'f_lookup2_'), 'utf8'), 'DT_PAYMENT_CATEGORY'))
    for (const b of blocks(section, 'INFO')) { const cd = tag(b, 'CD'); if (cd) categories.set(cd, decode(tag(b, 'DESC') ?? '')); }
  const vmppXml = readFileSync(findFile(dir, 'f_vmpp2_'), 'utf8');
  const tariff = new Map<string, string>();
  for (const b of blocks(vmppXml, 'DTINFO')) { const id = tag(b, 'VPPID'); if (id) tariff.set(id, b); }
  const vmpps: DmdVmpp[] = [];
  for (const b of blocks(vmppXml, 'VMPP')) {
    const id = tag(b, 'VPPID'); if (!id || tag(b, 'INVALID') === '1') continue;
    const dt = tariff.get(id); const cd = dt ? tag(dt, 'PAY_CATCD') : null;
    vmpps.push({ vmpp_id: id, name: decode(tag(b, 'NM') ?? ''), pack_qty: int(tag(b, 'QTYVAL')), dt_category_code: cd, dt_category: cd ? categories.get(cd) ?? null : null,
      dt_price_pence: dt ? int(tag(dt, 'PRICE')) : null, dt_price_date: dt ? tag(dt, 'DT') : null, dt_prev_price_pence: dt ? int(tag(dt, 'PREVPRICE')) : null });
  }
  const amppXml = readFileSync(findFile(dir, 'f_ampp2_'), 'utf8');
  const prices = new Map<string, string>();
  for (const b of blocks(amppXml, 'PRICE_INFO')) { const id = tag(b, 'APPID'); if (id) prices.set(id, b); }
  const ampps: DmdAmpp[] = [];
  for (const b of blocks(amppXml, 'AMPP')) {
    const id = tag(b, 'APPID'); const vppid = tag(b, 'VPPID'); if (!id || !vppid || tag(b, 'INVALID') === '1') continue;
    // Only price basis 0001 is an NHS indicative price; the other bases publish no price (often as 0).
    const p = prices.get(id); const indicative = p !== undefined && tag(p, 'PRICE_BASISCD') === '0001';
    ampps.push({ ampp_id: id, vmpp_id: vppid, name: decode(tag(b, 'NM') ?? ''), nhs_price_pence: indicative ? int(tag(p, 'PRICE')) : null,
      price_date: indicative ? tag(p, 'PRICEDT') : null, prev_price_pence: indicative ? int(tag(p, 'PRICE_PREV')) : null });
  }
  return { vmpps, ampps };
}

function toCsv<T extends object>(rows: T[], cols: readonly (keyof T & string)[]): string {
  const cell = (v: unknown) => v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

async function upsert(url: string, headers: Record<string, string>, table: string, conflict: string, rows: object[]) {
  for (let i = 0; i < rows.length; i += 2000) {
    const r = await fetch(`${url}/rest/v1/${table}?on_conflict=${conflict}`, { method: 'POST', headers, body: JSON.stringify(rows.slice(i, i + 2000)) });
    if (!r.ok) throw new Error(`${table} load failed at row ${i}: ${r.status} ${await r.text()}`);
    process.stdout.write(`\r${table} ${Math.min(i + 2000, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');
}

async function load(release: string, rows: DmdPack[], prices: { vmpps: DmdVmpp[]; ampps: DmdAmpp[] }) {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to load');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
  await upsert(url, headers, 'dmd_packs', 'gtin,ampp_id', rows);
  await upsert(url, headers, 'dmd_vmpps', 'vmpp_id', prices.vmpps);
  await upsert(url, headers, 'dmd_ampps', 'ampp_id', prices.ampps);
  const r = await fetch(`${url}/rest/v1/dmd_releases?on_conflict=release`, { method: 'POST', headers, body: JSON.stringify([{ release, packs: rows.length, vmpps: prices.vmpps.length, ampps: prices.ampps.length, loaded_at: new Date().toISOString() }]) });
  if (!r.ok) throw new Error(`Release record failed: ${r.status} ${await r.text()}`);
  console.log(`Loaded dm+d release ${release}: ${rows.length} pack barcodes, ${prices.vmpps.length} VMPPs, ${prices.ampps.length} AMPPs.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i < 0 ? undefined : process.argv[i + 1]; };
  const dir = arg('--dir'); if (!dir) throw new Error('Usage: --dir <dm+d folder> [--csv out.csv] [--load]');
  const { release, packs } = readDmd(dir);
  const prices = readDmdPrices(dir);
  console.log(`dm+d release ${release}: ${packs.length} pack barcodes (${packs.filter((p) => !p.gtin_end).length} current)`);
  console.log(`${prices.vmpps.length} VMPPs (${prices.vmpps.filter((v) => v.dt_price_pence !== null).length} with a Drug Tariff price), ${prices.ampps.length} AMPPs (${prices.ampps.filter((a) => a.nhs_price_pence !== null).length} with an NHS indicative price)`);
  const csv = arg('--csv');
  if (csv) {
    const base = csv.replace(/\.csv$/, '');
    writeFileSync(csv, toCsv(packs, ['gtin', 'ampp_id', 'name', 'generic_name', 'pack_qty', 'discontinued', 'gtin_start', 'gtin_end']));
    writeFileSync(`${base}.vmpps.csv`, toCsv(prices.vmpps, ['vmpp_id', 'name', 'pack_qty', 'dt_category_code', 'dt_category', 'dt_price_pence', 'dt_price_date', 'dt_prev_price_pence']));
    writeFileSync(`${base}.ampps.csv`, toCsv(prices.ampps, ['ampp_id', 'vmpp_id', 'name', 'nhs_price_pence', 'price_date', 'prev_price_pence']));
    console.log(`Wrote ${csv}, ${base}.vmpps.csv and ${base}.ampps.csv`);
  }
  if (process.argv.includes('--load')) await load(release, packs, prices);
}
