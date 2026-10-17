/**
 * Purchase margin against the Drug Tariff: what each invoiced pack cost against what the NHS reimburses
 * for it, per supplier, per product and per line, and how much was paid above the best price seen.
 */
import Link from 'next/link';
import { loadMarginSummary } from '@/lib/margin-data';
import { BASIS_LABEL, MATCH_REASON, marginTotals } from '@/lib/margin-report';
import { parsePeriod, periodQuery } from '@/lib/period';
import { PeriodFilter } from '../period-filter';

const money = (n: number | string | null) => n === null ? '–' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n));
const pct = (n: number | string | null) => n === null ? '–' : `${Number(n).toFixed(1)}%`;
const count = (n: number | string | null) => n === null ? '0' : String(Number(n));

export default async function MarginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const period = parsePeriod(await searchParams);
  const q = periodQuery(period);
  let data;
  try { data = await loadMarginSummary(period); } catch {
    return <section className="card ops-panel" role="alert"><h1 className="page-title">Margin unavailable</h1><p className="ops-muted">We couldn’t load margin figures. If this is a new installation, apply database update 0020 and load the dm+d prices, then refresh. No partial totals are shown.</p></section>;
  }
  const t = marginTotals(data.suppliers);
  const many = new Set(data.suppliers.map((s) => s.pharmacy_id)).size > 1;
  return <div className="operations-overview">
    <div className="page-header" style={{ flexWrap: 'wrap' }}>
      <div><h1 className="page-header-title">Margin</h1><p className="page-header-subtitle">Purchase margin against the Drug Tariff, from invoice prices net of VAT. This is not profit.</p></div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <a className="btn btn-secondary" href={`/api/reports/margin?view=suppliers&${q}`}>Suppliers CSV</a>
        <a className="btn btn-secondary" href={`/api/reports/margin?view=products&${q}`}>Products CSV</a>
        <a className="btn btn-secondary" href={`/api/reports/margin?view=lines&${q}`}>All lines CSV</a>
      </div>
    </div>
    <PeriodFilter period={period} action="/margin" />
    {!data.pricesLoaded && <div className="card ops-panel" role="status" style={{ marginBottom: '1rem' }}><strong>Reimbursement prices are not loaded.</strong><p className="ops-muted">Load the NHS dm+d release with scripts/import-dmd.mts to see Drug Tariff prices. Until then every line shows as unmatched or without a price.</p></div>}
    <section className="dash-kpi-grid" aria-label="Period totals">
      <Metric title="Purchase margin" value={money(t.margin)} detail={`${pct(t.marginPct)} of reimbursement on ${t.priced} priced lines`} />
      <Metric title="Loss-making lines" value={String(t.lossLines)} detail={`${money(t.loss)} paid above reimbursement`} />
      <Metric title="Paid above best price" value={money(t.leakage)} detail="Against the lowest price paid for the same pack in the period" />
      <Metric title="Unmatched lines" value={String(t.unmatched)} detail={`of ${t.lines} lines · not included in margin`} />
    </section>

    <section className="card ops-panel"><h2>By supplier</h2><p className="ops-muted">Margin % is margin ÷ reimbursement. Spend covers all invoiced lines; margin covers only lines with a reimbursement price.</p>
      <div className="table-scroll"><table className="table"><caption className="sr-only">Purchase margin by supplier</caption><thead><tr><th>Supplier</th>{many && <th>Pharmacy ID</th>}<th className="num">Lines</th><th className="num">Priced</th><th className="num">Spend</th><th className="num">Reimbursement</th><th className="num">Margin</th><th className="num">Margin %</th><th className="num">Loss lines</th><th className="num">Above best price</th></tr></thead>
      <tbody>{data.suppliers.map((r) => <tr key={r.pharmacy_id + r.supplier}><th scope="row">{r.supplier.toUpperCase()}</th>{many && <td><span title={r.pharmacy_id}>{r.pharmacy_id.slice(0, 8)}</span></td>}<td className="num">{count(r.lines)}</td><td className="num">{count(r.priced_lines)}</td><td className="num">{money(r.spend)}</td><td className="num">{money(r.reimbursement)}</td><td className="num">{money(r.margin)}</td><td className="num">{pct(r.margin_pct)}</td><td className="num">{count(r.loss_lines)}</td><td className="num">{money(r.leakage)}</td></tr>)}</tbody></table>
      {!data.suppliers.length && <p className="ops-empty">No invoice lines in this period.</p>}</div>
    </section>

    <section className="card ops-panel ops-suppliers"><h2>By product</h2><p className="ops-muted">Top 100 matched products by spend. The best price is the lowest cost per pack paid for the same dm+d pack in the period, by any supplier.</p>
      <div className="table-scroll"><table className="table"><caption className="sr-only">Purchase margin by product</caption><thead><tr><th>Product</th><th>Category</th><th className="num">Packs</th><th className="num">Suppliers</th><th className="num">Spend</th><th className="num">Reimbursement per pack</th><th>Best price per pack</th><th className="num">Margin</th><th className="num">Margin %</th><th className="num">Above best price</th></tr></thead>
      <tbody>{data.products.map((r) => <tr key={r.pharmacy_id + r.vmpp_id} className={Number(r.loss_lines) > 0 ? 'is-warning' : undefined}><th scope="row">{r.product ?? r.vmpp_id}</th><td>{r.dt_category ?? (r.reimbursement_basis ?? '').split(',').map((b) => BASIS_LABEL[b] ?? b).join(', ')}</td><td className="num">{count(r.packs)}</td><td className="num">{count(r.suppliers)}</td><td className="num">{money(r.spend)}</td><td className="num">{money(r.reimbursement_per_pack)}</td><td>{money(r.best_price_per_pack)} {r.best_supplier ? `(${r.best_supplier.toUpperCase()})` : ''}</td><td className="num">{money(r.margin)}</td><td className="num">{pct(r.margin_pct)}</td><td className="num">{money(r.leakage)}</td></tr>)}</tbody></table>
      {!data.products.length && <p className="ops-empty">No lines are matched to a dm+d pack in this period.</p>}</div>
    </section>

    <section className="card ops-panel ops-suppliers"><h2>Loss-making lines</h2><p className="ops-muted">Cost per pack above the reimbursement price, largest loss first (up to 100). A branded prescription is reimbursed at the brand’s list price, shown for reference.</p>
      <div className="table-scroll"><table className="table"><caption className="sr-only">Lines bought above their reimbursement price</caption><thead><tr><th>Invoice</th><th>Line</th><th className="num">Packs</th><th className="num">Cost per pack</th><th className="num">Reimbursement per pack</th><th>Basis</th><th className="num">List price</th><th className="num">Loss</th></tr></thead>
      <tbody>{data.losses.map((r) => <tr key={r.line_id}><td><Link className="row-link" href={`/invoices/${r.invoice_id}`}>{r.supplier.toUpperCase()} · {r.invoice_number}</Link><br /><span className="ops-muted">{r.invoice_date}</span></td><td>{r.description}{r.pack_size ? ` · ${r.pack_size}` : ''}<br /><span className="ops-muted">{r.product}</span></td><td className="num">{r.qty}</td><td className="num">{money(r.cost_per_pack)}</td><td className="num">{money(r.reimbursement_per_pack)}</td><td>{r.reimbursement_basis ? BASIS_LABEL[r.reimbursement_basis] : ''}{r.dt_category ? ` · ${r.dt_category}` : ''}</td><td className="num">{money(r.list_price_per_pack)}</td><td className="num">{money(-Number(r.margin))}</td></tr>)}</tbody></table>
      {!data.losses.length && <p className="ops-empty">No matched line cost more than its reimbursement price in this period.</p>}</div>
    </section>

    <section className="card ops-panel ops-suppliers"><h2>Unmatched lines</h2><p className="ops-muted">Lines are matched only through a barcode printed on the invoice line, a verified barcode saved for the supplier code, or packs scanned against the line. Descriptions are never used to guess. Scan a pack or import a barcode catalogue to match a line. Showing up to 100, newest first.</p>
      <div className="table-scroll"><table className="table"><caption className="sr-only">Lines not matched to a dm+d pack</caption><thead><tr><th>Invoice</th><th>Line</th><th className="num">Net</th><th>Reason</th></tr></thead>
      <tbody>{data.unmatched.map((r) => <tr key={r.line_id}><td><Link className="row-link" href={`/invoices/${r.invoice_id}`}>{r.supplier.toUpperCase()} · {r.invoice_number}</Link><br /><span className="ops-muted">{r.invoice_date}</span></td><td>{r.description}{r.pack_size ? ` · ${r.pack_size}` : ''}</td><td className="num">{money(r.net)}</td><td>{MATCH_REASON[r.match_status]}</td></tr>)}</tbody></table>
      {!data.unmatched.length && <p className="ops-empty">Every line in this period is matched.</p>}</div>
    </section>

    <section className="ops-panel"><h2>What this figure leaves out</h2><ul className="ops-muted">
      <li>It compares purchase prices with reimbursement prices. Actual income depends on what was dispensed and reimbursed, the prescription (generic or branded) and the month the item was dispensed.</li>
      <li>Category M prices are set to recover a margin target and may be adjusted later. Discount deductions, fees and allowances are not included.</li>
      <li>dm+d holds the current and previous price only. An invoice dated before the current price uses the previous price; older invoices may differ from the price in force at the time.</li>
      <li>Costs are invoice line net values divided by packs invoiced, before any credits or retrospective discounts.</li>
      <li>Prices: NHS dm+d, Open Government Licence v3.0.</li>
    </ul></section>
  </div>;
}
function Metric({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <div className="card ops-metric"><span className="section-label">{title}</span><strong>{value}</strong><span className="ops-muted">{detail}</span></div>;
}
