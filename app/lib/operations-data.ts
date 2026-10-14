import { getRequestClient } from '@/lib/session';
import { sortSuppliers, type SupplierRow } from './operations-summary';
// One RPC (migration 0018) counts in the database what summarise() counts in memory; RLS applies.
export type OperationsSummary = {
  receipt_count: number; unfinished_count: number; issue_count: number;
  unfinished: Array<{ id: string; supplier: string; invoice_number: string; invoice_date: string; gross_total: number | string; created_at: string; lines: number; pending: number }>;
  open_count: number; open_total: number | string; aged_count: number;
  aged: Array<{ id: string; supplier: string; total_amount: number | string; sent_at: string | null }>;
  suppliers: SupplierRow[];
};
export async function loadOperations(): Promise<OperationsSummary> {
  const db = await getRequestClient();
  const { data, error } = await db.rpc('dashboard_summary');
  if (error || !data) throw new Error(error?.message ?? 'Sign in to view your pharmacy records.');
  const summary = data as OperationsSummary;
  return { ...summary, suppliers: sortSuppliers(summary.suppliers.map(r => ({ ...r, invoiceGross: Number(r.invoiceGross), claimTotal: Number(r.claimTotal) }))) };
}
