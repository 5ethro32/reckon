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
const statement=parseAverStatement(`Aver Generics Ltd
Statement of Account
2.0010.009999001Invoice13/10/2026Unallocated0.0012.00
-2.00-10.00999999Credit Note13/10/2026Unallocated12.00
Current Grand Total 0.00`);
assert.equal(statement.rows.length,2);assert.equal(statement.rows[0].documentType,'INV');assert.equal(statement.rows[1].documentType,'CRED');assert.equal(statement.rows[1].total,-12);
assert.equal(detect('Unrecognised supplier').supplier,'unknown');
console.log('Synthetic parser tests passed: quantities, pack, totals, discrepancy, invoice and credit signs. No customer documents used.');
