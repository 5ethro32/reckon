/**
 * One delivery: reads the invoice and its lines, then the receiving screen
 * (scan packs, tick lines, record problems, close or raise a claim).
 * ?scan=1 opens the camera straight away.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readAll } from '@/lib/paginated-read';
import DeliveryView from './delivery-view';
import '@/components/goods-in/goods-in.css';
import './goods-in-page.css';

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scan?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const lineQuery = () => supabase
    .from('invoice_lines')
    .select(`
      id, line_number, supplier_sku, description, pack_size,
      qty_ordered, qty_received, qty_returned,
      unit_price, net, vat_rate, vat_amount, gross,
      flags, notes,
      damage_disposition, return_disposition,
      credit_request_id, credited_via_statement_line_id
    `)
    .eq('invoice_id', id)
    .order('id').limit(500);

  type InvoiceLine = NonNullable<Awaited<ReturnType<typeof lineQuery>>['data']>[number];
  // Header and lines load in parallel; RLS scopes both, and the lines are
  // only used once the invoice itself is confirmed visible.
  const [{ data: invoice, error }, linesResult] = await Promise.all([
    supabase
      .from('invoices')
      .select(`
        id, supplier, invoice_number, invoice_date, due_date, po_number,
        customer_account, customer_name, net_total, vat_total, gross_total,
        totals_match, receipt_status, warnings
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle(),
    readAll<InvoiceLine>(after => { const q = lineQuery(); return after ? q.gt('id', after) : q; })
      .then(rows => ({ rows }), () => ({ rows: null })),
  ]);

  if (error || !invoice) notFound();

  const lines = linesResult.rows;
  if (!lines) {
    return (
      <div className="gi gx">
        <section className="gi-card gx-alert" role="alert">
          <h1 className="gx-title">Lines unavailable</h1>
          <p className="gi-note">Not every line of this invoice could be loaded, so nothing is shown. Refresh before checking the delivery.</p>
          <Link href="/invoices" className="gi-link">Invoices</Link>
        </section>
      </div>
    );
  }
  lines.sort((a, b) => a.line_number - b.line_number);
  return <DeliveryView invoice={invoice} lines={lines} startScanning={query.scan === '1'} />;
}
