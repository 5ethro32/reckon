import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averSlipId, slipInvoiceRows } from '../aver-slip';

test('averSlipId reads only picking-slip codes', () => {
  assert.equal(averSlipId('AVERPL:F59A4198-6411-4723-B1C5-80F07BAC18E4'), 'f59a4198-6411-4723-b1c5-80f07bac18e4');
  assert.equal(averSlipId('AVERCD:f59a4198-6411-4723-b1c5-80f07bac18e4'), null);
  assert.equal(averSlipId('5012345678900'), null);
});

test('slipInvoiceRows maps an Aver slip invoice to Reckon rows', () => {
  const { header, lines } = slipInvoiceRows({
    invoiceNo: '5797688', account: 'HO025', invoicedAt: '2026-10-15T08:56:57Z', paymentDue: '2026-11-30', net: 72.5, vat: 14.5, gross: 87,
    lines: [
      { code: 'RAMIPRILCAPS2.5MG/28', description: 'Ramipril Caps 2.5mg / 28', pip: null, qty: 20, unitPrice: 3.6, unitVat: 0.72, net: 72 },
      { code: 'DIAZEPAMTABS2MG/28', description: 'Diazepam Tabs 2mg / 28 CD4.1', pip: '1084037', qty: 2, unitPrice: 0.25, unitVat: 0.05, net: 0.5 },
    ],
  });
  assert.equal(header.invoice_date, '2026-10-15');
  assert.equal(header.totals_match, true);
  assert.equal(lines[0]!.pack_size, '28');
  assert.equal(lines[1]!.pack_size, '28');
  assert.equal(lines[0]!.vat_amount, 14.4);
  assert.equal(lines[0]!.vat_rate, 20);
  assert.equal(lines[1]!.gross, 0.6);
});
