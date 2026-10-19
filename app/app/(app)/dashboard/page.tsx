import Link from 'next/link';
import { loadHome, type DeliveryToCheck, type OpenClaim } from '@/lib/home/home-data';
import { daysSince, money, shortDate, supplierName } from '@/lib/goods-in/supplier';
import { Chevron, ScanIcon, SupplierBadge, Track } from '@/components/goods-in/ui';
import SupplierDonut from '@/components/home/supplier-donut';
import '@/components/goods-in/goods-in.css';
import './home.css';

const SHOWN = 6;

export default async function HomePage() {
  let data;
  try { data = await loadHome(); } catch {
    return (
      <div className="gi">
        <section className="gi-card" role="alert" style={{ padding: 20 }}>
          <h1 className="hm-title">Home is unavailable</h1>
          <p className="gi-note">Your records could not all be loaded, so no partial totals are shown. Refresh to try again.</p>
        </section>
      </div>
    );
  }
  const [next, ...rest] = data.toCheck;

  return (
    <div className="gi hm">
      <header className="hm-head">
        <h1 className="hm-title">Home</h1>
        <span className="hm-actions gi-desk">
          <Link href="/aver-slip" className="gi-btn gi-btn-quiet gi-btn-sm">Scan Aver slip</Link>
          <Link href="/upload" className="gi-btn gi-btn-quiet gi-btn-sm">Upload invoice</Link>
        </span>
      </header>

      <section className="hm-figs" aria-label="At a glance">
        <Figure className="gi-desk" href="/invoices" value={String(data.toCheckCount)} label={data.toCheckCount === 1 ? 'Delivery to check' : 'Deliveries to check'} />
        <Figure href="/credits" value={money(data.owed)} label="Money owed" />
        <Figure href="/credits" value={money(data.overdue)} label={data.overdueCount ? `Overdue · ${data.overdueCount} over 14 days` : 'Overdue'} tone={data.overdue > 0 ? 'warn' : undefined} />
        <Figure className="gi-desk" href="/statements" value={money(data.statementGap)} label="Statement differences" />
        <Figure className="gi-desk" href="/credits" value={money(data.recovered)} label={`Recovered in ${data.month}`} tone={data.recovered > 0 ? 'good' : undefined} />
      </section>

      <section className="gi-card hm-deliveries" aria-labelledby="hm-deliveries-title">
        <div className="gi-card-head">
          <h2 id="hm-deliveries-title">Deliveries to check</h2>
          <span className="gi-phone gi-aside">{data.toCheckCount ? `${data.toCheckCount} waiting` : ''}</span>
          <Link href="/invoices" className="gi-link gi-desk">All invoices</Link>
        </div>
        {!next ? (
          <>
            <p className="gi-empty">Every delivery is checked. Upload an invoice when the next one arrives, or scan the Aver slip in the box.</p>
            <div className="hm-scan gi-phone"><Link href="/aver-slip" className="gi-btn gi-btn-primary gi-btn-block"><ScanIcon />Scan Aver slip</Link></div>
          </>
        ) : (
          <>
            {/* Phones: the next delivery, a big scan button, the rest folded. */}
            <div className="gi-phone">
              <ul className="gi-rows"><li><DeliveryRow d={next} /></li></ul>
              <div className="hm-scan">
                <Link href={`/invoices/${next.id}?scan=1`} className="gi-btn gi-btn-primary gi-btn-block"><ScanIcon />Scan delivery</Link>
                <Link href="/aver-slip" className="gi-btn gi-btn-quiet gi-btn-block hm-slip">Scan Aver slip</Link>
              </div>
              {rest.length > 0 && (
                <details className="hm-fold">
                  <summary><span>{rest.length} more to check</span><Chevron down /></summary>
                  <ul className="gi-rows">{rest.map(d => <li key={d.id}><DeliveryRow d={d} /></li>)}</ul>
                </details>
              )}
            </div>
            <div className="gi-desk">
              <ul className="gi-rows">{data.toCheck.slice(0, SHOWN).map(d => <li key={d.id}><DeliveryRow d={d} /></li>)}</ul>
              {data.toCheck.length > SHOWN && <p className="hm-more"><Link href="/invoices" className="gi-link">Show all {data.toCheck.length}</Link></p>}
            </div>
          </>
        )}
      </section>

      <div className="hm-donut-slot">
        <SupplierDonut views={[
          { key: 'spend', label: 'Spend', aside: `${data.month} to date`, centre: 'spent', empty: `No invoices dated in ${data.month} yet.`, slices: data.spend },
          { key: 'owed', label: 'Money owed', aside: 'Open claims', centre: 'owed', empty: 'No open claims.', slices: data.owedBySupplier },
        ]} />
      </div>

      <section className="gi-card hm-claims" aria-labelledby="hm-claims-title">
        <div className="gi-card-head">
          <h2 id="hm-claims-title">Claims to send or chase</h2>
          <Link href="/credits" className="gi-link">Credits</Link>
        </div>
        {data.claims.length ? (
          <ul className="gi-rows">{data.claims.slice(0, SHOWN).map(c => <li key={c.id}><ClaimRow c={c} /></li>)}</ul>
        ) : <p className="gi-empty">Nothing to send or chase. Problems you record on a delivery become claims here.</p>}
        {data.claims.length > SHOWN && <p className="hm-more"><Link href="/credits" className="gi-link">Show all {data.claims.length}</Link></p>}
      </section>
    </div>
  );
}

function Figure({ value, label, href, tone, className }: { value: string; label: string; href: string; tone?: 'good' | 'warn'; className?: string }) {
  return (
    <Link href={href} className={`gi-card hm-fig${className ? ` ${className}` : ''}`}>
      <strong className={`tnum${tone ? ` is-${tone}` : ''}`}>{value}</strong>
      <span>{label}</span>
    </Link>
  );
}

function DeliveryRow({ d }: { d: DeliveryToCheck }) {
  const problems = d.issues;
  const ok = Math.max(0, d.checked - problems);
  return (
    <Link href={`/invoices/${d.id}`} className="gi-row">
      <SupplierBadge supplier={d.supplier} />
      <span style={{ minWidth: 0 }}>
        <span className="gi-row-title">{supplierName(d.supplier)} · {d.invoice_number}</span>
        <span className="gi-row-sub">
          <span>{d.lines ? <>{d.checked} of {d.lines} <span className="gi-desk">lines </span>checked</> : 'No lines read · review'}</span>
          {problems > 0 && <span className="gi-status"><i className="gi-dot is-warn" />{problems} {problems === 1 ? 'problem' : 'problems'}</span>}
        </span>
        <Track total={d.lines} good={ok} warn={problems} />
      </span>
      <span className="gi-row-fig">
        <strong>{money(d.gross_total)}</strong>
        <small>{shortDate(d.invoice_date)}</small>
      </span>
      <Chevron />
    </Link>
  );
}

function ClaimRow({ c }: { c: OpenClaim }) {
  const waited = c.sent_at ? daysSince(c.sent_at) : 0;
  const status = c.status === 'draft'
    ? <span className="gi-status"><i className="gi-dot is-open" />Draft · ready to send</span>
    : c.overdue
    ? <span className="gi-status"><i className="gi-dot is-warn" />Overdue · sent {c.sent_at ? shortDate(c.sent_at) : ''}, {waited} days</span>
    : <span className="gi-status"><i className="gi-dot" />Sent {c.sent_at ? `${shortDate(c.sent_at)} · ${waited} ${waited === 1 ? 'day' : 'days'}` : '· no date recorded'}</span>;
  return (
    <Link href="/credits" className="gi-row">
      <SupplierBadge supplier={c.supplier} />
      <span style={{ minWidth: 0 }}>
        <span className="gi-row-title">{supplierName(c.supplier)}</span>
        <span className="gi-row-sub">{status}</span>
      </span>
      <span className="gi-row-fig"><strong className={c.overdue ? 'hm-warn-ink' : undefined}>{money(c.total)}</strong></span>
      <Chevron />
    </Link>
  );
}
