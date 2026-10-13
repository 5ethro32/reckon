/** Pack identifiers only: do not infer a medicine from its name or a partial barcode. */
function checkGtin(candidate: string): string {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(candidate)) throw new Error('Scan or enter a valid GTIN barcode.');
  const digits = candidate.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((total, digit, i) => total + digit * (i % 2 === 0 ? 3 : 1), 0);
  if ((10 - sum % 10) % 10 !== check) throw new Error('Barcode check digit is invalid.');
  return candidate.padStart(14, '0');
}
export type PackBarcode = { gtin: string; batch?: string; expiry?: string; serial?: string };
const GS = '\x1d';
// Handheld scanners often cannot type the invisible GS1 separator (ASCII 29). Most can be
// configured to send a substitute instead; accept the common ones. None of these characters
// is allowed inside a GS1 batch or serial number, so treating them as separators is safe.
const GS_SUBSTITUTES = /<GS>|\{GS\}|\[GS\]|\^\]|[|~^]/g;
const SUPPORTED = ['01', '10', '17', '21'] as const;
const FIXED: Record<string, number> = { '01': 14, '17': 6 };
// GS1 AI encodable character set 82, max 20 characters for batch (10) and serial (21).
const VARIABLE_OK = /^[!"%&'()*+,\-./0-9:;<=>?A-Z_a-z]{1,20}$/;
type Fields = Record<string, string>;
function validExpiry(yymmdd: string): boolean {
  const year = 2000 + Number(yymmdd.slice(0, 2)), month = Number(yymmdd.slice(2, 4)), day = Number(yymmdd.slice(4, 6));
  if (month < 1 || month > 12) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
/** Element strings with separators (or parentheses) have one reading. */
function parseDelimited(value: string, human: boolean): Fields {
  const values: Fields = {};
  while (value) {
    value = value.replace(/^\x1d+/, '');
    if (!value) break;
    const h = human ? value.match(/^\((\d{2})\)/) : null;
    if (human && !h) throw new Error('Invalid GS1 field. Rescan the pack.');
    const ai = h?.[1] ?? value.slice(0, 2);
    if (!(SUPPORTED as readonly string[]).includes(ai)) throw new Error('Unsupported GS1 field. Enter the pack GTIN directly.');
    if (values[ai] !== undefined) throw new Error('Repeated GS1 field. Rescan the pack.');
    value = value.slice(h ? 4 : 2);
    const fixed = FIXED[ai] ?? 0;
    let content: string;
    if (fixed) { content = value.slice(0, fixed); value = value.slice(fixed); }
    else { const end = value.search(human ? /\(\d{2}\)|\x1d/ : /\x1d/); content = end < 0 ? value : value.slice(0, end); value = end < 0 ? '' : value.slice(end); }
    if (fixed ? !new RegExp(`^\\d{${fixed}}$`).test(content) : !VARIABLE_OK.test(content)) throw new Error('Invalid GS1 field. Rescan the pack.');
    values[ai] = content;
  }
  return values;
}
/**
 * Without separators a batch or serial has no marked end, so "10AB1221XYZ" could be batch
 * AB12 + serial XYZ or batch AB1221XYZ. List every valid reading; never guess between them.
 */
function readings(value: string, seen: Fields, out: Fields[]): void {
  if (out.length > 8) return;
  if (!value) { out.push({ ...seen }); return; }
  const ai = value.slice(0, 2);
  if (!(SUPPORTED as readonly string[]).includes(ai) || seen[ai] !== undefined) return;
  const rest = value.slice(2);
  const fixed = FIXED[ai];
  if (fixed) {
    const content = rest.slice(0, fixed);
    if (!new RegExp(`^\\d{${fixed}}$`).test(content) || (ai === '17' && !validExpiry(content))) return;
    readings(rest.slice(fixed), { ...seen, [ai]: content }, out);
    return;
  }
  for (let len = 1; len <= Math.min(20, rest.length); len++) {
    const content = rest.slice(0, len);
    if (!VARIABLE_OK.test(content)) break;
    readings(rest.slice(len), { ...seen, [ai]: content }, out);
  }
}
function parseUndelimited(value: string): Fields {
  const all: Fields[] = [];
  readings(value, {}, all);
  if (all.length === 0) throw new Error('Invalid GS1 field. Rescan the pack.');
  if (all.length === 1) return all[0];
  // Medicines packs under the Falsified Medicines rules carry GTIN, expiry, batch and serial.
  const complete = all.filter((r) => SUPPORTED.every((ai) => r[ai] !== undefined));
  if (complete.length === 1) return complete[0];
  throw new Error('This scanner is not sending the GS1 separator, so batch, serial and expiry cannot be told apart. Scan with the camera, or set the scanner to send a separator (for example |).');
}
export function parsePackBarcode(raw: string): PackBarcode {
  if (typeof raw !== 'string' || raw.length > 512) throw new Error('Barcode is too long or invalid.');
  const value = raw.trim().replace(/^\](d2|C1|Q3|e0)/, '').replace(GS_SUBSTITUTES, GS);
  if (/^\d{8}$|^\d{12,14}$/.test(value)) return { gtin: checkGtin(value) };
  const human = value.startsWith('(');
  const values = human || value.includes(GS) ? parseDelimited(value, human) : parseUndelimited(value);
  const result: PackBarcode = { gtin: checkGtin(values['01'] ?? '') };
  if (values['10']) result.batch = values['10'];
  if (values['21']) result.serial = values['21'];
  if (values['17']) {
    const year = 2000 + Number(values['17'].slice(0,2));
    const month = Number(values['17'].slice(2,4));
    let day = Number(values['17'].slice(4,6));
    if (month < 1 || month > 12) throw new Error('Invalid GS1 expiry month.');
    const lastDay = new Date(Date.UTC(year,month,0)).getUTCDate();
    if (day === 0) day = lastDay;
    if (day > lastDay) throw new Error('Invalid GS1 expiry day.');
    result.expiry = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  return result;
}
export function normalizeGtin(raw: string): string { return parsePackBarcode(raw).gtin; }
export function receiptState(qty: number | null, ordered: number, flags: string[]): 'pending' | 'exception' | 'complete' {
  if (qty === null) return 'pending';
  return qty === ordered && flags.length === 0 ? 'complete' : 'exception';
}
