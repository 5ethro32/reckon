import { loadSupplierPerformance } from '@/lib/margin-data';
import { periodQuery, type Period } from '@/lib/period';
import { COMPONENTS, SCORE_FORMULA, scoreSupplier } from '@/lib/supplier-score';
import { PeriodFilter } from '../period-filter';
import { SupplierTag } from '../ui';

const n = (v: number | string | null | undefined) => v === null || v === undefined ? 0 : Number(v);
const show = (v: number | null) => v === null ? '–' : String(v);

/** Supplier ratings for a period, with every component and the formula shown beside the score. */
export default async function SupplierPerformance({ period }: { period: Period }) {
  let rows;
  try { rows = await loadSupplierPerformance(period); } catch {
    return <section className="card notice" role="alert" style={{ marginBottom: '1.5rem' }}><strong>Ratings did not load</strong><p>If this is a new installation, apply database update 0020, then refresh.</p></section>;
  }
  const many = new Set(rows.map((r) => r.pharmacy_id)).size > 1;
  const scored = rows.map((r) => ({ r, s: scoreSupplier(r) })).sort((a, b) => (b.s.score ?? -1) - (a.s.score ?? -1) || a.r.supplier.localeCompare(b.r.supplier));
  return (
    <section className="card" style={{ marginBottom: '1.5rem', overflow: 'hidden' }} aria-labelledby="ratings">
      <div className="card-head">
        <h2 id="ratings">Ratings</h2>
        <a className="quiet-link" href={`/api/reports/supplier-performance?${periodQuery(period)}`}>Download CSV</a>
      </div>
      <div style={{ padding: '0 1.25rem' }}>
        <PeriodFilter period={period} action="/suppliers" />
      </div>
      <div className="table-scroll"><table className="table rows"><caption className="sr-only">Supplier ratings and their parts</caption>
        <thead><tr><th>Supplier</th>{many && <th>Pharmacy ID</th>}<th className="num">Score</th>{COMPONENTS.map((c) => <th key={c.key} className="num" title={c.formula}>{c.label}</th>)}<th className="num">Short lines</th><th className="num">Damaged or returned</th><th className="num">Claims resolved</th><th className="num">Average days to resolve</th><th className="num">Open over 14 days</th><th className="num">Invoice total mismatches</th><th className="num">Statements with a variance</th></tr></thead>
        <tbody>{scored.map(({ r, s }) => <tr key={r.pharmacy_id + r.supplier}>
          <th scope="row" className="c-title"><SupplierTag code={r.supplier} /></th>{many && <td className="c-hide"><span title={r.pharmacy_id}>{r.pharmacy_id.slice(0, 8)}</span></td>}
          <td className="num c-value"><strong>{show(s.score)}</strong><span className="c-phone text-faint" style={{ fontWeight: 400 }}> / 100</span></td>
          {COMPONENTS.map((c) => <td key={c.key} className="num c-hide">{show(s.components[c.key])}</td>)}
          <td className="num c-meta">{n(r.short_lines)} of {n(r.checked_lines)}<span className="c-phone"> short</span></td>
          <td className="num c-hide">{n(r.damaged_lines) + n(r.returned_lines)}</td>
          <td className="num c-meta">{n(r.claims_resolved)} of {n(r.claims_sent)}<span className="c-phone"> claims resolved</span></td>
          <td className="num c-hide">{r.avg_turnaround_days === null || r.avg_turnaround_days === undefined ? '–' : Number(r.avg_turnaround_days).toFixed(1)}</td>
          <td className="num c-hide">{n(r.claims_open_overdue)}</td>
          <td className="num c-hide">{n(r.invoices_mismatched)} of {n(r.invoices)}</td>
          <td className="num c-hide">{n(r.statements_with_variance)} of {n(r.statements)}</td>
        </tr>)}</tbody></table>
        {!rows.length && <p className="card-empty" style={{ paddingTop: '1rem' }}>No invoices, claims or statements in this period.</p>}</div>
      <details className="method">
        <summary>How the score is worked out</summary>
        <p>{SCORE_FORMULA} A part with no data in the period, shown as –, is left out.</p>
        <ul>{COMPONENTS.map((c) => <li key={c.key}><strong>{c.label}</strong> (weight {c.weight}): {c.formula}.</li>)}</ul>
        <p>Lines count once they are checked. Price compares only lines matched to a dm+d pack, against the lowest price paid for that pack by this pharmacy in the period. Claims are dated by when they were sent; cancelled claims are excluded. The phone view shows the score and two parts; the CSV has every column.</p>
      </details>
    </section>
  );
}
