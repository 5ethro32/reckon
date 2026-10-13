import assert from 'node:assert/strict';
import { parseAverInvoice } from '../parser/src/parsers/aver-invoice.ts';
import { parseAverStatement } from '../parser/src/parsers/aver-statement.ts';
import { detect } from '../parser/src/detect.ts';
const invoice=`Aver Generics Ltd
Invoice No.
Invoice/Tax Date
Account No.
9999001
2026-10-13
TEST
Bin
A-00012Synthetic Tablets / 28£5.00£10.00£2.00
Total Items Net
Carriage Net
Total VAT Amount
Total Amount
£10.00
£2.00
£12.00`;
const parsed=parseAverInvoice(invoice);
assert.equal(parsed.invoiceNumber,'9999001');assert.equal(parsed.lines.length,1);
assert.equal(parsed.lines[0].qty,2);assert.equal(parsed.lines[0].packSize,'28');assert.equal(parsed.grossTotal,12);assert.equal(parsed.totalsMatch,true);
assert.equal(detect(invoice).supplier,'aver');
assert.equal(parseAverInvoice(invoice.replace('£12.00','£13.00')).totalsMatch,false);
// 2026 layout: VAT rate column, pack size glued to quantity, CD markers and wrapped lines.
const current=parseAverInvoice(`Aver Generics Ltd.
Invoice No.
Invoice/Tax Date
Account No.
Payment Due
9999002
06/10/2026
TEST
30/11/2026
Invoice 9999002
BinDescriptionQtyUnit PriceNetVAT RateTax
C-1409Alfacalcidol Caps 0.5mcg / 306£1.52£9.1220.0%£1.82
X06-01Co-Codamol Tabs 8/500mg / 100   CD51£2.32£2.3220.0%£0.46
C-1419Methocarbamol Tabs 750mg 100s2£2.70£5.4020.0%£1.08
X04-05Pregabalin Caps 25mg 56s ( CD3 )1£0.66£0.6620.0%£0.13
X04-04Co-Codamol CAPSULES 30/500mg / 100
CD5
4£4.29£17.1620.0%£3.43
Total Items Net
Carriage Net
Total VAT Amount
Total Amount
£34.66
£0.00
£6.92
£41.58`);
assert.equal(current.invoiceNumber,'9999002');assert.equal(current.invoiceDate,'2026-10-06');assert.equal(current.customerAccount,'TEST');
assert.deepEqual(current.lines.map(l=>[l.packSize,l.qty]),[['30',6],['100',1],['100s',2],['56s',1],['100',4]]);
assert.equal(current.lines[1].description,'Co-Codamol Tabs 8/500mg / 100 CD5');assert.equal(current.totalsMatch,true,current.warnings.join('; '));
const statement=parseAverStatement(`Aver Generics Ltd
Statement of Account
2.0010.009999001Invoice13/10/2026Unallocated0.0012.00
-2.00-10.00999999Credit Note13/10/2026Unallocated12.00
Current Grand Total 0.00`);
assert.equal(statement.rows.length,2);assert.equal(statement.rows[0].documentType,'INV');assert.equal(statement.rows[1].documentType,'CRED');assert.equal(statement.rows[1].total,-12);
assert.equal(detect('Unrecognised supplier').supplier,'unknown');
console.log('Synthetic parser tests passed: quantities, pack, totals, 2026 Aver layout (glued pack/qty, CD markers, wrapped lines), discrepancy, invoice and credit signs. No customer documents used.');
