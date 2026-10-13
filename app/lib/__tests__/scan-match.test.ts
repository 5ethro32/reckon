import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchScan, strengths } from '../scan-match';

const lines = [
  { id: 'a', description: 'VERAPAMIL TABS 160MG', pack_size: '56', supplier_sku: 'VER160' },
  { id: 'b', description: 'VERAPAMIL TABS 40MG', pack_size: '84', supplier_sku: 'VER40' },
  { id: 'c', description: 'Simvastatin 10mg Tablets', pack_size: '28', supplier_sku: 'SIM10' },
  { id: 'd', description: 'Simvastatin 10mg Tablets', pack_size: '84', supplier_sku: 'SIM10-84' },
];
const verapamil = { name: 'Verapamil 160mg tablets (Accord-UK Ltd) 56 tablet', generic_name: 'Verapamil 160mg tablets 56 tablet', pack_qty: 56 };

test('strengths normalise units', () => {
  assert.deepEqual(strengths('Salbutamol 100micrograms/dose inhaler'), ['100microgram']);
  assert.deepEqual(strengths('Lansoprazole 15 MG'), ['15mg']);
  assert.deepEqual(strengths('Co-codamol 30mg/500mg'), ['30mg', '500mg']);
});
test('a verified mapping wins over dm+d', () => {
  assert.deepEqual(matchScan(lines, ['VER40'], [verapamil]), { lineIds: ['b'], source: 'mapping' });
});
test('dm+d picks the line with the same medicine, strength and pack quantity', () => {
  assert.deepEqual(matchScan(lines, [], [verapamil]), { lineIds: ['a'], source: 'dmd' });
  const simvastatin28 = { name: 'Zocor 10mg tablets (Organon) 28 tablet', generic_name: 'Simvastatin 10mg tablets 28 tablet', pack_qty: 28 };
  assert.deepEqual(matchScan(lines, [], [simvastatin28]).lineIds, ['c']);
});
test('no match is reported rather than guessed', () => {
  const atorvastatin = { name: 'Atorvastatin 20mg tablets 28 tablet', generic_name: 'Atorvastatin 20mg tablets 28 tablet', pack_qty: 28 };
  assert.deepEqual(matchScan(lines, [], [atorvastatin]), { lineIds: [], source: 'none' });
  const noPack = [{ id: 'x', description: 'Simvastatin 10mg Tablets', pack_size: null, supplier_sku: null }, { id: 'y', description: 'Simvastatin 10mg Tablets', pack_size: null, supplier_sku: null }];
  assert.equal(matchScan(noPack, [], [{ name: 'x', generic_name: 'Simvastatin 10mg tablets 28 tablet', pack_qty: 28 }]).lineIds.length, 2);
});
test('invoice shorthand and one-letter misspellings still match', () => {
  assert.deepEqual(strengths('Co-Codamol Tabs 8/500mg / 100'), ['8mg', '500mg']);
  const inv = [
    { id: 'm', description: 'Mirtazipine Tabs 30mg / 28', pack_size: '28', supplier_sku: null },
    { id: 'c', description: 'Co-Codamol Tabs 8/500mg / 100 CD5', pack_size: '100', supplier_sku: null },
    { id: 'h', description: 'Hydralazine Tabs 25mg / 56', pack_size: '56', supplier_sku: null },
  ];
  assert.deepEqual(matchScan(inv, [], [{ name: 'x', generic_name: 'Mirtazapine 30mg tablets 28 tablet', pack_qty: 28 }]).lineIds, ['m']);
  assert.deepEqual(matchScan(inv, [], [{ name: 'x', generic_name: 'Co-codamol 8mg/500mg tablets 100 tablet', pack_qty: 100 }]).lineIds, ['c']);
  // Different medicines with similar spelling do not match.
  assert.deepEqual(matchScan(inv, [], [{ name: 'x', generic_name: 'Hydroxyzine 25mg tablets 56 tablet', pack_qty: 56 }]).lineIds, []);
});
