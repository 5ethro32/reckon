/**
 * Product matching for dispensing-system (PMR) data.
 *
 * 1. PMR rows to dm+d. PSL names products with the dm+d AMPP description, so the first test is an
 *    exact (case-insensitive) name match. Virtual products ("(V-Pip) [DPS=28]") and packs without a
 *    barcode in dmd_packs fall back to the VMPP name built by productKey. Either way the product is
 *    identified by its VMPP name, which collapses brands and manufacturers of one pack. A pack
 *    quantity that disagrees with dm+d rejects the match. No other similarity is used.
 * 2. Invoice lines to PMR products. In order: the pack GTIN printed on the line, the pharmacy's
 *    verified barcode for the supplier code, the PIP code (Phoenix prints it as the product code),
 *    then the description through the scan matcher (medicine, strength, pack quantity) with a form
 *    and release check. A description link is made only when exactly one PMR product fits.
 * Anything else is left unmatched and reported.
 */
import { productKey } from '@reckon/parser/pmr';
import { matchScan, type MatchLine } from './scan-match';

export type DmdCandidate = { ampp_id: string; name: string; generic_name: string | null; pack_qty: number | null };
export type DmdMatch = { source: 'ampp' | 'vmpp'; ampp_id: string | null; dmd_name: string; pack_qty: number | null };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Names to look up in dmd_packs for a PMR description: the AMPP name itself and its VMPP form. */
export function dmdLookupNames(description: string): string[] {
  const vmpp = productKey(description).name;
  return [...new Set([description.trim(), vmpp].filter(Boolean))];
}

export type DmdIndex = { byName: Map<string, DmdCandidate[]>; byGeneric: Map<string, DmdCandidate[]> };
export function indexDmd(candidates: DmdCandidate[]): DmdIndex {
  const byName = new Map<string, DmdCandidate[]>(), byGeneric = new Map<string, DmdCandidate[]>();
  const add = (m: Map<string, DmdCandidate[]>, k: string, c: DmdCandidate) => { const list = m.get(k); if (!list) m.set(k, [c]); else if (!list.some((x) => x.ampp_id === c.ampp_id)) list.push(c); };
  for (const c of candidates) { add(byName, norm(c.name), c); if (c.generic_name) add(byGeneric, norm(c.generic_name), c); }
  return { byName, byGeneric };
}

function settle(rows: DmdCandidate[], source: DmdMatch['source'], packSize: number | null): DmdMatch | null {
  const generics = new Set(rows.map((r) => r.generic_name ?? r.name));
  if (generics.size !== 1) return null;
  const qty = rows.find((r) => r.pack_qty !== null)?.pack_qty ?? null;
  if (packSize !== null && qty !== null && Math.abs(packSize - qty) > 1e-6) return null;
  const ampps = new Set(rows.map((r) => r.ampp_id));
  return { source, ampp_id: source === 'ampp' && ampps.size === 1 ? rows[0]!.ampp_id : null, dmd_name: [...generics][0]!, pack_qty: qty };
}
export function matchToDmd(description: string, packSize: number | null, index: DmdIndex): DmdMatch | null {
  const exact = index.byName.get(norm(description));
  if (exact) return settle(exact, 'ampp', packSize);
  const vmpp = index.byGeneric.get(norm(productKey(description).name));
  if (vmpp) return settle(vmpp, 'vmpp', packSize);
  return null;
}
/** The grouping key stored with each PMR row: the VMPP name when dm+d knows the product. */
export function pmrProductKey(description: string, match: DmdMatch | null): string {
  return match ? norm(match.dmd_name) : productKey(description).key;
}

// ---------------------------------------------------------------------------
// Invoice lines
// ---------------------------------------------------------------------------

export type PmrProduct = { key: string; name: string; packSize: number | null; pips: string[] };
export type PurchaseLine = MatchLine & { supplier: string };
export type LinkSource = 'gtin' | 'mapping' | 'pip' | 'description';
export type LineLink = { key: string; source: LinkSource } | { key: null; source: 'ambiguous' | 'none' };

const FORMS: [string, RegExp][] = [
  ['tablet', /\btab(?:let)?s?\b|\bcaplets?\b/], ['capsule', /\bcap(?:sule)?s?\b/],
  ['liquid', /\b(?:solution|suspension|liquid|syrup|elixir|susp|soln|syr)\b|\boral sol\b/], ['cream', /\b(?:cream|crm)\b/],
  ['ointment', /\b(?:ointment|oint)\b/], ['gel', /\bgel\b/], ['drops', /\bdrops?\b/], ['inhaler', /\b(?:inhaler|inh|evohaler|accuhaler|turbohaler)\b/],
  ['injection', /\b(?:injection|inj)\b/], ['patch', /\bpatch(?:es)?\b/], ['sachet', /\bsachets?\b/], ['spray', /\bspray\b/],
  ['suppository', /\b(?:suppositor(?:y|ies)|supps?)\b/],
];
const RELEASE = /modified[- ]release|prolonged[- ]release|\bm\/?r\b|\bxl\b|\bsr\b|\bpr\b|\bla\b|\bcr\b|\bretard\b/;
const DISPERSIBLE = /\b(?:oro)?dispersible\b|\bdisp\b|\bodt?\b|\borodisp/;
const EFFERVESCENT = /\beffervescent\b|\beff\b/;
const GASTRO = /gastro[- ]resistant|\be\/?c\b/;
function forms(text: string): Set<string> { return new Set(FORMS.filter(([, re]) => re.test(text)).map(([f]) => f)); }
/** Release, dispersible and effervescent forms are different products; a line saying "EC" needs a gastro-resistant product. */
export function sameForm(lineDescription: string, productName: string): boolean {
  const a = lineDescription.toLowerCase(), b = productName.toLowerCase();
  const fa = forms(a), fb = forms(b);
  if (fa.size && fb.size && ![...fa].some((f) => fb.has(f))) return false;
  for (const re of [RELEASE, DISPERSIBLE, EFFERVESCENT]) if (re.test(a) !== re.test(b)) return false;
  if (GASTRO.test(a) && !GASTRO.test(b)) return false;
  return true;
}
/** Phoenix prints the PIP code as "1234-567". */
export function pipFromSku(sku: string | null): string | null {
  const m = sku?.trim().match(/^(\d{4})-(\d{3})$/);
  return m ? m[1]! + m[2]! : null;
}
/** "1000mg" and "1g" are one strength; the scan matcher compares strengths as written. */
const grams = (text: string) => text.replace(/(\d+(?:\.\d+)?)\s*mg\b/gi, (m, n: string) => (Number(n) >= 1000 && Number(n) % 100 === 0 ? `${Number(n) / 1000}g` : m));
const moleculeOf = (name: string) => name.toLowerCase().match(/[a-z][a-z-]{2,}/)?.[0] ?? null;

/**
 * Link each invoice line to at most one PMR product.
 * gtinToKey: pack GTIN -> PMR product key (VMPP name), from dmd_packs.
 * mappedGtin: "supplier|supplier_sku" -> GTIN, from the pharmacy's verified barcodes.
 */
export function linkInvoiceLines(products: PmrProduct[], lines: PurchaseLine[], gtinToKey: Map<string, string>, mappedGtin: Map<string, string>): Map<string, LineLink> {
  const byKey = new Map(products.map((p) => [p.key, p]));
  const byPip = new Map<string, string[]>();
  for (const p of products) for (const pip of p.pips) byPip.set(pip, [...(byPip.get(pip) ?? []), p.key]);
  const byPrefix = new Map<string, PmrProduct[]>();
  for (const p of products) { const m = moleculeOf(p.name); if (m) byPrefix.set(m.slice(0, 4), [...(byPrefix.get(m.slice(0, 4)) ?? []), p]); }
  const out = new Map<string, LineLink>();
  for (const line of lines) {
    // A barcode identifies the pack exactly: if it is not a PMR product, no description guess is made.
    const gtin = line.gtin ?? mappedGtin.get(`${line.supplier}|${line.supplier_sku ?? ''}`) ?? null;
    if (gtin) {
      const key = gtinToKey.get(gtin);
      if (key && byKey.has(key)) { out.set(line.id, { key, source: line.gtin ? 'gtin' : 'mapping' }); continue; }
      if (key) { out.set(line.id, { key: null, source: 'none' }); continue; }
    }
    const pip = pipFromSku(line.supplier_sku);
    const pipKeys = pip ? [...new Set(byPip.get(pip) ?? [])] : [];
    if (pipKeys.length === 1) { out.set(line.id, { key: pipKeys[0]!, source: 'pip' }); continue; }
    const desc = line.description.toLowerCase();
    const candidates = new Set<PmrProduct>();
    for (const w of desc.match(/[a-z][a-z-]{2,}/g) ?? []) for (const p of byPrefix.get(w.slice(0, 4)) ?? []) candidates.add(p);
    const asWritten = { ...line, description: grams(line.description) };
    const fits = [...candidates].filter((p) => sameForm(line.description, p.name)
      && matchScan([asWritten], [], [{ name: p.name, generic_name: grams(p.name), pack_qty: p.packSize }]).source === 'dmd');
    const keys = [...new Set(fits.map((p) => p.key))];
    out.set(line.id, keys.length === 1 ? { key: keys[0]!, source: 'description' } : { key: null, source: keys.length ? 'ambiguous' : 'none' });
  }
  return out;
}
