import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, pmrProducts } from '../pmr-report';
import { dmdLookupNames, indexDmd, matchToDmd, pmrProductKey, linkInvoiceLines, sameForm, pipFromSku, type PmrProduct } from '../pmr-match';

const dmd = indexDmd([
  { ampp_id: '1001', name: 'Amlodipine 5mg tablets (Accord-UK Ltd) 28 tablet 2 x 14 tablets', generic_name: 'Amlodipine 5mg tablets 28 tablet', pack_qty: 28 },
  { ampp_id: '1002', name: 'Amlodipine 5mg tablets (Amarox Ltd) 28 tablet 2 x 14 tablets', generic_name: 'Amlodipine 5mg tablets 28 tablet', pack_qty: 28 },
  { ampp_id: '1003', name: 'Losartan 100mg tablets (Teva UK Ltd) 28 tablet', generic_name: 'Losartan 100mg tablets 28 tablet', pack_qty: 28 },
  { ampp_id: '1004', name: 'Istin 5mg tablets (Viatris UK Healthcare Ltd) 28 tablet', generic_name: 'Amlodipine 5mg tablets 28 tablet', pack_qty: 28 },
]);

test('PMR descriptions match dm+d by AMPP name, then by VMPP name', () => {
  assert.deepEqual(matchToDmd('AMLODIPINE 5mg tablets (Accord-UK Ltd) 28 tablet 2 x 14 tablets', 28, dmd), { source: 'ampp', ampp_id: '1001', dmd_name: 'Amlodipine 5mg tablets 28 tablet', pack_qty: 28 });
  // A virtual product: no AMPP of that name, but its VMPP form exists.
  assert.deepEqual(matchToDmd('Losartan 100MG tablets (Medreich) [DPS=28]', 28, dmd), { source: 'vmpp', ampp_id: null, dmd_name: 'Losartan 100mg tablets 28 tablet', pack_qty: 28 });
  assert.deepEqual(dmdLookupNames('Losartan 100MG tablets (Medreich) [DPS=28]'), ['Losartan 100MG tablets (Medreich) [DPS=28]', 'Losartan 100mg tablets 28 tablet']);
  // Brands and manufacturers of one pack share a product key.
  const k = (d: string) => pmrProductKey(d, matchToDmd(d, 28, dmd));
  assert.equal(k('Istin 5mg tablets (Viatris UK Healthcare Ltd) 28 tablet'), k('Amlodipine 5mg tablets (Amarox Ltd) 28 tablet 2 x 14 tablets'));
});
test('dm+d matches are never guessed', () => {
  assert.equal(matchToDmd('Amlodipine 5mg tablets (Accord-UK Ltd) 28 tablet 2 x 14 tablets', 56, dmd), null, 'pack quantity disagrees');
  assert.equal(matchToDmd('Amlodipine 10mg tablets (Accord-UK Ltd) 28 tablet', 28, dmd), null);
  assert.equal(matchToDmd('Hylo Night eye ointment (Scope Ophthalmics Ltd) 5 gram', null, dmd), null);
  assert.equal(pmrProductKey('Hylo Night eye ointment (Scope Ophthalmics Ltd) 5 gram', null), 'hylo night eye ointment 5 gram');
});

const products: PmrProduct[] = [
  { key: 'amlodipine 5mg tablets 28 tablet', name: 'Amlodipine 5mg tablets 28 tablet', packSize: 28, pips: ['1281252'] },
  { key: 'metformin 500mg tablets 28 tablet', name: 'Metformin 500mg tablets 28 tablet', packSize: 28, pips: [] },
  { key: 'metformin 500mg modified-release tablets 56 tablet', name: 'Metformin 500mg modified-release tablets 56 tablet', packSize: 56, pips: [] },
  { key: 'metformin 1g modified-release tablets 56 tablet', name: 'Metformin 1g modified-release tablets 56 tablet', packSize: 56, pips: [] },
  { key: 'paracetamol 500mg tablets 100 tablet', name: 'Paracetamol 500mg tablets 100 tablet', packSize: 100, pips: [] },
  { key: 'paracetamol 500mg capsules 100 capsule', name: 'Paracetamol 500mg capsules 100 capsule', packSize: 100, pips: [] },
  { key: 'simvastatin 20mg tablets 28 tablet', name: 'Simvastatin 20mg tablets 28 tablet', packSize: 28, pips: [] },
  { key: 'simvastatin 20mg tablets 84 tablet', name: 'Simvastatin 20mg tablets 84 tablet', packSize: 84, pips: [] },
];
const line = (id: string, description: string, pack_size: string | null, supplier = 'aver', supplier_sku: string | null = null, gtin: string | null = null) => ({ id, description, pack_size, supplier, supplier_sku, gtin });

test('invoice lines link by GTIN, verified barcode, PIP, then a unique description fit', () => {
  const lines = [
    line('g', 'AMLODIPINE TABS 5MG', '28', 'phoenix', '9999-999', '05000000000001'),
    line('m', 'Amlo 5', '28', 'aah', 'AML5'),
    line('p', 'AMLODIPINE TABLETS 5MG', '28', 'phoenix', '1281-252'),
    line('d', 'Metformin Tabs 500mg / 28', '28'),
    line('r', 'Metformin Tabs SR 500mg / 56', '56'),
    line('k', 'Metformin SR Tabs 1000mg / 56', '56'),
    line('c', 'Paracetamol Caplets 500mg / 100', '100'),
  ];
  const links = linkInvoiceLines(products, lines, new Map([['05000000000001', 'amlodipine 5mg tablets 28 tablet']]), new Map([['aah|AML5', '05000000000001']]));
  assert.deepEqual(Object.fromEntries([...links].map(([id, l]) => [id, [l.key, l.source]])), {
    g: ['amlodipine 5mg tablets 28 tablet', 'gtin'], m: ['amlodipine 5mg tablets 28 tablet', 'mapping'], p: ['amlodipine 5mg tablets 28 tablet', 'pip'],
    d: ['metformin 500mg tablets 28 tablet', 'description'], r: ['metformin 500mg modified-release tablets 56 tablet', 'description'],
    k: ['metformin 1g modified-release tablets 56 tablet', 'description'], c: ['paracetamol 500mg tablets 100 tablet', 'description'],
  });
});
test('unclear invoice lines stay unlinked', () => {
  const links = linkInvoiceLines(products, [
    line('a', 'Simvastatin Tabs 20mg', null),            // pack size unknown: 28 and 84 both fit
    line('b', 'Atorvastatin Tabs 20mg / 28', '28'),       // not a PMR product
    line('x', 'AMLODIPINE TABS 5MG', '28', 'phoenix', 'X', '05099999999999'),
  ], new Map([['05099999999999', 'amlodipine 10mg tablets 28 tablet']]), new Map());
  assert.deepEqual([...links.values()].map((l) => l.source), ['ambiguous', 'none', 'none']);
});
test('form and release checks', () => {
  assert.equal(sameForm('Metformin Tabs SR 500mg', 'Metformin 500mg tablets 28 tablet'), false);
  assert.equal(sameForm('Melatonin Tabs 2mg PR / 30', 'Melatonin 2mg modified-release tablets 30 tablet'), true);
  assert.equal(sameForm('Omeprazole Caps 20mg', 'Omeprazole 20mg gastro-resistant capsules 28 capsule'), true);
  assert.equal(sameForm('Aspirin e/c Tabs 75mg', 'Aspirin 75mg dispersible tablets 28 tablet'), false);
  assert.equal(sameForm('Olanzapine Tabs OD 10mg', 'Olanzapine 10mg tablets 28 tablet'), false);
  assert.equal(sameForm('Ibuprofen Oral Susp 100mg/5ml', 'Ibuprofen 200mg tablets 24 tablet'), false);
  assert.equal(pipFromSku('1111-111'), '1111111'); assert.equal(pipFromSku('C-1409'), null); assert.equal(pipFromSku('1111111'), null);
});
test('report: on hand excludes stock on order; bought counts only linked lines', () => {
  const row = { product_key: 'amlodipine 5mg tablets 28 tablet', description: 'Amlodipine 5mg tablets (Accord-UK Ltd) 28 tablet 2 x 14 tablets', dmd_name: 'Amlodipine 5mg tablets 28 tablet', pack_size: 28, pip: null };
  const report = buildReport(
    [{ ...row, month: '2026-08-01', packs: 10 }, { ...row, month: '2026-09-01', packs: 12 }],
    [{ ...row, location: 'BDRowa', quantity: 9 }, { ...row, location: 'On Order', quantity: 2 }],
    [{ id: 'l1', qty: 20 }, { id: 'l2', qty: 5 }],
    new Map([['l1', { key: row.product_key, source: 'description' as const }], ['l2', { key: null, source: 'ambiguous' as const }]]),
  );
  assert.deepEqual(report.map((p) => [p.dispensed, p.dispensedTotal, p.onHand, p.onOrder, p.purchased, p.purchasedLines]), [[{ '2026-08': 10, '2026-09': 12 }, 22, 9, 2, 20, 1]]);
  assert.equal(pmrProducts([row, { ...row, pip: '1281252' }])[0]!.pips.join(), '1281252');
});
