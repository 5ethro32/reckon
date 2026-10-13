import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGtin, parsePackBarcode, receiptState } from '../receiving';
import { parseCatalogCsv } from '../barcode-catalog';
test('GTIN variants validate check digit and normalize to 14 digits',()=>{
 assert.equal(normalizeGtin('4006381333931'),'04006381333931');
 assert.equal(normalizeGtin('96385074'),'00000096385074');
 assert.throws(()=>normalizeGtin('4006381333932'),/check digit/);
 assert.throws(()=>normalizeGtin('SKU-4006381333931'));
});
test('GS1 human and scanner payloads retain expiry, batch and serial',()=>{
 const expected={gtin:'04006381333931',batch:'ABC',expiry:'2030-02-28',serial:'UNIQUE'};
 assert.deepEqual(parsePackBarcode('(01)04006381333931(17)300200(10)ABC(21)UNIQUE'),expected);
 assert.deepEqual(parsePackBarcode(']d201040063813339311730020010ABC\x1d21UNIQUE'),expected);
 assert.throws(()=>parsePackBarcode('(01)04006381333931(17)300231'),/expiry day/);
 assert.throws(()=>parsePackBarcode('(01)04006381333931(01)04006381333931'),/Repeated/);
 assert.throws(()=>parsePackBarcode('(01)04006381333931(99)ignored'),/Unsupported/);
 assert.throws(()=>parsePackBarcode(']d2010400638133393110ABCDEFGHIJKLMNOPQRSTU'),/Invalid/);
});
test('unchecked quantities remain pending',()=>{assert.equal(receiptState(null,5,[]),'pending');assert.equal(receiptState(5,5,[]),'complete');assert.equal(receiptState(5,5,['damage']),'exception');});
const header='supplier,supplier_sku,gtin,description,pack_size,ampp_id\n';
test('authorized CSV catalog retains quoted names and validates packs and identifiers',()=>{
 assert.equal(parseCatalogCsv(header+'Aver,SKU,4006381333931,"Product, tablets",28,123456')[0].description,'Product, tablets');
 assert.throws(()=>parseCatalogCsv(header+'Aver,SKU,4006381333931,Product,,123456'),/pack_size/);
 assert.throws(()=>parseCatalogCsv(header+'Aver,SKU,4006381333932,Product,28,123456'),/check digit/);
 assert.throws(()=>parseCatalogCsv(header+'Aver,SKU,4006381333931,Product,28,not-ampp'),/AMPP/);
 assert.throws(()=>parseCatalogCsv(header+'Aver,SKU,4006381333931,Product,28,123456\nAver,OTHER,4006381333931,Other,56,123456'),/duplicate/);
});
test('scanner payloads without the GS1 separator are read only when unambiguous',()=>{
 const full={gtin:'04006381333931',batch:'AB12',expiry:'2026-12-31',serial:'XYZ123'};
 // Separator substitutes that scanners can be configured to send.
 assert.deepEqual(parsePackBarcode('010400638133393117261231' + '10AB12|21XYZ123'),full);
 assert.deepEqual(parsePackBarcode('010400638133393117261231' + '10AB12<GS>21XYZ123'),full);
 // No separator: only one reading has all four fields, so it is safe.
 assert.deepEqual(parsePackBarcode('0104006381333931172612311' + '0AB1221XYZ123'),full);
 // Serial first: the expiry is not swallowed into the serial.
 assert.deepEqual(parsePackBarcode('010400638133393121XYZ123' + '1726123110AB12'),full);
 // A batch that itself contains "21" cannot be split safely.
 assert.throws(()=>parsePackBarcode('010400638133393117261231' + '10AB21C21XYZ'),/separator/);
 // Missing serial and a "21" inside the batch: two readings, neither complete.
 assert.throws(()=>parsePackBarcode('0104006381333931' + '10AB21XY'),/separator/);
 // Plain GTIN (linear barcode) carries no batch, expiry or serial.
 assert.deepEqual(parsePackBarcode('4006381333931'),{gtin:'04006381333931'});
});
test('catalog supplier names map to the invoice supplier code',()=>{
 assert.equal(parseCatalogCsv(header+'AAH Pharmaceuticals,SKU,4006381333931,Product,28,')[0].supplier,'aah');
 assert.equal(parseCatalogCsv(header+'Aver,SKU,4006381333931,Product,28,')[0].supplier,'aver');
 assert.throws(()=>parseCatalogCsv(header+'Acme Wholesale,SKU,4006381333931,Product,28,'),/Unknown supplier/);
 assert.throws(()=>parseCatalogCsv(header+'AAH,SKU,4006381333931,A,28,\naah,SKU2,4006381333931,B,28,'),/duplicate/);
});
