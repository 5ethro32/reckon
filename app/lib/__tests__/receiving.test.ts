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
