/**
 * Purchase margin against the Drug Tariff: what each invoiced pack cost against what the NHS reimburses
 * for it, per supplier, per product and per line, and how much was paid above the best price seen.
 */
import Link from 'next/link';
import { loadMarginSummary } from '@/lib/margin-data';
import { BASIS_LABEL, MATCH_REASON, marginTotals } from '@/lib/margin-report';
import { parsePeriod, periodQuery } from '@/lib/period';
import { PeriodFilter } from '../period-filter';
import { Figure, SupplierTag, shortDate, supplierLabel } from '../ui';

const money = (n: number | string | null) => n === null ? '–' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n));
const pct = (n: number | string | null) => n === null ? '–' : `${Number(n).toFixed(1)}%`;
const count = (n: number | string | null) => n === null ? '0' : String(Number(n));

export default async function MarginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const period = parsePeriod(await searchParams);
  const q = periodQuery(period);
  let data;
  try { data = await loadMarginSummary(period); } catch {
    return <section className="card notice" role="alert"><strong>Margin did not load</strong><p>If this is a new installation, apply database update 0020 and load the dm+d prices, then refresh. No partial totals are shown.</p></section>;
  }
  const t = marginTotals(data.suppliers);
  const many = new Set(data.suppliers.map((s) => s.pharmacy_id)).size > 1;
  return <div>
    <div className="page-header">
      <div>
        <h1 className="page-header-title">Margin</h1>
        <p className="page-header-subtitle">What each pack cost against what the Drug Tariff pays for it, from invoice prices before VAT. This is not profit.</p>
      </div>
    </div>
    <PeriodFilter period={period} action="/margin" />
    {!data.pricesLoaded && <div className="card notice notice-warn" role="status" style={{ marginBottom: '1rem' }}><strong>Reimbursement prices are not loaded</strong><p>Load the NHS dm+d release with scripts/import-dmd.mts to see Drug Tariff prices. Until then every line shows as unmatched or without a price.</p></div>}
    <section className="figures" aria-label="Period totals">
      <Figure label="Purchase margin" value={money(t.margin)} line={`${pct(t.marginPct)} on ${t.priced} priced lines`} />
      <Figure label="Bought at a loss" value={money(t.loss)} line={`${t.lossLines} line${t.lossLines === 1 ? '' : 's'} above the tariff`} />
      <Figure label="Above best price" value={money(t.leakage)} line="Against the lowest price you paid" />
      <Figure label="Not matched" value={String(t.unmatched)} line={`of ${t.lines} lines, left out`} />
    </section>

    <section className="card" style={{ overflow: 'hidden', marginBottom: '1rem' }} aria-labelledby="m-suppliers">
      <div className="card-head"><h2 id="m-suppliers">By supplier</h2><a className="quiet-link" href={`/api/reports/margin?view=suppliers&${q}`}>CSV</a></div>
      <div className="table-scroll"><table className="table rows"><caption className="sr-only">Purchase margin by supplier</caption><thead><tr><th>Supplier</th>{many && <th>Pharmacy ID</th>}<th className="num">Lines</th><th className="num">Priced</th><th className="num">Spend</th><th className="num">Reimbursement</th><th className="num">Margin</th><th className="num">Margin %</th><th className="num">Loss lines</th><th className="num">Above best price</th></tr></thead>
      <tbody>{data.suppliers.map((r) => <tr key={r.pharmacy_id + r.supplier}><th scope="row" className="c-title"><SupplierTag code={r.supplier} /></th>{many && <td className="c-hide"><span title={r.pharmacy_id}>{r.pharmacy_id.slice(0, 8)}</span></td>}<td className="num c-hide">{count(r.lines)}</td><td className="num c-hide">{count(r.priced_lines)}</td><td className="num c-meta"><span className="c-phone">Spend </span>{money(r.spend)}</td><td className="num c-hide">{money(r.reimbursement)}</td><td className="num c-value">{money(r.margin)}</td><td className="num c-meta">{pct(r.margin_pct)}</td><td className="num c-hide">{count(r.loss_lines)}</td><td className="num c-hide">{money(r.leakage)}</td></tr>)}</tbody></table>
      {!data.suppliers.length && <p className="card-empty" style={{ paddingTop: '1rem' }}>No invoice lines in this period.</p>}</div>
      <details className="method"><summary>About these figures</summary><p>Margin % is margin ÷ reimbursement. Spend covers all invoiced lines; margin covers only lines with a reimbursement price.</p></details>
    </section>

    <section className="card" style={{ overflow: 'hidden', marginBottom: '1rem' }} aria-labelledby="m-products">
      <div className="card-head"><h2 id="m-products">By product</h2><a className="quiet-link" href={`/api/reports/margin?view=products&${q}`}>CSV</a></div>
      <div className="table-scroll"><table className="table rows"><caption className="sr-only">Purchase margin by product</caption><thead><tr><th>Product</th><th>Category</th><th className="num">Packs</th><th className="num">Suppliers</th><th className="num">Spend</th><th className="num">Reimbursement per pack</th><th>Best price per pack</th><th className="num">Margin</th><th className="num">Margin %</th><th className="num">Above best price</th></tr></thead>
      <tbody>{data.products.map((r) => <tr key={r.pharmacy_id + r.vmpp_id}><th scope="row" className="c-title">{r.product ?? r.vmpp_id}</th><td className="c-hide">{r.dt_category ?? (r.reimbursement_basis ?? '').split(',').map((b) => BASIS_LABEL[b] ?? b).join(', ')}</td><td className="num c-meta">{count(r.packs)}<span className="c-phone"> packs</span></td><td className="num c-hide">{count(r.suppliers)}</td><td className="num c-hide">{money(r.spend)}</td><td className="num c-hide">{money(r.reimbursement_per_pack)}</td><td className="c-hide">{money(r.best_price_per_pack)} {r.best_supplier ? `(${supplierLabel(r.best_supplier)})` : ''}</td><td className="num c-value">{money(r.margin)}</td><td className="num c-meta">{pct(r.margin_pct)}</td><td className="num c-status">{Number(r.loss_lines) > 0 ? <span className="status status-warn">{money(r.leakage)}<span className="c-phone">&nbsp;above best</span></span> : money(r.leakage)}</td></tr>)}</tbody></table>
      {!data.products.length && <p className="card-empty" style={{ paddingTop: '1rem' }}>No lines are matched to a dm+d pack in this period.</p>}</div>
      <details className="method"><summary>About these figures</summary><p>The top 100 matched products by spend. The best price is the lowest cost per pack paid for the same dm+d pack in the period, by any supplier. A dot marks a product with a line bought above its reimbursement price.</p></details>
    </section>

    <section className="card" style={{ overflow: 'hidden', marginBottom: '1rem' }} aria-labelledby="m-losses">
      <div className="card-head"><h2 id="m-losses">Bought at a loss</h2><a className="quiet-link" href={`/api/reports/margin?view=lines&${q}`}>All lines CSV</a></div>
      <div className="table-scroll"><table className="table rows"><caption className="sr-only">Lines bought above their reimbursement price</caption><thead><tr><th>Line</th><th>Invoice</th><th className="num">Packs</th><th className="num">Cost per pack</th><th className="num">Reimbursement per pack</th><th>Basis</th><th className="num">List price</th><th className="num">Loss</th></tr></thead>
      <tbody>{data.losses.map((r) => <tr key={r.line_id}><td className="c-title"><Link className="row-cover" prefetch={false} href={`/invoices/${r.invoice_id}`}>{r.description}{r.pack_size ? ` · ${r.pack_size}` : ''}</Link><span className="sub c-desk">{r.product}</span></td><td className="c-meta"><SupplierTag code={r.supplier}>{supplierLabel(r.supplier)} {r.invoice_number}</SupplierTag><span className="sub c-desk">{shortDate(r.invoice_date)}</span></td><td className="num c-meta">{r.qty}<span className="c-phone"> packs</span></td><td className="num c-hide">{money(r.cost_per_pack)}</td><td className="num c-hide">{money(r.reimbursement_per_pack)}</td><td className="c-hide">{r.reimbursement_basis ? BASIS_LABEL[r.reimbursement_basis] : ''}{r.dt_category ? ` · ${r.dt_category}` : ''}</td><td className="num c-hide">{money(r.list_price_per_pack)}</td><td className="num c-value">{money(-Number(r.margin))}</td></tr>)}</tbody></table>
      {!data.losses.length && <p className="card-empty" style={{ paddingTop: '1rem' }}>No matched line cost more than its reimbursement price in this period.</p>}</div>
      <details className="method"><summary>About these lines</summary><p>Cost per pack above the reimbursement price, largest loss first (up to 100). A branded prescription is reimbursed at the brand’s list price, shown for reference.</p></details>
    </section>

    <section className="card" style={{ overflow: 'hidden', marginBottom: '1rem' }} aria-labelledby="m-unmatched">
      <div className="card-head"><h2 id="m-unmatched">Not matched</h2><span className="card-head-detail">Newest first, up to 100</span></div>
      <div className="table-scroll"><table className="table rows"><caption className="sr-only">Lines not matched to a dm+d pack</caption><thead><tr><th>Line</th><th>Invoice</th><th className="num">Net</th><th>Reason</th></tr></thead>
      <tbody>{data.unmatched.map((r) => <tr key={r.line_id}><td className="c-title"><Link className="row-cover" prefetch={false} href={`/invoices/${r.invoice_id}`}>{r.description}{r.pack_size ? ` · ${r.pack_size}` : ''}</Link></td><td className="c-meta"><SupplierTag code={r.supplier}>{supplierLabel(r.supplier)} {r.invoice_number}</SupplierTag><span className="sub c-desk">{shortDate(r.invoice_date)}</span></td><td className="num c-value">{money(r.net)}</td><td className="c-meta">{MATCH_REASON[r.match_status]}</td></tr>)}</tbody></table>
      {!data.unmatched.length && <p className="card-empty" style={{ paddingTop: '1rem' }}>Every line in this period is matched.</p>}</div>
      <details className="method"><summary>How lines are matched</summary><p>Only through a barcode printed on the invoice line, a verified barcode saved for the supplier code, or packs scanned against the line. Descriptions are never used to guess. Scan a pack or import a barcode catalogue to match a line.</p></details>
    </section>

    <details className="method card" style={{ borderTop: '1px solid var(--hairline)' }}>
      <summary>What this figure leaves out</summary>
      <ul>
        <li>It compares purchase prices with reimbursement prices. Actual income depends on what was dispensed and reimbursed, the prescription (generic or branded) and the month the item was dispensed.</li>
        <li>Category M prices are set to recover a margin target and may be adjusted later. Discount deductions, fees and allowances are not included.</li>
        <li>dm+d holds the current and previous price only. An invoice dated before the current price uses the previous price; older invoices may differ from the price in force at the time.</li>
        <li>Costs are invoice line net values divided by packs invoiced, before any credits or retrospective discounts.</li>
        <li>Prices: NHS dm+d, Open Government Licence v3.0.</li>
      </ul>
    </details>
  </div>;
}
