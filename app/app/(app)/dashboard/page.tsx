/**
 * Dashboard — the morning briefing.
 *
 * Surfaces the operational state of the pharmacy in a single view:
 *   1. KPI strip (deliveries today, reconciled, credit queue, unchased >14d)
 *   2. Today's deliveries (top 6, status badges)
 *   3. Credits waiting on suppliers (oldest first)
 *   4. Saving this month (sum of resolved credit_requests)
 *
 * Every metric is derived from real columns in the database — no fictional
 * percentages, no placeholder fields. If a section has no data, it gets a
 * concise empty state rather than fabricating "0%".
 *
 * All four queries fire in parallel via Promise.all so total render time is
 * bounded by the slowest single query, not the sum of all four.
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

const supplierLabels: Record<string, string> = {
  aah: 'AAH', aver: 'Aver', phoenix: 'Phoenix',
  alliance: 'Alliance', ethigen: 'Ethigen', numark: 'Numark',
};

// ────────────────────────────────────────────────────────────────────
// Date helpers — UK timezone is implicit (Vercel runs UTC, but for our
// pharmacy users a "today" boundary at midnight UTC is close enough to
// midnight London for the purposes of the dashboard).
// ────────────────────────────────────────────────────────────────────

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function fourteenDaysAgoISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString();
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// ────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  // Fire all five queries in parallel — no waterfalls.
  // The membership query is folded in here so the greeting can use the
  // user's chosen display_name without an extra round-trip.
  const [
    membershipRes,
    invoicesRes,
    flaggedLinesRes,
    creditRequestsRes,
    resolvedCreditsRes,
  ] = await Promise.all([
    supabase
      .from('pharmacy_memberships')
      .select('display_name')
      .eq('user_id', user?.id ?? '')
      .limit(1),
    // 1) All open invoices with their lines (so we can compute reconciled
    // status from line flags). Sorted desc so the preview shows newest first.
    supabase
      .from('invoices')
      .select(`
        id, supplier, invoice_number, invoice_date, gross_total, created_at,
        invoice_lines ( flags )
      `)
      .is('deleted_at', null)
      .order('invoice_date', { ascending: false }),

    // 2) Lines flagged but NOT yet on a credit request — the chase backlog.
    // Supplier comes from the joined invoice so the per-supplier breakdown
    // can attribute pending credits.
    supabase
      .from('invoice_lines')
      .select('id, gross, flags, invoices!inner(supplier, deleted_at)')
      .is('credit_request_id', null)
      .not('flags', 'eq', '{}'),

    // 3) All open credit requests — used for unchased >14d KPI + waiting list.
    supabase
      .from('credit_requests')
      .select('id, supplier, status, total_amount, sent_at, email_to, email_subject, email_body')
      .in('status', ['sent', 'overdue'])
      .order('sent_at', { ascending: true, nullsFirst: false }),

    // 4) Resolved credit requests in current calendar month — money recovered.
    supabase
      .from('credit_requests')
      .select('total_amount')
      .eq('status', 'resolved')
      .gte('resolved_at', startOfMonthISO()),
  ]);

  // Derive first name: display_name → first word; fallback to email prefix.
  const displayName = (membershipRes.data?.[0]?.display_name as string | null) ?? null;
  const greetName = displayName
    ? (displayName.split(' ')[0] ?? displayName)
    : (() => {
        const prefix = (user?.email ?? '').split('@')[0]!.split('.')[0]!;
        return prefix.charAt(0).toUpperCase() + prefix.slice(1);
      })();

  const errors = [
    invoicesRes.error,
    flaggedLinesRes.error,
    creditRequestsRes.error,
    resolvedCreditsRes.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    return <DashboardError messages={errors.map(e => e!.message)} />;
  }

  const invoices = (invoicesRes.data ?? []) as Array<{
    id: string; supplier: string; invoice_number: string; invoice_date: string;
    gross_total: number | string; created_at: string;
    invoice_lines: Array<{ flags: string[] }>;
  }>;

  const flaggedLinesRaw = (flaggedLinesRes.data ?? []) as unknown as Array<{
    id: string; gross: number | string; flags: string[];
    invoices: { supplier: string; deleted_at: string | null } | { supplier: string; deleted_at: string | null }[];
  }>;
  const flaggedLines = flaggedLinesRaw
    .map(l => {
      const inv = Array.isArray(l.invoices) ? l.invoices[0] : l.invoices;
      return inv ? { id: l.id, gross: l.gross, flags: l.flags, supplier: inv.supplier, deleted_at: inv.deleted_at } : null;
    })
    .filter((l): l is { id: string; gross: number | string; flags: string[]; supplier: string; deleted_at: string | null } => l !== null && !l.deleted_at);

  const creditRequests = (creditRequestsRes.data ?? []) as Array<{
    id: string; supplier: string; status: string; total_amount: number | string;
    sent_at: string | null;
    email_to: string | null; email_subject: string | null; email_body: string | null;
  }>;

  const resolvedThisMonth = (resolvedCreditsRes.data ?? []) as Array<{
    total_amount: number | string;
  }>;

  // ─── KPI 1: Deliveries today ─────────────────────────────────────
  const todayStart = startOfTodayISO();
  const invoicesToday = invoices.filter(i => i.created_at >= todayStart);
  const suppliersToday = new Set(invoicesToday.map(i => i.supplier)).size;

  // ─── KPI 2: Reconciled — invoices where every line has empty flags ──
  const reconciledCount = invoices.filter(inv => {
    if (inv.invoice_lines.length === 0) return false;
    return inv.invoice_lines.every(l => (l.flags ?? []).length === 0);
  }).length;
  const reconciledPct = invoices.length === 0
    ? 0
    : Math.round((reconciledCount / invoices.length) * 100);

  // ─── KPI 3: Credit queue — flagged lines not yet on a credit request ──
  const creditQueueCount = flaggedLines.length;
  const creditQueueGross = flaggedLines.reduce(
    (sum, l) => sum + Number(l.gross),
    0,
  );

  // ─── KPI 4: Credits unchased >14d ─────────────────────────────────
  const fourteen = fourteenDaysAgoISO();
  const unchased = creditRequests.filter(
    r => r.sent_at !== null && r.sent_at < fourteen,
  );
  const unchasedTotal = unchased.reduce(
    (sum, r) => sum + Number(r.total_amount),
    0,
  );
  const unchasedOldestSentAt = unchased.length > 0
    ? unchased
        .map(r => r.sent_at!)
        .reduce((oldest, x) => (x < oldest ? x : oldest))
    : null;

  // ─── Saving this month ───────────────────────────────────────────
  const savedThisMonth = resolvedThisMonth.reduce(
    (sum, r) => sum + Number(r.total_amount),
    0,
  );

  // ─── Today's deliveries preview ──────────────────────────────────
  const todaysDeliveriesPreview = invoicesToday.length > 0
    ? invoicesToday.slice(0, 6)
    : invoices.slice(0, 6); // fallback: most recent 6 if nothing today

  // ─── Credits waiting on suppliers ────────────────────────────────
  const waitingOnSuppliers = creditRequests
    .filter(r => r.sent_at !== null) // skip drafts
    .slice(0, 5);

  // ─── Total flagged lines today (for greeting line) ───────────────
  const flaggedTotal = flaggedLines.length;

  const isFreshAccount = invoices.length === 0;

  // ─── Per-supplier breakdown ──────────────────────────────────────
  // Aggregates invoices/lines/pending/outstanding into one row per supplier
  // so a pharmacist can see at a glance which wholesaler needs attention.
  // Sorted by attention-needed (pending + outstanding £) descending.
  type SupplierRow = {
    supplier: string;
    invoiceCount: number;
    totalLines: number;
    cleanLines: number;
    pendingGross: number;
    outstandingTotal: number;
    outstandingCount: number;
  };
  const supplierMap = new Map<string, SupplierRow>();
  function ensureRow(s: string): SupplierRow {
    let r = supplierMap.get(s);
    if (!r) {
      r = {
        supplier: s,
        invoiceCount: 0,
        totalLines: 0,
        cleanLines: 0,
        pendingGross: 0,
        outstandingTotal: 0,
        outstandingCount: 0,
      };
      supplierMap.set(s, r);
    }
    return r;
  }
  for (const inv of invoices) {
    const r = ensureRow(inv.supplier);
    r.invoiceCount += 1;
    r.totalLines += inv.invoice_lines.length;
    r.cleanLines += inv.invoice_lines.filter(l => (l.flags ?? []).length === 0).length;
  }
  for (const fl of flaggedLines) {
    const r = ensureRow(fl.supplier);
    r.pendingGross += Number(fl.gross);
  }
  for (const cr of creditRequests) {
    const r = ensureRow(cr.supplier);
    r.outstandingTotal += Number(cr.total_amount);
    r.outstandingCount += 1;
  }
  const supplierBreakdown = [...supplierMap.values()]
    .filter(r => r.invoiceCount > 0 || r.pendingGross > 0 || r.outstandingTotal > 0)
    .sort((a, b) => {
      const aAttn = a.pendingGross + a.outstandingTotal;
      const bAttn = b.pendingGross + b.outstandingTotal;
      if (bAttn !== aAttn) return bAttn - aAttn;
      // tiebreak: more invoices first, then alphabetical
      if (b.invoiceCount !== a.invoiceCount) return b.invoiceCount - a.invoiceCount;
      return a.supplier.localeCompare(b.supplier);
    });

  return (
    <div>
      {/* ─── Greeting + quick-add bar ──────────────────────────── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '1.5rem',
          marginBottom: '1.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p
            className="section-label"
            style={{ marginBottom: '0.5rem' }}
          >
            {new Date().toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
          <h1
            style={{
              fontSize: '26px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              margin: 0,
              marginBottom: '0.375rem',
            }}
          >
            Good morning, {greetName}.
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
            {isFreshAccount ? (
              <>No invoices yet. <Link href="/upload" style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}>Upload your first PDF</Link> to get started.</>
            ) : (
              <>
                {invoicesToday.length > 0
                  ? `${invoicesToday.length} ${pluralize(invoicesToday.length, 'invoice')} uploaded today`
                  : 'Nothing uploaded today'}
                {flaggedTotal > 0 && <> · <strong style={{ color: 'var(--foreground)', fontWeight: 600 }}>{flaggedTotal} {pluralize(flaggedTotal, 'line')}</strong> flagged for review</>}
              </>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
          <Link
            href="/upload?type=invoice"
            className="btn btn-secondary"
            style={{ gap: '0.375rem' }}
          >
            <PlusIcon /> Invoice
          </Link>
          <Link
            href="/upload?type=statement"
            className="btn btn-secondary"
            style={{ gap: '0.375rem' }}
          >
            <PlusIcon /> Statement
          </Link>
        </div>
      </header>

      {/* ─── KPI Strip ──────────────────────────────────────────── */}
      <section className="dash-kpi-grid">
        <Kpi
          label="Deliveries today"
          value={String(invoicesToday.length)}
          sub={
            invoicesToday.length === 0
              ? 'none'
              : `from ${suppliersToday} ${pluralize(suppliersToday, 'supplier')}`
          }
        />
        <Kpi
          label="Reconciled"
          value={`${reconciledCount} of ${invoices.length}`}
          sub={invoices.length === 0 ? 'no invoices yet' : `${reconciledPct}%`}
        />
        <Kpi
          label="Lines to chase"
          value={String(creditQueueCount)}
          sub={
            creditQueueCount === 0
              ? 'nothing flagged'
              : `£${creditQueueGross.toFixed(2)} across ${creditQueueCount} ${pluralize(creditQueueCount, 'line')}`
          }
        />
        <Kpi
          label="Unchased > 14d"
          value={String(unchased.length)}
          sub={
            unchased.length === 0
              ? 'all current'
              : `£${unchasedTotal.toFixed(2)} · oldest ${shortDate(unchasedOldestSentAt!)}`
          }
          tone={unchased.length > 0 ? 'critical' : 'neutral'}
        />
      </section>

      {/* ─── Per-supplier breakdown ──────────────────────────────── */}
      {supplierBreakdown.length >= 2 && (
        <section className="card" style={{ overflow: 'hidden', marginBottom: '1.5rem' }}>
          <div style={{ padding: '1.125rem 1.25rem 0.5rem' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0, marginBottom: '0.25rem' }}>
              By supplier
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
              Where attention is needed first.
            </p>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="num">Invoices</th>
                  <th className="num">Reconciled</th>
                  <th className="num">Pending</th>
                  <th className="num">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {supplierBreakdown.map(row => {
                  const reconciledPct = row.totalLines === 0
                    ? null
                    : Math.round((row.cleanLines / row.totalLines) * 100);
                  return (
                    <tr key={row.supplier}>
                      <td>{supplierLabels[row.supplier] ?? row.supplier}</td>
                      <td className="num">{row.invoiceCount}</td>
                      <td className="num">
                        {reconciledPct === null ? '—' : `${reconciledPct}%`}
                      </td>
                      <td className="num">
                        {row.pendingGross === 0
                          ? <span style={{ color: 'var(--muted-light)' }}>—</span>
                          : `£${row.pendingGross.toFixed(2)}`}
                      </td>
                      <td className="num">
                        {row.outstandingTotal === 0
                          ? <span style={{ color: 'var(--muted-light)' }}>—</span>
                          : (
                            <>
                              £{row.outstandingTotal.toFixed(2)}
                              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                                {' '}· {row.outstandingCount} {pluralize(row.outstandingCount, 'request')}
                              </span>
                            </>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ─── Two-column body: deliveries (left) + waiting/saved (right) ─ */}
      <div className="dash-body-grid">
        {/* ─── Today's deliveries ──────────────────────────────── */}
        <section className="card" style={{ overflow: 'hidden' }}>
          <div
            style={{
              padding: '1.125rem 1.25rem 0.875rem',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: '1rem',
            }}
          >
            <div>
              <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0, marginBottom: '0.25rem' }}>
                {invoicesToday.length > 0 ? "Today's deliveries" : 'Recent deliveries'}
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
                {todaysDeliveriesPreview.length === 0
                  ? 'Nothing here yet — uploaded invoices will land here.'
                  : 'Tap a row to start reconciling.'}
              </p>
            </div>
            {invoices.length > 0 && (
              <Link href="/invoices" style={{ fontSize: '12px', color: 'var(--muted)' }}>
                View all →
              </Link>
            )}
          </div>

          {todaysDeliveriesPreview.length === 0 ? (
            <DeliveriesEmpty />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Invoice #</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {todaysDeliveriesPreview.map(inv => {
                  const lineCount = inv.invoice_lines.length;
                  const fullCount = inv.invoice_lines.filter(
                    l => (l.flags ?? []).length === 0,
                  ).length;
                  const exceptionCount = lineCount - fullCount;
                  const allFull = lineCount > 0 && exceptionCount === 0;
                  const label = lineCount === 0
                    ? 'Pending'
                    : allFull
                    ? 'All received'
                    : `${exceptionCount} ${pluralize(exceptionCount, 'flag')}`;
                  const badgeClass = lineCount === 0
                    ? 'badge badge-neutral'
                    : allFull
                    ? 'badge badge-success'
                    : 'badge badge-warning';
                  const href = `/invoices/${inv.id}`;
                  return (
                    <tr key={inv.id} style={{ cursor: 'pointer' }}>
                      <td>
                        <Link href={href} className="row-link" style={{ color: 'var(--muted)' }}>
                          {supplierLabels[inv.supplier] ?? inv.supplier}
                        </Link>
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        <Link href={href} className="row-link">
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="num" style={{ fontWeight: 500 }}>
                        £{Number(inv.gross_total).toFixed(2)}
                      </td>
                      <td>
                        <span className={badgeClass}>{label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* ─── Right column: saved + waiting ───────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Saving this month */}
          <section
            className="card card-padded"
            style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          >
            <p className="section-label" style={{ margin: 0 }}>
              Recovered this month
            </p>
            <p
              style={{
                fontSize: '28px',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                margin: 0,
                fontVariantNumeric: 'tabular-nums',
                color: savedThisMonth > 0 ? 'var(--brand)' : 'var(--foreground)',
              }}
            >
              £{savedThisMonth.toFixed(2)}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
              {savedThisMonth === 0
                ? 'Nothing recovered yet this month.'
                : `from ${resolvedThisMonth.length} ${pluralize(resolvedThisMonth.length, 'credit')} resolved`}
            </p>
          </section>

          {/* Credits waiting on suppliers */}
          <section className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '1.125rem 1.25rem 0.5rem' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0, marginBottom: '0.25rem' }}>
                Waiting on suppliers
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
                Oldest first.
              </p>
            </div>

            {waitingOnSuppliers.length === 0 ? (
              <div style={{ padding: '0.5rem 1.25rem 1.25rem' }}>
                <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
                  Nothing pending.
                </p>
              </div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {waitingOnSuppliers.map((r, i) => {
                  const days = daysAgo(r.sent_at);
                  const isStale = days !== null && days > 14;
                  return (
                    <li
                      key={r.id}
                      style={{
                        padding: '0.75rem 1.25rem',
                        borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.75rem',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            marginBottom: '0.125rem',
                          }}
                        >
                          <span style={{ fontSize: '13px', fontWeight: 500 }}>
                            {supplierLabels[r.supplier] ?? r.supplier}
                          </span>
                          <span
                            className={isStale ? 'badge badge-critical' : 'badge badge-neutral'}
                            style={{ fontSize: '10px' }}
                          >
                            {days === null
                              ? 'unsent'
                              : days === 0
                              ? 'today'
                              : `${days}d`}
                          </span>
                        </div>
                        <p
                          style={{
                            fontSize: '11px',
                            color: 'var(--muted)',
                            margin: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {r.email_subject ?? 'Credit request'}
                        </p>
                      </div>
                      <span
                        className="num"
                        style={{
                          fontSize: '13px',
                          fontWeight: 500,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        £{Number(r.total_amount).toFixed(2)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {creditRequests.length > 0 && (
              <div
                style={{
                  padding: '0.625rem 1.25rem',
                  borderTop: '1px solid var(--border-subtle)',
                  background: 'var(--surface-raised)',
                }}
              >
                <Link
                  href="/credits"
                  style={{ fontSize: '12px', color: 'var(--muted)' }}
                >
                  View all credits →
                </Link>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function pluralize(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'neutral' | 'critical';
}) {
  return (
    <div
      className="card"
      style={{
        padding: '1rem 1.125rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.375rem',
        minHeight: '5.25rem',
      }}
    >
      <p
        className="section-label"
        style={{ margin: 0, fontSize: '10px', letterSpacing: '0.06em' }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: '24px',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: 0,
          fontVariantNumeric: 'tabular-nums',
          color: tone === 'critical'
            ? 'var(--status-critical-text)'
            : 'var(--foreground)',
          lineHeight: 1.1,
        }}
      >
        {value}
      </p>
      <p
        style={{
          fontSize: '11px',
          color: 'var(--muted)',
          margin: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {sub}
      </p>
    </div>
  );
}

function DeliveriesEmpty() {
  return (
    <div
      style={{
        padding: '2.5rem 1.5rem',
        textAlign: 'center',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <p style={{ fontSize: '13px', fontWeight: 500, margin: 0, marginBottom: '0.25rem' }}>
        Nothing to reconcile yet
      </p>
      <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, marginBottom: '1rem', lineHeight: 1.5 }}>
        Drop in a wholesaler invoice PDF and Reckon will match it
        line-by-line against what you actually received.
      </p>
      <Link href="/upload" className="btn btn-primary btn-sm">
        Upload PDFs
      </Link>
    </div>
  );
}

function DashboardError({ messages }: { messages: string[] }) {
  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: '1rem' }}>
        Dashboard
      </h1>
      <div
        style={{
          padding: '1rem 1.25rem',
          borderRadius: '0.5rem',
          background: 'var(--status-critical-bg)',
          border: '1px solid var(--status-critical-border)',
          color: 'var(--status-critical-text)',
        }}
      >
        <p style={{ fontSize: '13px', fontWeight: 500, margin: 0, marginBottom: '0.25rem' }}>
          Couldn&apos;t load dashboard
        </p>
        {messages.map((m, i) => (
          <p key={i} style={{ fontSize: '12px', margin: 0 }}>
            {m}
          </p>
        ))}
        <p style={{ fontSize: '12px', margin: 0, marginTop: '0.5rem' }}>
          If this mentions <code>credit_requests</code> or <code>damage_disposition</code>,
          apply migrations 0002 and 0003 in the Supabase SQL editor.
        </p>
      </div>
    </div>
  );
}
