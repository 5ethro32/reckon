import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, SCORE_FORMULA, scoreSupplier, type PerformanceRow } from '../supplier-score';
import { marginTotals, supplierPerformanceCsv, lineMarginCsv, type MarginLine } from '../margin-report';
import { parsePeriod } from '../period';

const base: PerformanceRow = { invoices: 4, invoices_mismatched: 1, checked_lines: 10, packs_ordered: 100, packs_received: 90, damaged_lines: 1, returned_lines: 1,
  claims_due: 4, claims_resolved_14d: 3, statements: 1, statements_with_variance: 0, compared_spend: '200.00', best_price_spend: '180.00' };

test('each component is shown and the score is the weighted average', () => {
  const { components, score } = scoreSupplier(base);
  assert.deepEqual(components, { fill: 90, condition: 80, credits: 75, accuracy: 80, price: 90 });
  // (30×90 + 15×80 + 20×75 + 15×80 + 20×90) ÷ 100 = 84
  assert.equal(score, 84);
  assert.equal(COMPONENTS.reduce((s, c) => s + c.weight, 0), 100);
  assert.match(SCORE_FORMULA, /fill rate 30, condition 15, credits 20, paperwork 15, price 20/);
});

test('components without data are left out and the other weights rescale', () => {
  const { components, score } = scoreSupplier({ ...base, claims_due: 0, claims_resolved_14d: 0, compared_spend: 0, best_price_spend: 0 });
  assert.equal(components.credits, null); assert.equal(components.price, null);
  // (30×90 + 15×80 + 15×80) ÷ 60 = 85
  assert.equal(score, 85);
  const empty = scoreSupplier({ invoices: 0, invoices_mismatched: 0, checked_lines: 0, packs_ordered: 0, packs_received: 0, damaged_lines: 0, returned_lines: 0,
    claims_due: 0, claims_resolved_14d: 0, statements: 0, statements_with_variance: 0, compared_spend: null, best_price_spend: null });
  assert.equal(empty.score, null);
});

test('components stay within 0 to 100', () => {
  const { components } = scoreSupplier({ ...base, packs_received: 120, damaged_lines: 30, best_price_spend: 250 });
  assert.equal(components.fill, 100); assert.equal(components.condition, 0); assert.equal(components.price, 100);
});

test('margin totals use reimbursement as the margin % base', () => {
  const t = marginTotals([
    { pharmacy_id: 'p', supplier: 'aah', lines: 3, matched_lines: 2, priced_lines: 2, unmatched_lines: 1, spend: '32.00', priced_spend: '29.00', reimbursement: '27.20', margin: '-1.80', margin_pct: '-6.6', loss_lines: 1, loss: '4.00', leakage: '0.00' },
    { pharmacy_id: 'p', supplier: 'phoenix', lines: 3, matched_lines: 2, priced_lines: 1, unmatched_lines: 1, spend: '27.00', priced_spend: '16.00', reimbursement: '14.40', margin: '-1.60', margin_pct: '-11.1', loss_lines: 1, loss: '1.60', leakage: '6.00' },
  ]);
  assert.deepEqual([t.spend, t.reimbursement, t.margin, t.marginPct, t.lossLines, t.loss, t.leakage, t.unmatched], [59, 41.6, -3.4, -8.2, 2, 5.6, 6, 2]);
  assert.equal(marginTotals([]).marginPct, null);
});

test('CSV exports are labelled and safe for spreadsheets', () => {
  const perf = supplierPerformanceCsv([{ ...base, pharmacy_id: 'p', supplier: '=aah' }]);
  assert.match(perf.split('\r\n')[0], /"Score","Fill rate \(weight 30\)"/);
  assert.match(perf.split('\r\n')[1], /^"p","'=aah","84","90","80","75","80","90"/);
  const line = { line_id: 'l', invoice_id: 'i', pharmacy_id: 'p', supplier: 'aah', invoice_number: 'INV1', invoice_date: '2026-08-05', description: 'Atorvastatin 20mg', pack_size: '28', qty: 10,
    net: '5.00', cost_per_pack: '0.5000', match_status: 'matched', match_source: 'invoice', vmpp_id: 'v', ampp_id: 'a', product: 'Atorvastatin 20mg tablets 28 tablet', dt_category: 'Part VIIIA Category M',
    reimbursement_basis: 'drug_tariff', reimbursement_per_pack: '0.7200', reimbursement: '7.20', list_price_per_pack: null, margin_per_pack: '0.2200', margin: '2.20', margin_pct: '30.6',
    best_price_per_pack: '0.5000', best_supplier: 'aah', leakage: '0.00' } satisfies MarginLine;
  assert.match(lineMarginCsv([line]).split('\r\n')[1], /"Drug Tariff","0.72","","0.22","2.20","30.6"/);
});

test('period defaults to the last 90 days and rejects bad input', () => {
  assert.deepEqual(parsePeriod({}, '2026-10-14'), { from: '2026-07-17', to: '2026-10-14' });
  assert.deepEqual(parsePeriod({ from: '2026-08-01', to: '2026-09-30' }, '2026-10-14'), { from: '2026-08-01', to: '2026-09-30' });
  assert.deepEqual(parsePeriod({ from: '2026-02-30', to: 'x' }, '2026-10-14'), { from: '2026-07-17', to: '2026-10-14' });
  assert.deepEqual(parsePeriod({ from: '2026-10-01', to: '2026-09-01' }, '2026-10-14'), { from: '2026-06-04', to: '2026-09-01' });
  assert.deepEqual(parsePeriod({ from: '2020-01-01', to: '2026-10-14' }, '2026-10-14'), { from: '2024-10-14', to: '2026-10-14' });
  assert.deepEqual(parsePeriod({ from: ['2026-08-01'], to: ['2026-08-31'] }), { from: '2026-08-01', to: '2026-08-31' });
});
