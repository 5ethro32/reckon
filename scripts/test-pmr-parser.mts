// PSL Pharmacy Manager exports. The fixtures keep the real exports' xlsx structure (shared strings,
// outline heading rows, SUBTOTAL formula rows, serial dates) with a few public dm+d products and
// synthetic site names and script references.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { parsePslXlsx, cleanPip, monthOf, dateFromFileName } from '../parser/src/pmr/psl.ts';
import { productKey } from '../parser/src/pmr/product-key.ts';
import { readFirstSheet, looksLikeXlsx } from '../parser/src/xlsx.ts';

const dir = 'parser/fixtures/psl/';
const load = (name: string) => parsePslXlsx(readFileSync(dir + name), name);

const usage = load('sample-product-usage-30-09-26 23-05-28.xlsx');
assert.equal(usage.report, 'product_usage'); assert.equal(usage.quantityBasis, 'packs');
assert.deepEqual([usage.periodStart, usage.periodEnd], ['2026-08-01', '2026-09-30']);
assert.deepEqual(usage.sites, ['Branch A', 'Branch B']);
assert.equal(usage.sourceRows, 7); assert.equal(usage.dispensing.length, 7); assert.deepEqual(usage.warnings, []);
const aml = usage.dispensing.find((d) => d.month === '2026-09' && d.site === 'Branch A' && d.description.includes('Accord'))!;
assert.deepEqual([aml.packs, aml.units, aml.packSize, aml.value], [12, 336, 28, 10.56]);
assert.equal(usage.dispensing.find((d) => d.description.includes('eye drops'))!.units, 70);

const stock = load('sample-stock-value-14-10-26 15-16-49.xlsx');
assert.equal(stock.report, 'stock_value'); assert.equal(stock.snapshotDate, '2026-10-14');
assert.deepEqual(stock.stock.map((s) => [s.location, s.quantity]), [['BDRowa', 9], ['BDRowa', 4], ['BDRowa', 5], ['Manual', 6], ['On Order', 2]]);
assert.equal(stock.skippedRows, 7, 'three location headings and four formula rows');
assert.deepEqual(stock.stock.map((s) => s.packSize), [28, 28, 56, 10, 28]);
assert.equal(stock.stock[0]!.tariff, 0.88); assert.equal(stock.stock[0]!.value, 7.92);

const items = load('sample-items-processed-30-09-26 23-04-55.xlsx');
assert.equal(items.report, 'items_processed'); assert.deepEqual(items.sites, ['Branch A', 'Branch B']);
assert.deepEqual([items.periodStart, items.periodEnd], ['2026-09-30', '2026-09-30']);
assert.deepEqual(items.pips, [{ description: 'Amlodipine 5mg tablets (Amarox Ltd) 28 tablet 2 x 14 tablets', pip: '1281252' }, { description: 'Losartan 100MG tablets (Medreich) [DPS=28]', pip: '1233311' }]);
assert.ok(items.warnings.some((w) => /1 items had no PIP/.test(w)));
// Prescription references are never carried into the result.
assert.ok(!/90000[123]/.test(JSON.stringify(items)), 'script reference leaked');

// An export with extra columns: they are listed as not read, and their values never appear.
function xlsx(rows: (string | number | null)[][]): Buffer {
  const cell = (v: string | number | null, r: number, c: number) => v === null ? '' : typeof v === 'number' ? `<c r="${String.fromCharCode(65 + c)}${r}"><v>${v}</v></c>` : `<c r="${String.fromCharCode(65 + c)}${r}" t="inlineStr"><is><t>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></is></c>`;
  const sheet = `<worksheet><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((v, c) => cell(v, i + 1, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files: [string, string][] = [['xl/workbook.xml', '<workbook><sheets><sheet name="Sheet" sheetId="1" r:id="rId1"/></sheets></workbook>'], ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'], ['xl/worksheets/sheet1.xml', sheet]];
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, text] of files) {
    const data = deflateRawSync(Buffer.from(text)), n = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(text.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(text.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(h, n, data); central.push(c, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}
const extra = parsePslXlsx(xlsx([['Date', 'DrugName', 'Patient Name', 'NHS Number', 'Pack Size', 'Packs Used'], ['2026-08-01', 'Synthetic 10mg tablets 28 tablet', 'A Person', '9990001112', 28, 2]]));
assert.deepEqual(extra.ignoredColumns, ['Patient Name', 'NHS Number']);
assert.ok(!/A Person|9990001112/.test(JSON.stringify({ ...extra, ignoredColumns: [] })));
// Units only (no Packs Used column): converted with the pack size; rows without one are skipped.
const unitsOnly = parsePslXlsx(xlsx([['Date', 'DrugName', 'Quantity', 'Pack Size'], ['01/09/2026', 'Synthetic 10mg tablets 28 tablet', 42, 28], ['01/09/2026', 'Synthetic liquid', 100, null]]));
assert.equal(unitsOnly.quantityBasis, 'units'); assert.deepEqual(unitsOnly.dispensing.map((d) => [d.month, d.packs, d.units]), [['2026-09', 1.5, 42]]);
assert.ok(unitsOnly.warnings.some((w) => /no pack size/.test(w)));
assert.throws(() => parsePslXlsx(xlsx([['Invoice', 'Total'], ['1', 2]])), /Not a recognised Positive Solutions export/);
assert.throws(() => readFirstSheet(Buffer.from('%PDF-1.4 not a zip')), /Not an xlsx/);
assert.equal(looksLikeXlsx(readFileSync(dir + 'sample-stock-value-14-10-26 15-16-49.xlsx')), true);
assert.equal(looksLikeXlsx(Buffer.from('%PDF-1.4')), false);

assert.equal(cleanPip('P0472068'), '0472068'); assert.equal(cleanPip('1111-111'), '1111111'); assert.equal(cleanPip(''), null); assert.equal(cleanPip('PABC'), null);
assert.equal(monthOf(46235), '2026-08'); assert.equal(monthOf('August 2026'), '2026-08'); assert.equal(monthOf('13/13/2026'), null);
assert.equal(dateFromFileName('Stock_Value_-_30-09-26_22-01-54[89855].xlsx'), '2026-09-30'); assert.equal(dateFromFileName('stock.xlsx'), null);

// Product key: manufacturer variants collapse, strength, form and pack quantity stay.
const key = (s: string) => productKey(s).key;
assert.equal(key('Metformin 500mg tablets (Sandoz Ltd) 28 tablet 2 x 14 tablets'), 'metformin 500mg tablets 28 tablet');
assert.equal(key('Cetirizine 10mg tablets (Flamingo Pharma (UK) Ltd) 30 tablet'), key('Cetirizine 10mg tablets (Crescent Pharma Ltd) 30 tablet 2 x 15 tablets'));
assert.equal(key('Irbesartan 300mg tablets (V-Pip) [DPS=28]'), key('Irbesartan 300mg tablets (Crescent Pharma Ltd) 28 tablet 2 x 14 tablets'));
assert.equal(key('Bisoprolol 10mg tablets (Tillomed) F/C [DPS=28]'), 'bisoprolol 10mg tablets 28 tablet');
assert.equal(productKey('Losartan 100MG tablets (Medreich) [DPS=28]').name, 'Losartan 100mg tablets 28 tablet');
assert.equal(productKey('Lactulose 3.1-3.7g/5ml oral solution (V-Pip) [DPS=500 ml]').name, 'Lactulose 3.1-3.7g/5ml oral solution 500 ml');
assert.equal(key('Metformin 500mg modified-release tablets (Strides Pharma UK Ltd) 56 tablet'), 'metformin 500mg modified-release tablets 56 tablet');
assert.equal(key('Atorvastatin 20mg tablets Ltd) 28 tablet'), 'atorvastatin 20mg tablets 28 tablet');
assert.equal(key('Imigran 10mg nasal spray (GlaxoSmithKline UK Ltd) 2 unit dose 2 x 0.1ml unit doses'), 'imigran 10mg nasal spray 2 unit dose');
assert.equal(productKey('Zerobase 11% cream (Thornton & Ross Ltd) 500 gram').packSize, 500);
assert.equal(productKey('Sertraline 50mg tablets 7 tablet').packSize, 7);
console.log('PSL parser tests passed: Product Usage (months, sites, packs and units), Stock Value (locations, formula rows, report date), Items Processed (PIP codes, prescription references dropped), unread columns, units-only exports, product keys.');
