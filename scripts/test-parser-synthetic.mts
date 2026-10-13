import assert from 'node:assert/strict';
import { parseAverInvoice } from '../parser/src/parsers/aver-invoice.ts';
import { parseAverStatement } from '../parser/src/parsers/aver-statement.ts';
import { detect } from '../parser/src/detect.ts';
import { parsePhoenixInvoices, parsePhoenixLine } from '../parser/src/parsers/phoenix-invoice.ts';
import { parsePhoenixStatement } from '../parser/src/parsers/phoenix-statement.ts';
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
assert.equal(current.invoiceNumber,'9999002');assert.equal(current.invoiceDate,'2026-10-06');assert.equal(current.dueDate,'2026-11-30');assert.equal(current.customerAccount,'TEST');
assert.deepEqual(current.lines.map(l=>[l.packSize,l.qty]),[['30',6],['100',1],['100s',2],['56s',1],['100',4]]);
assert.equal(current.lines[1].description,'Co-Codamol Tabs 8/500mg / 100 CD5');assert.equal(current.totalsMatch,true,current.warnings.join('; '));
// Phoenix: invoice section only (returns stub ignored), GTIN lines, VAT summary, two invoices in one PDF.
const phoenixPage=(inv:string,lines:string[],goods:string,vat:string,total:string)=>`
 BIN LOCATION     PICK         PACK   PRODUCT DESCRIPTION/ PIP CODE      RTN       RTN
D8 03 06 00      2   100   SYNTHETIC CAPS 10MG                  1111-111*
                           ** GTIN - 05099151007742
For Conditions of Sale Please go to WWW.MYP-I-N.CO.UK
COMPANY REG No: 129370, VAT No. 109898228
   ORD             QTY        PRODUCT DESCRIPTION/PACK SIZE      PIP CODE          SRP         TRADE    VAT  DT       TOTAL                 LINE REF
   KEY              DEL
${lines.join('\n')}
                  VAT Summary: Code Rate Goods VAT
   1   20.00    ${goods}    ${vat}       Goods  Total:   ${goods}
                VAT  Total:   ${vat}
                Invoice  Total:   ${total}
Registered Office: Rivington Road, Whitehouse Ind Est, Runcorn, Cheshire, WA7 3DJ
COMPANY REG No: 129370, VAT No. 109898228
TEST PHARMACY(SYNTHETIC
PRECINCT LTD)
INVOICE
${inv}
99999
ETHICAL
28/02/25
PAGE NO:
Please Remit To: Synthetic Bank, Account Name PHD
`;
const bundle=phoenixPage('30000001',[
 'A            2  SYNTHETIC CAPS 10MG                  100    1111-111*    0.00   12.930  1        25.86  8830',
 '                ** GTIN - 05099151007742',
 'A NUT        1  SYNTHETIC SUSP 200MG/5ML     125ML  2222-222*    0.00   25.900  1  A      25.90',
],'51.76','10.35','62.11')+phoenixPage('30000002',[
 'A            4  SYNTHETIC TABS FRUIT       HP     56    3333-333*    0.00    5.120  1        20.48  8830',
],'20.48','4.10','24.58');
assert.equal(detect(bundle).supplier,'phoenix');
const phx=parsePhoenixInvoices(bundle);
assert.deepEqual(phx.map(d=>[d.invoiceNumber,d.invoiceDate,d.lines.length,d.totalsMatch]),[['30000001','2025-02-28',2,true],['30000002','2025-02-28',1,true]]);
assert.equal(phx[0].lines[0].gtin,'05099151007742');assert.equal(phx[0].lines[0].supplierSku,'1111-111');assert.equal(phx[0].lines[0].qty,2);
assert.equal(phx[0].lines[1].packSize,'125ML');assert.equal(phx[0].lines[1].qty,1);
assert.equal(+(phx[0].lines[0].vatAmount+phx[0].lines[1].vatAmount).toFixed(2),10.35);
assert.equal(parsePhoenixLine('C  8  SYNTHETIC TABS 400MG BRAND   24    0906-081*    4.99    1.100  1         8.80')?.net,8.8);
const pst=parsePhoenixStatement(`STATEMENT OF ACCOUNT
Page No:
99999
NOV-24
30/11/2024
1
31/10/24  BALANCE FORWARD  202410  100.00  0.00
30/11/24  DIRECT DEBIT  862197  100.00  0.00
01/11/24  INVOICE PHD  95288666  44.40  44.40
07/11/24  CREDITS PHD  RW  7099893  50.04  5.64-
08/11/24  INVOICE PHD  5684  95320580  78.62  72.98
TOTAL OUTSTANDING 72.98`);
assert.deepEqual(pst.rows.map(r=>[r.documentType,r.documentNumber,r.total]),[['OTHER','862197',-100],['INV','95288666',44.4],['CRED','7099893',-50.04],['INV','95320580',78.62]]);
assert.equal(pst.statementDate,'2024-11-30');assert.equal(pst.totals.total,72.98);assert.equal(pst.customerAccount,'99999');assert.equal(pst.totalsMatch,true,pst.warnings.join('; '));
const statement=parseAverStatement(`Aver Generics Ltd
Statement of Account
2.0010.009999001Invoice13/10/2026Unallocated0.0012.00
-2.00-10.00999999Credit Note13/10/2026Unallocated12.00
Current Grand Total 0.00`);
assert.equal(statement.rows.length,2);assert.equal(statement.rows[0].documentType,'INV');assert.equal(statement.rows[1].documentType,'CRED');assert.equal(statement.rows[1].total,-12);
assert.equal(detect('Unrecognised supplier').supplier,'unknown');
console.log('Synthetic parser tests passed: quantities, pack, totals, 2026 Aver layout (glued pack/qty, CD markers, wrapped lines), Phoenix invoices (bundles, GTINs, VAT summary) and statements, discrepancy, invoice and credit signs. No customer documents used.');
