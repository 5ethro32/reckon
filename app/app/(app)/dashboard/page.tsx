import Link from 'next/link';
import { loadOperations } from '@/lib/operations-data';

const money = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
export default async function DashboardPage() {
  let data;
  try { data = await loadOperations(); } catch {
    return <section className="card ops-panel" role="alert"><h1 className="page-title">Overview unavailable</h1><p>We couldn’t load all your records. Refresh to try again. No partial totals are shown.</p></section>;
  }
  const pending = data.receipts.filter(r => !r.lines || r.pending > 0).sort((a,b) => a.created_at.localeCompare(b.created_at));
  const exceptions = data.receipts.filter(r => r.exceptions > 0);
  const openTotal = data.openClaims.reduce((s,c) => s + Number(c.total_amount),0);
  const waiting = data.agedClaims.sort((a,b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''));
  return <div className="operations-overview">
    <header className="ops-heading"><div><p className="section-label">Your pharmacy workspace</p><h1 className="page-title">Receive. Check. Follow up.</h1><p className="ops-muted">Uploaded invoices and outstanding credits, across pharmacies you can access.</p></div><Link href="/upload" className="btn btn-primary">Upload documents</Link></header>
    <section className="dash-kpi-grid" aria-label="Work to do">
      <Metric title="Receipts to finish" value={String(pending.length)} detail="Invoices with unchecked or missing lines" href="/invoices" />
      <Metric title="Receipts with issues" value={String(exceptions.length)} detail="Quantity differences or flagged lines" href="/invoices" />
      <Metric title="Credit requests" value={money(openTotal)} detail={`${data.openClaims.length} draft or sent · not money recovered`} href="/credits" />
      <Metric title="Claims to review" value={String(waiting.length)} detail="Marked overdue or open for 14 days" href="/credits" />
    </section>
    <div className="dash-body-grid">
      <section className="card ops-panel"><div className="ops-heading"><div><h2>Finish receiving</h2><p className="ops-muted">Oldest uploads first. An upload does not confirm delivery.</p></div><Link href="/invoices">All invoices →</Link></div>
      {pending.length ? <ul className="ops-list">{pending.slice(0,8).map(r => <li key={r.id}><Link href={`/invoices/${r.id}`} className="ops-receipt"><div><strong>{r.supplier.toUpperCase()} · {r.invoice_number}</strong><span className="ops-muted">Invoice {r.invoice_date} · {money(Number(r.gross_total))}</span></div><span className="badge badge-warning">{r.lines ? `${r.pending} unchecked` : 'No lines — review'}</span></Link></li>)}</ul> : <div className="ops-empty"><h3>{data.receipts.length ? 'No unchecked receipts' : 'Start with an invoice'}</h3><p>{data.receipts.length ? 'Recorded quantities are complete. Review any issues separately.' : 'Upload a supplier invoice, then open it to scan packs or record quantities.'}</p><Link className="btn btn-secondary" href={data.receipts.length ? '/invoices' : '/upload'}>{data.receipts.length ? 'Review receipts' : 'Upload an invoice'}</Link></div>}
      </section>
      <section className="card ops-panel"><h2>Review outstanding claims</h2><p className="ops-muted">Age is measured from the recorded send date, not the last chase.</p>{waiting.length ? <ul className="ops-list">{waiting.slice(0,6).map(c => <li key={c.id}><Link href="/credits" className="ops-receipt"><div><strong>{c.supplier.toUpperCase()}</strong><span className="ops-muted">{c.sent_at ? `Sent ${new Date(c.sent_at).toLocaleDateString('en-GB',{timeZone:'Europe/London'})}` : 'No send date recorded'}</span></div><strong>{money(Number(c.total_amount))}</strong></Link></li>)}</ul> : <div className="ops-empty"><p>No claims currently meet this review threshold.</p></div>}<Link className="btn btn-secondary" href="/credits">Review credit requests</Link></section>
    </div>
    <section className="card ops-panel ops-suppliers"><div className="ops-heading"><div><h2>Supplier overview</h2><p className="ops-muted">All uploaded history. Invoice gross includes VAT; requests are not confirmed credits or savings.</p></div><a className="btn btn-secondary" href="/api/reports/suppliers">Download CSV</a></div><div className="table-scroll"><table className="table"><caption className="sr-only">Invoice and receipt work by supplier and pharmacy</caption><thead><tr><th>Supplier</th><th>Pharmacy ID</th><th className="num">Invoice gross</th><th className="num">Unchecked lines</th><th className="num">Issue lines</th><th className="num">Open credits</th></tr></thead><tbody>{data.suppliers.map(r => <tr key={r.pharmacy+r.supplier}><th scope="row">{r.supplier.toUpperCase()}</th><td><span title={r.pharmacy}>{r.pharmacy.slice(0,8)}</span></td><td className="num">{money(r.invoiceGross)}</td><td className="num">{r.pending}</td><td className="num">{r.exceptions}</td><td className="num">{money(r.claimTotal)}</td></tr>)}</tbody></table>{!data.suppliers.length && <p className="ops-empty">Your supplier summary will appear after an upload.</p>}</div></section>
    <p className="ops-muted">Receipt checks, credit reconciliation and physical put-away are separate steps. This overview does not represent live stock or pharmacy profit.</p>
  </div>;
}
function Metric({title,value,detail,href}:{title:string;value:string;detail:string;href:string}) {
  return <Link href={href} className="card ops-metric"><span className="section-label">{title}</span><strong>{value}</strong><span className="ops-muted">{detail}</span></Link>;
}
