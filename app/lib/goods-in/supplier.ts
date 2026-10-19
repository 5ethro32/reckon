/** Wholesaler names and colours. Every wholesaler gets its own tone; none is emphasised. */
const NAMES: Record<string, string> = {
  aah: 'AAH', aver: 'Aver', phoenix: 'Phoenix', alliance: 'Alliance',
  ethigen: 'Ethigen', numark: 'Numark', sigma: 'Sigma', lexon: 'Lexon',
};
const TONED = new Set(['aah', 'aver', 'phoenix', 'alliance']);
const MARKS: Record<string, string> = { aah: 'AAH', aver: 'AV', phoenix: 'PH', alliance: 'AL', ethigen: 'ET', numark: 'NU', sigma: 'SI', lexon: 'LX' };

/** A wholesaler's short mark for its badge: "AAH", "AV", "PH"; otherwise its first two letters. */
export function supplierMark(supplier: string): string {
  const key = supplier.trim().toLowerCase();
  return MARKS[key] ?? (supplier.trim().replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() || '?');
}

export function supplierName(supplier: string): string {
  const key = supplier.trim().toLowerCase();
  return NAMES[key] ?? supplier.trim().replace(/\b\w/g, c => c.toUpperCase());
}

/** CSS colour for a wholesaler; anything without its own tone shares the neutral one. */
export function supplierTone(supplier: string): string {
  const key = supplier.trim().toLowerCase();
  return TONED.has(key) ? `var(--gi-tone-${key})` : 'var(--gi-tone-other)';
}

export const money = (n: number, whole = false) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(n);

/** "14 Oct": three-letter months, London time. */
export function shortDate(value: string | Date): string {
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T12:00:00Z') : new Date(value);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).replace('Sept', 'Sep');
}

/** Whole days between two instants, never negative. */
export function daysSince(value: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(value)) / 86400000));
}

/** First day of the current month in London, as YYYY-MM-DD, and its UTC instant. */
export function monthStart(now = new Date()): { date: string; instant: string; label: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const date = `${y}-${m}-01`;
  // Midnight London on the 1st: BST (UTC+1) from the last Sunday of March to the last Sunday of October.
  const probe = new Date(`${date}T12:00:00Z`);
  const londonNoon = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).format(probe));
  const offset = londonNoon - 12;
  const instant = new Date(Date.UTC(Number(y), Number(m) - 1, 1, -offset)).toISOString();
  const label = probe.toLocaleDateString('en-GB', { month: 'long', timeZone: 'Europe/London' });
  return { date, instant, label };
}
