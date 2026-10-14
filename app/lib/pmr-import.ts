/**
 * Server-side import of a dispensing-system export: parse, identify each product in dm+d, and
 * record the rows in one transaction (pmr_record_import). Unmatched products are stored and
 * reported by name; nothing is guessed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePmrXlsx, type ParsedPmr } from '@reckon/parser/pmr';
import { dmdLookupNames, indexDmd, matchToDmd, pmrProductKey, type DmdCandidate, type DmdMatch } from './pmr-match';

export const PMR_REPORT_LABEL: Record<ParsedPmr['report'], string> = { product_usage: 'Product Usage', stock_value: 'Stock Value', items_processed: 'Items Processed' };

export type PmrImportResult =
  | { ok: true; importId: string; report: ParsedPmr['report']; summary: string; unmatched: string[]; warnings: string[] }
  | { ok: false; error: string; status: number };

const monthLabel = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

async function lookupDmd(supabase: SupabaseClient, descriptions: string[]): Promise<DmdCandidate[]> {
  const names = [...new Set(descriptions.flatMap(dmdLookupNames))];
  const out: DmdCandidate[] = [];
  for (let i = 0; i < names.length; i += 500) {
    const { data, error } = await supabase.rpc('pmr_dmd_lookup', { p_names: names.slice(i, i + 500) });
    if (error) throw new Error(`dm+d lookup failed: ${error.message}`);
    out.push(...((data ?? []) as DmdCandidate[]).map((d) => ({ ...d, pack_qty: d.pack_qty === null ? null : Number(d.pack_qty) })));
  }
  return out;
}

export async function importPmr(supabase: SupabaseClient, pharmacyId: string, buffer: Buffer, fileName: string): Promise<PmrImportResult> {
  let parsed: ParsedPmr;
  try { parsed = parsePmrXlsx(buffer, fileName); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : 'Could not read the export', status: 422 }; }
  if (parsed.sourceRows === 0) return { ok: false, error: `No product rows found in this ${PMR_REPORT_LABEL[parsed.report]} export.`, status: 422 };

  // Packs per description, so the unmatched list leads with what matters most.
  const weight = new Map<string, { packSize: number | null; packs: number }>();
  for (const d of parsed.dispensing) { const w = weight.get(d.description); if (w) w.packs += d.packs; else weight.set(d.description, { packSize: d.packSize, packs: d.packs }); }
  for (const s of parsed.stock) { const w = weight.get(s.description); if (w) w.packs += s.quantity; else weight.set(s.description, { packSize: s.packSize, packs: s.quantity }); }
  const matches = new Map<string, DmdMatch | null>();
  if (weight.size) {
    let index;
    try { index = indexDmd(await lookupDmd(supabase, [...weight.keys()])); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : 'dm+d lookup failed', status: 500 }; }
    for (const [d, w] of weight) matches.set(d, matchToDmd(d, w.packSize, index));
  }
  const ref = (description: string, packSize: number | null) => {
    const m = matches.get(description) ?? null;
    return { description, product_key: pmrProductKey(description, m), pack_size: m?.pack_qty ?? packSize, dmd_source: m?.source ?? null, dmd_ampp_id: m?.ampp_id ?? null, dmd_name: m?.dmd_name ?? null };
  };
  const rows = parsed.report === 'product_usage'
    ? parsed.dispensing.map((d) => ({ ...ref(d.description, d.packSize), site: d.site, month: `${d.month}-01`, packs: d.packs, units: d.units, value: d.value }))
    : parsed.report === 'stock_value'
    ? parsed.stock.map((s) => ({ ...ref(s.description, s.packSize), location: s.location, quantity: s.quantity, tariff: s.tariff, value: s.value, status: s.status }))
    : parsed.pips;
  const unmatched = [...weight].filter(([d]) => !matches.get(d)).sort((a, b) => b[1].packs - a[1].packs).map(([d]) => d);
  const matched = weight.size - unmatched.length;

  const { data: importId, error } = await supabase.rpc('pmr_record_import', {
    p_pharmacy_id: pharmacyId,
    p_import: { source_system: 'psl', report: parsed.report, file_name: fileName, period_start: parsed.periodStart, period_end: parsed.periodEnd, snapshot_date: parsed.snapshotDate, sites: parsed.sites, matched_count: matched, unmatched_count: unmatched.length },
    p_rows: rows,
  });
  if (error || !importId) return { ok: false, error: `Saving the export failed: ${error?.message ?? 'unknown error'}`, status: 500 };

  const label = `Positive Solutions ${PMR_REPORT_LABEL[parsed.report]}`;
  const period = parsed.report === 'stock_value'
    ? `stock at ${parsed.snapshotDate ?? 'upload date'}`
    : parsed.periodStart && parsed.periodEnd ? (parsed.report === 'product_usage' ? `${monthLabel(parsed.periodStart)} to ${monthLabel(parsed.periodEnd)}` : `${parsed.periodStart} to ${parsed.periodEnd}`) : 'period not stated';
  const counts = parsed.report === 'items_processed'
    ? `${parsed.sourceRows} items, ${parsed.pips.length} products with a PIP code`
    : `${parsed.sourceRows} rows, ${weight.size} products: ${matched} matched to dm+d, ${unmatched.length} unmatched`;
  const sites = parsed.sites.length > 1 ? `, ${parsed.sites.length} sites` : '';
  return { ok: true, importId: importId as string, report: parsed.report, summary: `${label}, ${period}${sites}. ${counts}.`, unmatched: unmatched.slice(0, 10), warnings: parsed.warnings };
}
