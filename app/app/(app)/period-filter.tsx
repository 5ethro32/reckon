import type { Period } from '@/lib/period';

/** Plain GET form so the period is in the URL and works without client script. */
export function PeriodFilter({ period, action }: { period: Period; action: string }) {
  return (
    <form method="get" action={action} className="period-filter">
      <label>
        <span>From</span>
        <input className="input" type="date" name="from" defaultValue={period.from} required />
      </label>
      <label>
        <span>To</span>
        <input className="input" type="date" name="to" defaultValue={period.to} required />
      </label>
      <button type="submit" className="btn btn-secondary">Show</button>
    </form>
  );
}
