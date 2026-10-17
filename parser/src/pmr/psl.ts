/**
 * Positive Solutions (PSL) Pharmacy Manager report exports (xlsx).
 *
 * Three reports are read, each a single sheet with one header row:
 *
 *   Product Usage    Date | DrugName | Quantity | Pack Size | Packs Used | Tariff Price | Total Value | Spoke
 *                    One row per product per month per site. Quantity is units; Packs Used is packs.
 *   Stock Value      Drug Name | Quantity | English Tariff | Total | Status
 *                    Rows sit under "Location: BDRowa (Tariff Total: £…)" headings; Quantity is packs.
 *                    The last rows are SUBTOTAL formulas.
 *   Items Processed  Script Reference | PIP Code | Message Type | Item Description
 *                    One row per dispensed item, under "Processed Date:" and "Spoke Name:" headings.
 *                    Only the PIP code and description are read: the script reference identifies a
 *                    prescription and is never read or stored.
 *
 * Columns are found by header name, and any column not listed above is ignored, so an export
 * with extra (for example patient) columns cannot carry them into Reckon.
 */
import { readFirstSheet, type Cell } from '../xlsx';
import { productKey } from './product-key';
import type { ParsedPmr, PmrDispensingRow, PmrPipRow, PmrReport, PmrStockRow } from '../types/index';

const COLUMNS: Record<PmrReport, Record<string, string>> = {
  product_usage: { date: 'date', drugname: 'description', quantity: 'quantity', packsize: 'packSize', packsused: 'packs', tariffprice: 'tariff', totalvalue: 'value', spoke: 'site' },
  stock_value: { drugname: 'description', quantity: 'quantity', englishtariff: 'tariff', total: 'value', status: 'status' },
  items_processed: { pipcode: 'pip', itemdescription: 'description' },
};
// Present in the export but deliberately never read.
const NEVER_READ = new Set(['scriptreference', 'messagetype']);
const norm = (c: Cell) => String(c ?? '').toLowerCase().replace(/[^a-z]/g, '');
const str = (c: Cell) => (c === null || c === undefined ? '' : String(c).replace(/\s+/g, ' ').trim());
function num(c: Cell): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  const s = str(c).replace(/[£,\s]/g, '');
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

export interface PmrDetection { report: PmrReport; headerRow: number; columns: Record<string, number>; ignored: string[] }

/** Find the header row (within the first ten rows) and decide which PSL report this is. */
export function detectPslReport(rows: Cell[][]): PmrDetection | null {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const headers = (rows[r] ?? []).map(norm);
    const has = (h: string) => headers.includes(h);
    let report: PmrReport | null = null;
    if (has('pipcode') && has('itemdescription')) report = 'items_processed';
    else if (has('drugname') && (has('packsused') || (has('date') && has('packsize')))) report = 'product_usage';
    else if (has('drugname') && has('quantity') && (has('englishtariff') || rows.slice(r + 1, r + 6).some((row) => /^location:/i.test(str(row[0]))))) report = 'stock_value';
    if (!report) continue;
    const columns: Record<string, number> = {};
    const ignored: string[] = [];
    headers.forEach((h, i) => {
      const field = COLUMNS[report!][h];
      if (field && columns[field] === undefined) columns[field] = i;
      else if (h && !NEVER_READ.has(h)) ignored.push(str(rows[r]![i]));
    });
    return { report, headerRow: r, columns, ignored };
  }
  return null;
}

/** "Stock Value - 14-10-26 15-16-49.xlsx" (PSL's dd-mm-yy hh-mm-ss) -> 2026-10-14. */
export function dateFromFileName(name: string | undefined): string | null {
  const m = name?.match(/(\d{2})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const iso = `20${m[3]}-${m[2]}-${m[1]}`;
  return validIso(iso) ? iso : null;
}
function validIso(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A usage-report date cell -> YYYY-MM. Cells are Excel serial dates; text forms are accepted too. */
export function monthOf(c: Cell): string | null {
  if (typeof c === 'number') {
    if (c < 20000 || c > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(c) * 86_400_000).toISOString().slice(0, 7);
  }
  const s = str(c).toLowerCase();
  let m = s.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}` : null;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[3]}-${m[2]!.padStart(2, '0')}` : null;
  m = s.match(/^([a-z]{3})[a-z]*[\s-]+(\d{2}|\d{4})$/);
  if (m && MONTHS.includes(m[1]!)) return `${m[2]!.length === 2 ? `20${m[2]}` : m[2]}-${String(MONTHS.indexOf(m[1]!) + 1).padStart(2, '0')}`;
  return null;
}
function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}
/** "P0472068" -> "0472068". PSL PIP codes are seven digits. */
export function cleanPip(c: Cell): string | null {
  const s = str(c).toUpperCase().replace(/^P/, '').replace(/[\s-]/g, '');
  if (!/^\d{6,7}$/.test(s)) return null;
  return s.padStart(7, '0');
}

export function parsePslXlsx(buffer: Buffer, fileName?: string): ParsedPmr {
  const rows = readFirstSheet(buffer);
  const detection = detectPslReport(rows);
  if (!detection) throw new Error('Not a recognised Positive Solutions export (Product Usage, Stock Value or Items Processed).');
  const { report, headerRow, columns, ignored } = detection;
  const col = (row: Cell[], field: string) => (columns[field] === undefined ? null : row[columns[field]!] ?? null);
  const result: ParsedPmr = {
    kind: 'pmr', system: 'psl', report, periodStart: null, periodEnd: null, snapshotDate: null, sites: [],
    quantityBasis: null, dispensing: [], stock: [], pips: [], sourceRows: 0, skippedRows: 0, ignoredColumns: ignored, warnings: [],
  };
  const body = rows.slice(headerRow + 1);
  const sites = new Set<string>();

  if (report === 'product_usage') {
    const byKey = new Map<string, PmrDispensingRow>();
    result.quantityBasis = columns.packs !== undefined ? 'packs' : 'units';
    let disagree = 0, noPack = 0, badDate = 0;
    for (const row of body) {
      const description = str(col(row, 'description'));
      if (!description) { result.skippedRows++; continue; }
      const month = monthOf(col(row, 'date'));
      if (!month) { badDate++; result.skippedRows++; continue; }
      const packSize = num(col(row, 'packSize')) ?? productKey(description).packSize;
      const quantity = num(col(row, 'quantity'));
      let packs = num(col(row, 'packs'));
      if (packs === null) {
        // Units only: convert using the pack size, or the row cannot be counted in packs.
        if (quantity === null || !packSize) { noPack++; result.skippedRows++; continue; }
        packs = quantity / packSize;
      }
      const units = packSize ? packs * packSize : quantity;
      if (quantity !== null && packSize && columns.packs !== undefined && Math.abs(quantity - packs * packSize) > 0.01) disagree++;
      const site = str(col(row, 'site'));
      if (site) sites.add(site);
      result.sourceRows++;
      const key = `${site}\u0000${month}\u0000${description}`;
      const prior = byKey.get(key);
      const value = num(col(row, 'value'));
      if (prior) {
        prior.packs += packs; prior.units = prior.units === null || units === null ? null : prior.units + units;
        prior.value = prior.value === null || value === null ? null : prior.value + value;
      } else byKey.set(key, { description, packSize, month, packs, units, value, site });
    }
    result.dispensing = [...byKey.values()].map((d) => ({ ...d, packs: round(d.packs, 4), units: d.units === null ? null : round(d.units, 3), value: d.value === null ? null : round(d.value, 2) }));
    const months = [...new Set(result.dispensing.map((d) => d.month))].sort();
    if (months.length) { result.periodStart = `${months[0]}-01`; result.periodEnd = lastDay(months[months.length - 1]!); }
    if (badDate) result.warnings.push(`${badDate} rows had no readable month and were skipped.`);
    if (noPack) result.warnings.push(`${noPack} rows had no pack size, so units could not be converted to packs; skipped.`);
    if (disagree) result.warnings.push(`${disagree} rows state a quantity that is not packs used × pack size; packs used was kept.`);
  } else if (report === 'stock_value') {
    let location = '';
    for (const row of body) {
      const first = str(row[columns.description!] ?? row[0] ?? null);
      const heading = first.match(/^location:\s*(.*?)\s*(?:\(.*)?$/i);
      if (heading) { location = heading[1] || 'Unknown'; result.skippedRows++; continue; }
      const quantity = num(col(row, 'quantity'));
      if (!first || quantity === null) { result.skippedRows++; continue; }
      result.sourceRows++;
      result.stock.push({ description: first, packSize: productKey(first).packSize, location: location || 'Unknown', quantity, tariff: num(col(row, 'tariff')), value: num(col(row, 'value')), status: str(col(row, 'status')) });
    }
    result.snapshotDate = dateFromFileName(fileName);
    if (!result.snapshotDate) result.warnings.push('The file name does not carry the report date; the upload date is used.');
  } else {
    const byDescription = new Map<string, PmrPipRow>();
    const dates: string[] = [];
    let missing = 0, conflicting = 0;
    for (const row of body) {
      const first = str(row[0] ?? null);
      const meta = first.match(/^(processed date|spoke name):\s*(.*)$/i);
      if (meta && !str(col(row, 'description'))) {
        if (/^processed/i.test(meta[1]!)) {
          for (const d of meta[2]!.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)) if (validIso(`${d[3]}-${d[2]}-${d[1]}`)) dates.push(`${d[3]}-${d[2]}-${d[1]}`);
        } else {
          const site = meta[2]!.replace(/\s*\(.*$/, '').trim();
          if (site) sites.add(site);
        }
        result.skippedRows++; continue;
      }
      const description = str(col(row, 'description'));
      if (!description) { result.skippedRows++; continue; }
      result.sourceRows++;
      const pip = cleanPip(col(row, 'pip'));
      if (!pip) { missing++; continue; }
      const prior = byDescription.get(description);
      if (prior && prior.pip !== pip) conflicting++;
      else if (!prior) byDescription.set(description, { description, pip });
    }
    result.pips = [...byDescription.values()];
    dates.sort();
    result.periodStart = dates[0] ?? null; result.periodEnd = dates[dates.length - 1] ?? null;
    if (missing) result.warnings.push(`${missing} items had no PIP code.`);
    if (conflicting) result.warnings.push(`${conflicting} items gave a second PIP code for a product; the first was kept.`);
  }
  result.sites = [...sites].sort();
  if (ignored.length) result.warnings.push(`Columns not read: ${ignored.join(', ')}.`);
  return result;
}
