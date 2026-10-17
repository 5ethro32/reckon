/**
 * One delivery: its invoice header, then checking the lines (tick, record
 * problems, scan packs) and raising a claim for anything wrong.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readAll } from '@/lib/paginated-read';
import { money, supplierName } from '@/lib/goods-in/supplier';
import { SupplierBadge } from '@/components/goods-in/ui';
import LinesEditor from './lines-editor';
import CatalogImport from './barcode-catalog-import';
import '@/components/goods-in/goods-in.css';
import './goods-in-page.css';

const longDate = (d: string) => new Date(d + (d.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).replace('Sept', 'Sep');

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
      credited_via_statement_line_id
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
  const warnings = (invoice.warnings as string[]) ?? [];
  const lineGross = lines.reduce((s, l) => s + Number(l.gross), 0);

  return (
    <div className="gi gx">
      <Link href="/invoices" className="gx-back">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true"><path d="M7.5 3 4.5 6l3 3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Invoices
      </Link>

      <header className="gx-head">
        <SupplierBadge supplier={invoice.supplier} />
        <div className="gx-head-main">
          <p className="gx-head-sup">{supplierName(invoice.supplier)} · {longDate(invoice.invoice_date)}</p>
          <h1 className="gx-title tnum">{invoice.invoice_number}</h1>
        </div>
        <div className="gx-head-fig">
          <strong className="tnum">{money(Number(invoice.gross_total))}</strong>
          <span>incl. VAT</span>
        </div>
      </header>

      <details className="gx-details">
        <summary>Invoice details</summary>
        <dl>
          <div><dt>Due</dt><dd>{invoice.due_date ? longDate(invoice.due_date) : '–'}</dd></div>
          <div><dt>PO number</dt><dd>{invoice.po_number ?? '–'}</dd></div>
          <div><dt>Account</dt><dd>{invoice.customer_account ?? '–'}</dd></div>
          <div><dt>Net</dt><dd className="tnum">{money(Number(invoice.net_total))}</dd></div>
          <div><dt>VAT</dt><dd className="tnum">{money(Number(invoice.vat_total))}</dd></div>
          <div><dt>Lines</dt><dd className="tnum">{lines.length}</dd></div>
        </dl>
      </details>

      {!invoice.totals_match && (
        <p className="gx-banner" role="note">
          <i className="gi-dot is-warn" />
          <span>
            <strong>Totals don&apos;t agree.</strong> The lines add up to {money(lineGross)}; the invoice says {money(Number(invoice.gross_total))}. Check the lines against the paper copy.
          </span>
        </p>
      )}

      <LinesEditor
        key={JSON.stringify(lines)}
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoice_number}
        initialLines={lines}
        startScanning={query.scan === '1' && lines.length > 0}
      />

      {(warnings.length > 0 || lines.length > 0) && (
        <div className="gx-foot">
          {warnings.length > 0 && (
            <details className="gx-details">
              <summary>Reading notes ({warnings.length})</summary>
              <ul className="gx-warnings">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}
          {lines[0] && <CatalogImport lineId={lines[0].id} />}
        </div>
      )}
    </div>
  );
}
