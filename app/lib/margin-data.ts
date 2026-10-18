import { getCurrentUser, getRequestClient } from '@/lib/session';
import type { Period } from './period';
import type { MarginLine, ProductMargin, SupplierMargin, SupplierPerformance } from './margin-report';
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Every row of a set-returning function, 1,000 at a time in a stable order, so the API row limit never truncates a report. */
async function pages<T>(fetchPage: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await fetchPage(start, start + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}
/**
 * The request's Supabase client, once the session is known to be signed in.
 * getCurrentUser checks the JWT locally (getClaims) and is shared with the
 * layout for the render, so this adds no Auth round trip; RLS still decides
 * what the queries return.
 */
async function signedIn() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Sign in to view your pharmacy records.');
  return getRequestClient();
}
const args = (p: Period) => ({ p_from: p.from, p_to: p.to });
export async function loadMarginSummary(p: Period) {
  const db = await signedIn();
  const [suppliers, products, losses, unmatched, release] = await Promise.all([
    pages<SupplierMargin>((a, b) => db.rpc('margin_by_supplier', args(p)).order('supplier').order('pharmacy_id').range(a, b)),
    db.rpc('margin_by_product', args(p)).order('spend', { ascending: false }).order('vmpp_id').order('pharmacy_id').limit(100),
    db.rpc('margin_lines', args(p)).lt('margin', 0).order('margin').order('line_id').limit(100),
    db.rpc('margin_lines', args(p)).neq('match_status', 'matched').order('invoice_date', { ascending: false }).order('line_id').limit(100),
    db.from('dmd_vmpps').select('vmpp_id').not('dt_price_pence', 'is', null).limit(1),
  ]);
  const failed = products.error ?? losses.error ?? unmatched.error;
  if (failed) throw new Error(failed.message);
  return { suppliers, products: (products.data ?? []) as ProductMargin[], losses: (losses.data ?? []) as MarginLine[], unmatched: (unmatched.data ?? []) as MarginLine[], pricesLoaded: !release.error && (release.data ?? []).length > 0 };
}
export async function loadMarginRows(p: Period, view: 'lines' | 'products' | 'suppliers') {
  const db = await signedIn();
  if (view === 'suppliers') return pages<SupplierMargin>((a, b) => db.rpc('margin_by_supplier', args(p)).order('supplier').order('pharmacy_id').range(a, b));
  if (view === 'products') return pages<ProductMargin>((a, b) => db.rpc('margin_by_product', args(p)).order('spend', { ascending: false }).order('vmpp_id').order('pharmacy_id').range(a, b));
  return pages<MarginLine>((a, b) => db.rpc('margin_lines', args(p)).order('invoice_date').order('line_id').range(a, b));
}
export async function loadSupplierPerformance(p: Period) {
  const db = await signedIn();
  return pages<SupplierPerformance>((a, b) => db.rpc('supplier_performance', args(p)).order('supplier').order('pharmacy_id').range(a, b));
}
