/** Reporting period from ?from=YYYY-MM-DD&to=YYYY-MM-DD. Defaults to the last 90 days; spans are capped at two years. */
export type Period = { from: string; to: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const valid = (s: unknown): s is string => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().startsWith(s);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export function londonToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function parsePeriod(params: { from?: unknown; to?: unknown }, today = londonToday()): Period {
  const one = (v: unknown) => Array.isArray(v) ? v[0] : v;
  const to = valid(one(params.to)) ? one(params.to) as string : today;
  const fallback = iso(Date.parse(to + 'T00:00:00Z') - 89 * DAY);
  let from = valid(one(params.from)) ? one(params.from) as string : fallback;
  if (from > to) from = fallback;
  const earliest = iso(Date.parse(to + 'T00:00:00Z') - 730 * DAY);
  if (from < earliest) from = earliest;
  return { from, to };
}
export const periodQuery = (p: Period) => `from=${p.from}&to=${p.to}`;
