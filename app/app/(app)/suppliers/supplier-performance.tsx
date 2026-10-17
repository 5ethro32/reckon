import { loadSupplierPerformance } from '@/lib/margin-data';
import { periodQuery, type Period } from '@/lib/period';
import { COMPONENTS, SCORE_FORMULA, scoreSupplier } from '@/lib/supplier-score';
import { PeriodFilter } from '../period-filter';

const n = (v: number | string | null | undefined) => v === null || v === undefined ? 0 : Number(v);
const show = (v: number | null) => v === null ? '–' : String(v);

/** Supplier ratings for a period, with every component and the formula shown beside the score. */
export default async function SupplierPerformance({ period }: { period: Period }) {
  let rows;
  try { rows = await loadSupplierPerformance(period); } catch {
    return <section className="card ops-panel" role="alert" style={{ marginBottom: '1.5rem' }}><h2>Performance unavailable</h2><p className="ops-muted">We couldn’t load supplier performance. If this is a new installation, apply database update 0020, then refresh.</p></section>;
  }
  const many = new Set(rows.map((r) => r.pharmacy_id)).size > 1;
  const scored = rows.map((r) => ({ r, s: scoreSupplier(r) })).sort((a, b) => (b.s.score ?? -1) - (a.s.score ?? -1) || a.r.supplier.localeCompare(b.r.supplier));
  return (
    <section className="card ops-panel" style={{ marginBottom: '1.5rem' }}>
      <div className="ops-heading"><div><h2>Performance</h2><p className="ops-muted">From your recorded receipts, claims, invoices and statements. Each component is 0 to 100; higher is better.</p></div>
        <a className="btn btn-secondary" href={`/api/reports/supplier-performance?${periodQuery(period)}`}>Download CSV</a></div>
      <PeriodFilter period={period} action="/suppliers" />
      <div className="table-scroll"><table className="table"><caption className="sr-only">Supplier performance scores and components</caption>
        <thead><tr><th>Supplier</th>{many && <th>Pharmacy ID</th>}<th className="num">Score</th>{COMPONENTS.map((c) => <th key={c.key} className="num" title={c.formula}>{c.label}</th>)}<th className="num">Short lines</th><th className="num">Damaged or returned</th><th className="num">Claims resolved</th><th className="num">Average days to resolve</th><th className="num">Open over 14 days</th><th className="num">Invoice total mismatches</th><th className="num">Statements with a variance</th></tr></thead>
        <tbody>{scored.map(({ r, s }) => <tr key={r.pharmacy_id + r.supplier}>
          <th scope="row">{r.supplier.toUpperCase()}</th>{many && <td><span title={r.pharmacy_id}>{r.pharmacy_id.slice(0, 8)}</span></td>}
          <td className="num"><strong>{show(s.score)}</strong></td>
          {COMPONENTS.map((c) => <td key={c.key} className="num">{show(s.components[c.key])}</td>)}
          <td className="num">{n(r.short_lines)} of {n(r.checked_lines)}</td>
          <td className="num">{n(r.damaged_lines) + n(r.returned_lines)}</td>
          <td className="num">{n(r.claims_resolved)} of {n(r.claims_sent)}</td>
          <td className="num">{r.avg_turnaround_days === null || r.avg_turnaround_days === undefined ? '–' : Number(r.avg_turnaround_days).toFixed(1)}</td>
          <td className="num">{n(r.claims_open_overdue)}</td>
          <td className="num">{n(r.invoices_mismatched)} of {n(r.invoices)}</td>
          <td className="num">{n(r.statements_with_variance)} of {n(r.statements)}</td>
        </tr>)}</tbody></table>
        {!rows.length && <p className="ops-empty">No invoices, claims or statements in this period.</p>}</div>
      <h3 style={{ marginTop: '1.25rem' }}>How the score is worked out</h3>
      <p className="ops-muted">{SCORE_FORMULA} A component with no data in the period, shown as –, is left out.</p>
      <ul className="ops-muted">{COMPONENTS.map((c) => <li key={c.key}><strong>{c.label}</strong> (weight {c.weight}): {c.formula}.</li>)}</ul>
      <p className="ops-muted">Lines count once they are checked. Price compares only lines matched to a dm+d pack, against the lowest price paid for that pack by this pharmacy in the period. Claims are dated by when they were sent; cancelled claims are excluded.</p>
    </section>
  );
}
