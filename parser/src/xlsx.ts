/**
 * Minimal reader for the first worksheet of an .xlsx file.
 *
 * PMR exports are plain grids of strings and numbers, so this reads only what they need:
 * the zip container, shared strings and one sheet's cell values. No formulas are evaluated
 * (a formula cell yields its cached value, or null), styles are ignored and dates stay as
 * Excel serial numbers for the caller to interpret. Inflated sizes are capped so a hostile
 * upload cannot exhaust memory.
 */
import { inflateRawSync } from 'node:zlib';

export type Cell = string | number | boolean | null;

const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 200_000;

/** Reads the named entries of a zip (stored or deflated; no zip64, no encryption). */
function readZipEntries(buf: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Not an xlsx file');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not an xlsx file (no zip directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt xlsx directory');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    if (flags & 1) throw new Error('Encrypted xlsx files are not supported');
    if (compSize === 0xffffffff || size === 0xffffffff || size > MAX_ENTRY_BYTES) throw new Error('xlsx file is too large');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('Corrupt xlsx entry');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
    else throw new Error(`Unsupported xlsx compression (${method})`);
  }
  return out;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e.toLowerCase()]!)
    .replace(/_x([0-9a-f]{4})_/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}
/** Concatenated text of every <t> run (shared strings may be split into rich-text runs). */
function text(xml: string): string {
  let s = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += m[1];
  return decode(s);
}
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Rows of the first worksheet, indexed from 0, each holding cell values by column. */
export function readFirstSheet(buf: Buffer): Cell[][] {
  const entries = readZipEntries(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8');
  if (!workbook) throw new Error('Not an xlsx workbook');
  const rid = workbook.match(/<sheet\s[^>]*?r:id="([^"]+)"/)?.[1];
  const rels = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  let target = rid ? [...rels.matchAll(/<Relationship\s([^>]*)\/?>/g)].map((m) => m[1]!).find((a) => attr(a, 'Id') === rid) : undefined;
  let path = target ? attr(target, 'Target') : undefined;
  if (path) path = path.startsWith('/') ? path.slice(1) : `xl/${path}`;
  const sheet = (path && entries.get(path)) ?? entries.get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('The workbook has no worksheet');

  const shared: string[] = [];
  const sst = entries.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(text(m[1]!));

  const rows: Cell[][] = [];
  const xml = sheet.toString('utf8');
  let next = 0;
  for (const m of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(m[1]!, 'r') ?? next + 1) - 1;
    if (r >= MAX_ROWS) throw new Error('The sheet has too many rows');
    next = r + 1;
    const row: Cell[] = [];
    let col = 0;
    for (const c of (m[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = c[1]!, body = c[2] ?? '';
      const ref = attr(a, 'r');
      col = ref ? columnIndex(ref) : col;
      const t = attr(a, 't');
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value: Cell = null;
      if (t === 's') value = v === undefined ? null : shared[Number(v)] ?? null;
      else if (t === 'inlineStr') value = text(body);
      else if (t === 'str' || t === 'e') value = v === undefined ? null : decode(v);
      else if (t === 'b') value = v === '1';
      else if (v !== undefined && v !== '') value = Number(v);
      row[col] = value;
      col++;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    rows[r] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/** True when the buffer starts like a zip (xlsx) rather than a PDF. */
export function looksLikeXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
}
