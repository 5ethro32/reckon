// dm+d price parsing on a miniature release laid out like the NHSBSA files (structure checked against release 9.3.0).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDmd, readDmdPrices } from './import-dmd.mts';
const dir = mkdtempSync(join(tmpdir(), 'dmd-'));
mkdirSync(join(dir, 'gtin'));
writeFileSync(join(dir, 'f_lookup2_3240926.xml'), `<?xml version="1.0"?><LOOKUP><DT_PAYMENT_CATEGORY><INFO><CD>0001</CD><DESC>Part VIIIA Category A</DESC></INFO>
<INFO><CD>0011</CD><DESC>Part VIIIA Category M</DESC></INFO></DT_PAYMENT_CATEGORY><PRICE_BASIS><INFO><CD>0001</CD><DESC>NHS Indicative Price</DESC></INFO></PRICE_BASIS></LOOKUP>`);
writeFileSync(join(dir, 'f_vmpp2_3240926.xml'), `<?xml version="1.0"?><VIRTUAL_MED_PRODUCT_PACK><VMPPS>
<VMPP><VPPID>1271511000001104</VPPID><NM>Atorvastatin 20mg tablets 28 tablet</NM><VPID>1</VPID><QTYVAL>28.00</QTYVAL><QTY_UOMCD>428673006</QTY_UOMCD></VMPP>
<VMPP><VPPID>2000000000000002</VPPID><NM>Brandol &amp; Co 5mg tablets 30 tablet</NM><VPID>2</VPID><QTYVAL>30.00</QTYVAL><QTY_UOMCD>428673006</QTY_UOMCD></VMPP>
<VMPP><VPPID>3000000000000003</VPPID><INVALID>1</INVALID><NM>Withdrawn</NM><VPID>3</VPID><QTYVAL>1</QTYVAL><QTY_UOMCD>1</QTY_UOMCD></VMPP>
</VMPPS><DRUG_TARIFF_INFO><DTINFO><VPPID>1271511000001104</VPPID><PAY_CATCD>0011</PAY_CATCD><PRICE>72</PRICE><DT>2026-07-01</DT><PREVPRICE>61</PREVPRICE></DTINFO>
<DTINFO><VPPID>3000000000000003</VPPID><PAY_CATCD>0001</PAY_CATCD><PRICE>5</PRICE></DTINFO></DRUG_TARIFF_INFO><COMB_CONTENT></COMB_CONTENT></VIRTUAL_MED_PRODUCT_PACK>`);
writeFileSync(join(dir, 'f_ampp2_3240926.xml'), `<?xml version="1.0"?><ACTUAL_MEDICINAL_PROD_PACKS><AMPPS>
<AMPP><APPID>1339011000001102</APPID><NM>Lipitor 20mg tablets (Viatris) 28 tablet</NM><VPPID>1271511000001104</VPPID><APID>1</APID><LEGAL_CATCD>0003</LEGAL_CATCD></AMPP>
<AMPP><APPID>1328011000001109</APPID><NM>Atorvastatin 20mg tablets (Maker) 28 tablet</NM><VPPID>1271511000001104</VPPID><APID>2</APID><LEGAL_CATCD>0003</LEGAL_CATCD><DISCCD>0001</DISCCD></AMPP>
</AMPPS><MEDICINAL_PRODUCT_PRICE><PRICE_INFO><APPID>1339011000001102</APPID><PRICE>2464</PRICE><PRICEDT>2005-01-01</PRICEDT><PRICE_PREV>2969</PRICE_PREV><PRICE_BASISCD>0001</PRICE_BASISCD></PRICE_INFO>
<PRICE_INFO><APPID>1328011000001109</APPID><PRICE>0</PRICE><PRICEDT>2006-09-22</PRICEDT><PRICE_PREV>461</PRICE_PREV><PRICE_BASISCD>0002</PRICE_BASISCD></PRICE_INFO></MEDICINAL_PRODUCT_PRICE></ACTUAL_MEDICINAL_PROD_PACKS>`);
writeFileSync(join(dir, 'gtin', 'f_gtin2_0240926.xml'), `<?xml version="1.0"?><GTIN_DETAILS><AMPPS><AMPP><AMPPID>1339011000001102</AMPPID>
<GTINDATA><GTIN>5000000000005</GTIN><STARTDT>2010-01-01</STARTDT></GTINDATA></AMPP></AMPPS></GTIN_DETAILS>`);

const { vmpps, ampps } = readDmdPrices(dir);
assert.deepEqual(vmpps, [
  { vmpp_id: '1271511000001104', name: 'Atorvastatin 20mg tablets 28 tablet', pack_qty: 28, dt_category_code: '0011', dt_category: 'Part VIIIA Category M', dt_price_pence: 72, dt_price_date: '2026-07-01', dt_prev_price_pence: 61 },
  { vmpp_id: '2000000000000002', name: 'Brandol & Co 5mg tablets 30 tablet', pack_qty: 30, dt_category_code: null, dt_category: null, dt_price_pence: null, dt_price_date: null, dt_prev_price_pence: null },
]);
assert.deepEqual(ampps, [
  { ampp_id: '1339011000001102', vmpp_id: '1271511000001104', name: 'Lipitor 20mg tablets (Viatris) 28 tablet', nhs_price_pence: 2464, price_date: '2005-01-01', prev_price_pence: 2969 },
  // Price basis 0002 (no price available) publishes 0, which must not be read as free.
  { ampp_id: '1328011000001109', vmpp_id: '1271511000001104', name: 'Atorvastatin 20mg tablets (Maker) 28 tablet', nhs_price_pence: null, price_date: null, prev_price_pence: null },
]);
assert.equal(readDmd(dir).packs.length, 1);
console.log('PASS: dm+d Drug Tariff and NHS indicative prices parse from the release layout.');
