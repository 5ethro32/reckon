/**
 * Load NHS dm+d pack barcodes into public.dmd_packs (migration 0015).
 *
 * Download the weekly dm+d release and its GTIN file from NHS TRUD (free, registration required),
 * unzip both into one folder, then:
 *
 *   npx tsx scripts/import-dmd.mts --dir ./dmd --csv dmd_packs.csv          # write a CSV only
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/import-dmd.mts --dir ./dmd --load
 *
 * Needs f_ampp2_*.xml, f_vmpp2_*.xml and f_gtin2_*.xml (the GTIN file may be in a gtin/ subfolder).
 * Contains public sector information licensed under the Open Government Licence v3.0.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

function toCsv(rows: DmdPack[]): string {
  const cols = ['gtin', 'ampp_id', 'name', 'generic_name', 'pack_qty', 'discontinued', 'gtin_start', 'gtin_end'] as const;
  const cell = (v: unknown) => v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

async function load(release: string, rows: DmdPack[]) {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to load');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
  for (let i = 0; i < rows.length; i += 2000) {
    const r = await fetch(`${url}/rest/v1/dmd_packs?on_conflict=gtin,ampp_id`, { method: 'POST', headers, body: JSON.stringify(rows.slice(i, i + 2000)) });
    if (!r.ok) throw new Error(`Load failed at row ${i}: ${r.status} ${await r.text()}`);
    process.stdout.write(`\r${Math.min(i + 2000, rows.length)}/${rows.length}`);
  }
  const r = await fetch(`${url}/rest/v1/dmd_releases?on_conflict=release`, { method: 'POST', headers, body: JSON.stringify([{ release, packs: rows.length, loaded_at: new Date().toISOString() }]) });
  if (!r.ok) throw new Error(`Release record failed: ${r.status} ${await r.text()}`);
  console.log(`\nLoaded dm+d release ${release}: ${rows.length} pack barcodes.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i < 0 ? undefined : process.argv[i + 1]; };
  const dir = arg('--dir'); if (!dir) throw new Error('Usage: --dir <dm+d folder> [--csv out.csv] [--load]');
  const { release, packs } = readDmd(dir);
  console.log(`dm+d release ${release}: ${packs.length} pack barcodes (${packs.filter((p) => !p.gtin_end).length} current)`);
  const csv = arg('--csv'); if (csv) { writeFileSync(csv, toCsv(packs)); console.log(`Wrote ${csv}`); }
  if (process.argv.includes('--load')) await load(release, packs);
}
