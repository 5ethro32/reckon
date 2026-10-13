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
export function parsePackBarcode(raw: string): PackBarcode {
  if (typeof raw !== 'string' || raw.length > 512) throw new Error('Barcode is too long or invalid.');
  let value = raw.trim().replace(/^\](d2|C1|Q3)/, '');
  if (/^\d{8}$|^\d{12,14}$/.test(value)) return { gtin: checkGtin(value) };
  const values: Record<string, string> = {};
  while (value) {
    value = value.replace(/^\x1d/, '');
    if (!value) break;
    const human = value.match(/^\((\d{2})\)/);
    const ai = human?.[1] ?? value.slice(0, 2);
    if (!['01', '10', '17', '21'].includes(ai)) throw new Error('Unsupported GS1 field. Enter the pack GTIN directly.');
    if (values[ai] !== undefined) throw new Error('Repeated GS1 field. Rescan the pack.');
    value = value.slice(human ? 4 : 2);
    const fixed = ai === '01' ? 14 : ai === '17' ? 6 : 0;
    let content: string;
    if (fixed) { content = value.slice(0, fixed); value = value.slice(fixed); }
    else { const end = value.search(human ? /\(\d{2}\)|\x1d/ : /\x1d/); content = end < 0 ? value : value.slice(0, end); value = end < 0 ? '' : value.slice(end); }
    if (!content || (fixed && !new RegExp(`^\\d{${fixed}}$`).test(content)) || (!fixed && (content.length > 20 || /[^\x20-\x7e]/.test(content)))) throw new Error('Invalid GS1 field. Rescan the pack.');
    values[ai] = content;
  }
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
