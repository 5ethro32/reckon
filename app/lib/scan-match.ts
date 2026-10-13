/**
 * Suggest the invoice line a scanned pack belongs to. A suggestion only pre-selects the line:
 * staff still confirm the product and pack size before a new barcode mapping is saved.
 *
 * 1. This pharmacy's verified mapping for the supplier gives the supplier product code exactly.
 * 2. Otherwise the NHS dm+d pack (Open Government Licence) gives the medicine, strength and pack
 *    quantity, which are compared with the invoice description and pack size.
 */
export type MatchLine = { id: string; description: string; pack_size: string | null; supplier_sku: string | null };
export type DmdHint = { name: string; generic_name: string | null; pack_qty: number | null };
export type ScanMatch = { lineIds: string[]; source: 'mapping' | 'dmd' | 'none' };

const UNIT: Record<string, string> = { mg: 'mg', g: 'g', mcg: 'microgram', microgram: 'microgram', micrograms: 'microgram', ug: 'microgram', ml: 'ml', '%': '%', unit: 'unit', units: 'unit', iu: 'unit' };
const STRENGTH = /(\d+(?:\.\d+)?)\s*(mg|g|mcg|micrograms?|ug|ml|%|units?|iu)(?![a-z])/gi;
/** "160mg", "2.5 mg", "100micrograms" -> "160mg", "2.5mg", "100microgram". Per-volume strengths keep their first part. */
export function strengths(text: string): string[] {
  const out = new Set<string>();
  // "8/500mg" (invoice shorthand) means 8mg and 500mg, as dm+d writes "8mg/500mg".
  const expanded = text.toLowerCase().replace(/,/g, '').replace(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\s*(mg|g|mcg|micrograms?|ml)\b/g, '$1$3/$2$3');
  for (const m of expanded.matchAll(STRENGTH)) out.add(`${Number(m[1])}${UNIT[m[2].toLowerCase()] ?? m[2].toLowerCase()}`);
  return [...out];
}
/** First word of the generic name: the medicine itself ("Verapamil 160mg tablets" -> "verapamil"). */
function molecule(hint: DmdHint): string | null {
  const word = (hint.generic_name ?? hint.name).toLowerCase().match(/[a-z][a-z-]{2,}/);
  return word ? word[0] : null;
}
function packQty(line: MatchLine): number | null {
  const fromSize = line.pack_size?.match(/\d+/)?.[0];
  if (fromSize) return Number(fromSize);
  return null;
}
/** Edit distance, capped: used to tolerate one-letter misspellings in supplier descriptions. */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...cur) > max) return false;
    prev = cur;
  }
  return prev[b.length]! <= max;
}
/** The medicine appears in the description, allowing one wrong letter in longer names ("Mirtazipine"). */
function mentions(desc: string, med: string): boolean {
  if (desc.includes(med)) return true;
  if (med.length < 7) return false;
  return (desc.match(/[a-z][a-z-]+/g) ?? []).some((w) => w[0] === med[0] && withinEdits(w, med, 1));
}
function fitsDmd(line: MatchLine, hint: DmdHint): boolean {
  const desc = line.description.toLowerCase();
  const med = molecule(hint);
  if (!med || !mentions(desc, med)) return false;
  const want = strengths(hint.generic_name ?? hint.name);
  const have = strengths(desc);
  if (want.length && !want.every((s) => have.includes(s))) return false;
  const qty = packQty(line);
  if (hint.pack_qty !== null && qty !== null && qty !== hint.pack_qty) return false;
  return true;
}
export function matchScan(lines: MatchLine[], mappedSkus: string[], dmd: DmdHint[]): ScanMatch {
  if (mappedSkus.length) {
    const ids = lines.filter((l) => l.supplier_sku && mappedSkus.includes(l.supplier_sku)).map((l) => l.id);
    if (ids.length) return { lineIds: ids, source: 'mapping' };
  }
  if (dmd.length) {
    const ids = lines.filter((l) => dmd.some((h) => fitsDmd(l, h))).map((l) => l.id);
    if (ids.length) return { lineIds: ids, source: 'dmd' };
  }
  return { lineIds: [], source: 'none' };
}
