/**
 * Purchase margin against the Drug Tariff and supplier performance: row types for the migration 0020
 * functions, totals and CSV exports. This is purchase margin, not profit: it ignores what was dispensed,
 * Category M clawback, discount deductions and fees.
 */
import { csvCell } from './operations-summary';
import { COMPONENTS, scoreSupplier, type PerformanceRow } from './supplier-score';
type Num = number | string | null;
export type MarginLine = {
  line_id: string; invoice_id: string; pharmacy_id: string; supplier: string; invoice_number: string; invoice_date: string;
  description: string; pack_size: string | null; qty: number; net: Num; cost_per_pack: Num;
  match_status: 'matched' | 'unmatched' | 'not_in_dmd' | 'conflict'; match_source: string | null; vmpp_id: string | null; ampp_id: string | null;
  product: string | null; dt_category: string | null; reimbursement_basis: 'drug_tariff' | 'nhs_indicative' | 'no_price' | null;
  reimbursement_per_pack: Num; reimbursement: Num; list_price_per_pack: Num; margin_per_pack: Num; margin: Num; margin_pct: Num;
  best_price_per_pack: Num; best_supplier: string | null; leakage: Num;
};
export type SupplierMargin = {
  pharmacy_id: string; supplier: string; lines: Num; matched_lines: Num; priced_lines: Num; unmatched_lines: Num;
  spend: Num; priced_spend: Num; reimbursement: Num; margin: Num; margin_pct: Num; loss_lines: Num; loss: Num; leakage: Num;
};
export type ProductMargin = {
  pharmacy_id: string; vmpp_id: string; product: string | null; dt_category: string | null; reimbursement_basis: string | null;
  lines: Num; packs: Num; suppliers: Num; spend: Num; reimbursement: Num; margin: Num; margin_pct: Num; loss_lines: Num;
  best_price_per_pack: Num; best_supplier: string | null; reimbursement_per_pack: Num; leakage: Num;
};
export type SupplierPerformance = PerformanceRow & { pharmacy_id: string; supplier: string };

export const MATCH_REASON: Record<MarginLine['match_status'], string> = {
  matched: 'Matched',
  unmatched: 'No confirmed pack: no barcode on the invoice line, no verified barcode for the supplier code, and no scanned packs',
  not_in_dmd: 'Pack found, but it is not in the loaded dm+d prices',
  conflict: 'Barcodes for this line point to different products',
};
export const BASIS_LABEL: Record<string, string> = { drug_tariff: 'Drug Tariff', nhs_indicative: 'NHS indicative price', no_price: 'No reimbursement price' };

const v = (x: Num | undefined) => x === null || x === undefined ? 0 : Number(x);
const money = (x: Num) => x === null ? '' : Number(x).toFixed(2);
const plain = (x: Num) => x === null ? '' : String(Number(x));

/** Period totals across suppliers. Margin % is margin ÷ reimbursement, on lines with a reimbursement price. */
export function marginTotals(rows: SupplierMargin[]) {
  const t = rows.reduce((a, r) => ({ lines: a.lines + v(r.lines), unmatched: a.unmatched + v(r.unmatched_lines), priced: a.priced + v(r.priced_lines),
    spend: a.spend + v(r.spend), pricedSpend: a.pricedSpend + v(r.priced_spend), reimbursement: a.reimbursement + v(r.reimbursement),
    margin: a.margin + v(r.margin), lossLines: a.lossLines + v(r.loss_lines), loss: a.loss + v(r.loss), leakage: a.leakage + v(r.leakage) }),
  { lines: 0, unmatched: 0, priced: 0, spend: 0, pricedSpend: 0, reimbursement: 0, margin: 0, lossLines: 0, loss: 0, leakage: 0 });
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { ...t, spend: r2(t.spend), pricedSpend: r2(t.pricedSpend), reimbursement: r2(t.reimbursement), margin: r2(t.margin), loss: r2(t.loss), leakage: r2(t.leakage),
    marginPct: t.reimbursement > 0 ? Math.round(t.margin / t.reimbursement * 1000) / 10 : null };
}

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
export function supplierMarginCsv(rows: SupplierMargin[]): string {
  return csv([['Pharmacy ID', 'Supplier', 'Lines', 'Matched lines', 'Lines with a reimbursement price', 'Unmatched lines', 'Spend GBP (net of VAT)', 'Spend on priced lines GBP', 'Reimbursement GBP', 'Purchase margin GBP', 'Purchase margin %', 'Loss-making lines', 'Loss GBP', 'Paid above best price GBP'],
    ...rows.map((r) => [r.pharmacy_id, r.supplier, plain(r.lines), plain(r.matched_lines), plain(r.priced_lines), plain(r.unmatched_lines), money(r.spend), money(r.priced_spend), money(r.reimbursement), money(r.margin), plain(r.margin_pct), plain(r.loss_lines), money(r.loss), money(r.leakage)])]);
}
export function productMarginCsv(rows: ProductMargin[]): string {
  return csv([['Pharmacy ID', 'VMPP ID', 'Product', 'Drug Tariff category', 'Reimbursement basis', 'Lines', 'Packs', 'Suppliers', 'Spend GBP', 'Reimbursement per pack GBP', 'Reimbursement GBP', 'Purchase margin GBP', 'Purchase margin %', 'Loss-making lines', 'Best price per pack GBP', 'Best price supplier', 'Paid above best price GBP'],
    ...rows.map((r) => [r.pharmacy_id, r.vmpp_id, r.product ?? '', r.dt_category ?? '', (r.reimbursement_basis ?? '').split(',').map((b) => BASIS_LABEL[b] ?? b).join('; '), plain(r.lines), plain(r.packs), plain(r.suppliers), money(r.spend), plain(r.reimbursement_per_pack), money(r.reimbursement), money(r.margin), plain(r.margin_pct), plain(r.loss_lines), plain(r.best_price_per_pack), r.best_supplier ?? '', money(r.leakage)])]);
}
export function lineMarginCsv(rows: MarginLine[]): string {
  return csv([['Pharmacy ID', 'Supplier', 'Invoice', 'Invoice date', 'Description', 'Pack size', 'Packs', 'Net GBP', 'Cost per pack GBP', 'Match', 'Matched by', 'VMPP ID', 'AMPP ID', 'dm+d product', 'Drug Tariff category', 'Reimbursement basis', 'Reimbursement per pack GBP', 'NHS indicative price per pack GBP', 'Purchase margin per pack GBP', 'Purchase margin GBP', 'Purchase margin %', 'Best price per pack GBP', 'Best price supplier', 'Paid above best price GBP'],
    ...rows.map((r) => [r.pharmacy_id, r.supplier, r.invoice_number, r.invoice_date, r.description, r.pack_size ?? '', r.qty, money(r.net), plain(r.cost_per_pack), MATCH_REASON[r.match_status] ?? r.match_status, r.match_source ?? '', r.vmpp_id ?? '', r.ampp_id ?? '', r.product ?? '', r.dt_category ?? '', r.reimbursement_basis ? BASIS_LABEL[r.reimbursement_basis] : '', plain(r.reimbursement_per_pack), plain(r.list_price_per_pack), plain(r.margin_per_pack), money(r.margin), plain(r.margin_pct), plain(r.best_price_per_pack), r.best_supplier ?? '', money(r.leakage)])]);
}
export function supplierPerformanceCsv(rows: SupplierPerformance[]): string {
  return csv([['Pharmacy ID', 'Supplier', 'Score', ...COMPONENTS.map((c) => `${c.label} (weight ${c.weight})`), 'Invoices', 'Invoices with mismatched totals', 'Lines', 'Checked lines', 'Packs invoiced (checked)', 'Packs received', 'Short lines', 'Damaged lines', 'Returned lines', 'Claims sent', 'Claims resolved', 'Claims resolved within 14 days', 'Open claims over 14 days', 'Average days to resolve', 'Statements', 'Statements with a variance', 'Price-compared lines', 'Price-compared spend GBP', 'Same packs at best price GBP'],
    ...rows.map((r) => { const s = scoreSupplier(r); return [r.pharmacy_id, r.supplier, s.score ?? '', ...COMPONENTS.map((c) => s.components[c.key] ?? ''), plain(r.invoices), plain(r.invoices_mismatched), plain(r.lines ?? null), plain(r.checked_lines), plain(r.packs_ordered), plain(r.packs_received), plain(r.short_lines ?? null), plain(r.damaged_lines), plain(r.returned_lines), plain(r.claims_sent ?? null), plain(r.claims_resolved ?? null), plain(r.claims_resolved_14d), plain(r.claims_open_overdue ?? null), plain(r.avg_turnaround_days ?? null), plain(r.statements), plain(r.statements_with_variance), plain(r.compared_lines ?? null), money(r.compared_spend), money(r.best_price_spend)]; })]);
}
