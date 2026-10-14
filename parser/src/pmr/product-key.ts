/**
 * Product key for dispensing-system descriptions.
 *
 * PMR systems name products in dm+d style: "Aciclovir 200mg tablets (Crescent Pharma Ltd) 25 tablet
 * 5 x 5 tablets". The key drops the manufacturer, the pack-split descriptor and system annotations
 * so that manufacturer variants of one pack collapse together, while the strength, formulation
 * and total pack quantity are kept: "aciclovir 200mg tablets 25 tablet".
 *
 * Virtual products ("Losartan 100mg tablets (V-Pip) [DPS=28]") carry the pack quantity as a
 * dispensed pack size annotation; the key appends it in the same "28 tablet" form, so the
 * result reads like the dm+d VMPP name and can be looked up against it.
 */
export interface ProductKey {
  /** Lower-case grouping key. */
  key: string;
  /** The same text with its original casing (VMPP-style name). */
  name: string;
  /** Units per pack when the description states it, else null. */
  packSize: number | null;
}

const FORMS = [['tablet', /\btablets?\b/i], ['capsule', /\bcapsules?\b/i], ['sachet', /\bsachets?\b/i], ['vial', /\bvials?\b/i]] as const;

export function productKey(description: string | null | undefined): ProductKey {
  if (!description) return { key: '', name: '', packSize: null };
  let s = description.trim();
  // Manufacturer in parentheses, including nested "(Flamingo Pharma (UK) Ltd)".
  for (let prev = ''; prev !== s;) { prev = s; s = s.replace(/\s*\([^()]*\)/g, ''); }
  // Unbalanced source text: "Atorvastatin 20mg tablets Ltd) 28 tablet".
  s = s.replace(/\s+(?:Ltd|Plc|Inc|Corp|Limited)\s*\)/gi, '');
  // "140D" is written "140 dose" elsewhere.
  s = s.replace(/(\d+)D\b/g, '$1 dose');
  // Dispensed pack size: [DPS=28], [DPS=500 ml].
  const dps = s.match(/\[DPS=(\d+(?:\.\d+)?)(\s*ml)?\]/i);
  let packSize: number | null = dps ? Number(dps[1]) : null;
  const form = FORMS.find(([, re]) => re.test(s))?.[0] ?? null;
  s = s.replace(/\s*\[[^\]]*\]/g, '');
  // PSL's film-coated marker on virtual products; dm+d names do not carry it.
  s = s.replace(/\s+F\/C\b/g, '');
  const trailingCount = /\s+\d+\s+(tablets?|capsules?|sachets?|vials?)$/i.test(s);
  if (packSize === null) {
    // "28 tablet"; numbers below 7 are more often strengths or doses than pack counts.
    for (const m of s.matchAll(/\b(\d+)\s*(tablets?|capsules?|sachets?|vials?)\b/gi)) {
      if (Number(m[1]) >= 7) { packSize = Number(m[1]); break; }
    }
  } else if (!trailingCount && form) {
    s = `${s} ${packSize} ${form}`;
  } else if (dps?.[2] && !/\s\d+(?:\.\d+)?\s*ml$/i.test(s)) {
    s = `${s} ${packSize} ml`;
  }
  // Trailing pack split: "2 x 14 tablets", "4 x 7 capsules", "2 x 0.1ml unit doses", "2x14".
  s = s.replace(/\s+\d+\s*x\s*\d+(?:\.\d+)?\s*[a-z]*(?:\s+[a-z]+)*\s*$/i, '');
  s = s.replace(/\s+/g, ' ').trim().replace(/\b(tablets?|capsules?)\s+(tablets?|capsules?)\b/gi, '$1');
  // Other packs end with their quantity and unit, as dm+d writes them: "500 gram", "10 ml", "50 strip".
  if (packSize === null) {
    const tail = s.match(/\s(\d+(?:\.\d+)?)\s+(?:ml|gram|strip|device|needle|patch|dose|unit dose|pessary|suppository|ampoule|pre-filled disposable injection|lancet|bag|pack)$/i);
    if (tail) packSize = Number(tail[1]);
  }
  // Upper-case units ("100MG") read as dm+d writes them.
  s = s.replace(/(\d)(MG|MCG|ML|G)\b/g, (_, d: string, u: string) => d + u.toLowerCase());
  return { key: s.toLowerCase(), name: s, packSize };
}
