/**
 * Supplier performance score: a weighted average of five components, each 0 to 100, from the raw counts
 * returned by public.supplier_performance (migration 0020). Nothing is hidden: the page prints the same
 * formula. A component with no data in the period is left out and the remaining weights are rescaled.
 */
type Num = number | string | null;
export type PerformanceRow = {
  pharmacy_id?: string; supplier?: string;
  invoices: Num; invoices_mismatched: Num; lines?: Num; checked_lines: Num; packs_ordered: Num; packs_received: Num;
  short_lines?: Num; damaged_lines: Num; returned_lines: Num;
  claims_sent?: Num; claims_resolved?: Num; claims_due: Num; claims_resolved_14d: Num; claims_open_overdue?: Num; avg_turnaround_days?: Num;
  statements: Num; statements_with_variance: Num; compared_lines?: Num; compared_spend: Num; best_price_spend: Num;
};
export type ComponentKey = 'fill' | 'condition' | 'credits' | 'accuracy' | 'price';
export const COMPONENTS: { key: ComponentKey; label: string; weight: number; formula: string }[] = [
  { key: 'fill', label: 'Fill rate', weight: 30, formula: 'packs received ÷ packs invoiced, on checked lines' },
  { key: 'condition', label: 'Condition', weight: 15, formula: '1 − (damaged + returned lines) ÷ checked lines' },
  { key: 'credits', label: 'Credits', weight: 20, formula: 'claims resolved within 14 days ÷ claims resolved or sent 14+ days ago' },
  { key: 'accuracy', label: 'Paperwork', weight: 15, formula: '(invoices with matching totals + statements without a variance) ÷ (invoices + statements)' },
  { key: 'price', label: 'Price', weight: 20, formula: 'spend at the best price paid for the same packs ÷ actual spend, on matched lines' },
];
export const SCORE_FORMULA = 'Score = Σ (weight × component) ÷ Σ weights of components with data. Weights: ' + COMPONENTS.map((c) => `${c.label.toLowerCase()} ${c.weight}`).join(', ') + '.';

const n = (v: Num | undefined) => v === null || v === undefined ? 0 : Number(v);
const ratio = (top: number, bottom: number) => bottom > 0 ? Math.min(1, Math.max(0, top / bottom)) * 100 : null;
const round1 = (x: number) => Math.round(x * 10) / 10;

export function scoreSupplier(r: PerformanceRow): { components: Record<ComponentKey, number | null>; score: number | null } {
  const checked = n(r.checked_lines);
  const docs = n(r.invoices) + n(r.statements);
  const raw: Record<ComponentKey, number | null> = {
    fill: ratio(n(r.packs_received), n(r.packs_ordered)),
    condition: checked > 0 ? Math.max(0, 1 - (n(r.damaged_lines) + n(r.returned_lines)) / checked) * 100 : null,
    credits: ratio(n(r.claims_resolved_14d), n(r.claims_due)),
    accuracy: ratio(docs - n(r.invoices_mismatched) - n(r.statements_with_variance), docs),
    price: n(r.compared_spend) > 0 ? ratio(n(r.best_price_spend), n(r.compared_spend)) : null,
  };
  const components = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === null ? null : round1(v)])) as Record<ComponentKey, number | null>;
  let weighted = 0, weights = 0;
  for (const c of COMPONENTS) { const v = raw[c.key]; if (v !== null) { weighted += c.weight * v; weights += c.weight; } }
  return { components, score: weights ? Math.round(weighted / weights) : null };
}
