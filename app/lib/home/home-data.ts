import { getRequestClient } from '@/lib/session';
import { monthStart } from '@/lib/goods-in/supplier';

/** A delivery (invoice) with lines still to check. */
export type DeliveryToCheck = {
  id: string; supplier: string; invoice_number: string; invoice_date: string;
  gross_total: number; lines: number; checked: number; issues: number;
};
export type OpenClaim = {
  id: string; supplier: string; status: 'draft' | 'sent' | 'overdue';
  total: number; sent_at: string | null; created_at: string; overdue: boolean;
};
export type SupplierSlice = { supplier: string; value: number };
export type HomeData = {
  month: string;
  toCheck: DeliveryToCheck[];
  toCheckCount: number;
  owed: number;
  overdue: number;
  overdueCount: number;
  statementGap: number;
  statementGapCount: number;
  recovered: number;
  recoveredCount: number;
  claims: OpenClaim[];
  spend: SupplierSlice[];
  owedBySupplier: SupplierSlice[];
};

const OVERDUE_MS = 14 * 86400000;

function bySupplier(rows: { supplier: string; value: number }[]): SupplierSlice[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = r.supplier.trim().toLowerCase();
    map.set(key, (map.get(key) ?? 0) + r.value);
  }
  return [...map].map(([supplier, value]) => ({ supplier, value: Math.round(value * 100) / 100 }))
    .filter(s => s.value > 0).sort((a, b) => b.value - a.value);
}

/**
 * Everything Home shows, in four parallel reads. RLS limits each to the
 * pharmacies the signed-in user belongs to.
 */
export async function loadHome(now = new Date()): Promise<HomeData> {
  const db = await getRequestClient();
  const start = monthStart(now);
  const [deliveries, claims, statementLines, invoices] = await Promise.all([
    db.from('invoice_receipt_summary')
      .select('id,supplier,invoice_number,invoice_date,gross_total,line_count,pending_count,issue_count')
      .or('pending_count.gt.0,line_count.eq.0')
      .order('invoice_date', { ascending: false }).order('id').limit(200),
    db.from('credit_requests')
      .select('id,supplier,status,total_amount,sent_at,created_at,resolved_at')
      .or(`status.in.(draft,sent,overdue),and(status.eq.resolved,resolved_at.gte.${start.instant})`)
      .limit(1000),
    // Invoices a supplier statement lists that have not been uploaded or matched.
    db.from('statement_lines')
      .select('total, statements!inner(deleted_at)')
      .eq('document_type', 'INV').eq('match_status', 'unmatched')
      .is('statements.deleted_at', null).limit(1000),
    db.from('invoices').select('supplier,gross_total')
      .is('deleted_at', null).gte('invoice_date', start.date).limit(2000),
  ]);
  const failed = deliveries.error ?? claims.error ?? statementLines.error ?? invoices.error;
  if (failed) throw new Error(failed.message);

  const toCheck: DeliveryToCheck[] = (deliveries.data ?? []).map(r => ({
    id: r.id, supplier: r.supplier, invoice_number: r.invoice_number, invoice_date: r.invoice_date,
    gross_total: Number(r.gross_total), lines: r.line_count, checked: r.line_count - r.pending_count, issues: r.issue_count,
  }));
  // A delivery already started comes first: finish it before opening another.
  toCheck.sort((a, b) => Number(b.checked > 0) - Number(a.checked > 0) || b.invoice_date.localeCompare(a.invoice_date));

  const t = now.getTime();
  const open: OpenClaim[] = [];
  let recovered = 0, recoveredCount = 0;
  for (const c of claims.data ?? []) {
    const total = Number(c.total_amount);
    if (c.status === 'resolved') { recovered += total; recoveredCount++; continue; }
    const overdue = c.status === 'overdue' || (c.status === 'sent' && !!c.sent_at && t - Date.parse(c.sent_at) >= OVERDUE_MS);
    open.push({ id: c.id, supplier: c.supplier, status: c.status as OpenClaim['status'], total, sent_at: c.sent_at, created_at: c.created_at, overdue });
  }
  // Drafts to send first, then sent claims waiting longest.
  open.sort((a, b) => Number(b.status === 'draft') - Number(a.status === 'draft')
    || (a.sent_at ?? a.created_at).localeCompare(b.sent_at ?? b.created_at));
  const overdueClaims = open.filter(c => c.overdue);
  const gapRows = statementLines.data ?? [];

  return {
    month: start.label,
    toCheck,
    toCheckCount: toCheck.length,
    owed: open.reduce((s, c) => s + c.total, 0),
    overdue: overdueClaims.reduce((s, c) => s + c.total, 0),
    overdueCount: overdueClaims.length,
    statementGap: gapRows.reduce((s, r) => s + Number(r.total), 0),
    statementGapCount: gapRows.length,
    recovered, recoveredCount,
    claims: open,
    spend: bySupplier((invoices.data ?? []).map(i => ({ supplier: i.supplier, value: Number(i.gross_total) }))),
    owedBySupplier: bySupplier(open.map(c => ({ supplier: c.supplier, value: c.total }))),
  };
}
