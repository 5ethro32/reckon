import type { Period } from '@/lib/period';
/** Plain GET form so the period is in the URL and works without client script. */
export function PeriodFilter({ period, action }: { period: Period; action: string }) {
  return (
    <form method="get" action={action} className="filter-bar" style={{ alignItems: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
      <label className="label" style={{ margin: 0 }}>From<input className="input" type="date" name="from" defaultValue={period.from} required /></label>
      <label className="label" style={{ margin: 0 }}>To<input className="input" type="date" name="to" defaultValue={period.to} required /></label>
      <button type="submit" className="btn btn-secondary">Apply</button>
      <span className="ops-muted">Invoices by invoice date, claims by send date, statements by statement date.</span>
    </form>
  );
}
