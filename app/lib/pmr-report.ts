/**
 * Per-product view of dispensing-system data beside invoices: packs dispensed each month, the
 * latest stock on hand, and packs invoiced over the same months. Invoice lines count only when
 * linkInvoiceLines tied them to exactly one PMR product.
 */
import { productKey } from '@reckon/parser/pmr';
import type { LineLink, PmrProduct } from './pmr-match';

export type PmrRow = { product_key: string; description: string; dmd_name: string | null; pack_size: number | null; pip: string | null };
export type DispensingRow = PmrRow & { month: string; packs: number };
export type StockRow = PmrRow & { location: string; quantity: number };
export type ReportProduct = {
  key: string; name: string; packSize: number | null; inDmd: boolean;
  dispensed: Record<string, number>; dispensedTotal: number;
  onHand: number | null; onOrder: number; purchased: number; purchasedLines: number;
};

export const isOnOrder = (location: string) => /on\s*order/i.test(location);

/** The products to link invoice lines against, with their PIP codes. */
export function pmrProducts(rows: PmrRow[]): PmrProduct[] {
  const out = new Map<string, PmrProduct>();
  for (const r of rows) {
    const p = out.get(r.product_key) ?? { key: r.product_key, name: r.dmd_name ?? productKey(r.description).name, packSize: r.pack_size === null ? null : Number(r.pack_size), pips: [] };
    if (r.pip && !p.pips.includes(r.pip)) p.pips.push(r.pip);
    out.set(r.product_key, p);
  }
  return [...out.values()];
}

export function buildReport(dispensing: DispensingRow[], stock: StockRow[] | null, purchases: { id: string; qty: number }[], links: Map<string, LineLink>): ReportProduct[] {
  const products = new Map<string, ReportProduct>();
  const get = (r: PmrRow) => {
    let p = products.get(r.product_key);
    if (!p) {
      p = { key: r.product_key, name: r.dmd_name ?? productKey(r.description).name, packSize: r.pack_size === null ? null : Number(r.pack_size), inDmd: r.dmd_name !== null, dispensed: {}, dispensedTotal: 0, onHand: stock ? 0 : null, onOrder: 0, purchased: 0, purchasedLines: 0 };
      products.set(r.product_key, p);
    }
    return p;
  };
  for (const d of dispensing) {
    const p = get(d), m = d.month.slice(0, 7), packs = Number(d.packs);
    p.dispensed[m] = (p.dispensed[m] ?? 0) + packs; p.dispensedTotal += packs;
  }
  for (const s of stock ?? []) {
    const p = get(s), q = Number(s.quantity);
    if (isOnOrder(s.location)) p.onOrder += q; else p.onHand = (p.onHand ?? 0) + q;
  }
  for (const line of purchases) {
    const link = links.get(line.id);
    const p = link?.key ? products.get(link.key) : undefined;
    if (p) { p.purchased += line.qty; p.purchasedLines++; }
  }
  return [...products.values()].sort((a, b) => b.dispensedTotal - a.dispensedTotal || a.name.localeCompare(b.name));
}
