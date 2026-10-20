/**
 * One delivery: a header that says exactly what was opened (wholesaler,
 * invoice, date, lines, packs), then the receiving screen.
 *
 * Takes loaded records only, so the page does the reading and this can be
 * rendered on its own.
 */

import Link from 'next/link';
import { money, supplierName } from '@/lib/goods-in/supplier';
import { deliveryFacts } from '@/lib/receiving-progress';
import { SupplierBadge } from '@/components/goods-in/ui';
import LinesEditor, { type Line } from './lines-editor';
import CatalogImport from './barcode-catalog-import';
import '@/components/goods-in/goods-in.css';
import './goods-in-page.css';

export type DeliveryInvoice = {
  id: string; supplier: string; invoice_number: string; invoice_date: string; due_date: string | null; po_number: string | null;
  customer_account: string | null; net_total: number | string; vat_total: number | string; gross_total: number | string;
  totals_match: boolean; warnings: unknown;
};

const longDate = (d: string) => new Date(d + (d.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).replace('Sept', 'Sep');

export default function DeliveryView({ invoice, lines, startScanning }: { invoice: DeliveryInvoice; lines: Line[]; startScanning: boolean }) {
  const warnings = (invoice.warnings as string[] | null) ?? [];
  const lineGross = lines.reduce((s, l) => s + Number(l.gross), 0);
  const packs = lines.reduce((s, l) => s + l.qty_ordered, 0);

  return (
    <div className="gi gx">
      <Link href="/invoices" className="gx-back">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true"><path d="M7.5 3 4.5 6l3 3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Invoices
      </Link>

      <header className="gx-head">
        <SupplierBadge supplier={invoice.supplier} />
        <div className="gx-head-main">
          <p className="gx-head-sup">{supplierName(invoice.supplier)} delivery</p>
          <h1 className="gx-title tnum">{invoice.invoice_number}</h1>
          <p className="gx-head-facts tnum">{deliveryFacts(invoice.invoice_date, lines.length, packs)}</p>
        </div>
        <div className="gx-head-fig">
          <strong className="tnum">{money(Number(invoice.gross_total))}</strong>
          <span>incl. VAT</span>
        </div>
      </header>

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
        supplier={invoice.supplier}
        initialLines={lines}
        startScanning={startScanning && lines.length > 0}
      />

      <div className="gx-foot">
        <details className="gx-details">
          <summary>Invoice details</summary>
          <dl>
            <div><dt>Due</dt><dd>{invoice.due_date ? longDate(invoice.due_date) : '–'}</dd></div>
            <div><dt>PO number</dt><dd>{invoice.po_number ?? '–'}</dd></div>
            <div><dt>Account</dt><dd>{invoice.customer_account ?? '–'}</dd></div>
            <div><dt>Net</dt><dd className="tnum">{money(Number(invoice.net_total))}</dd></div>
            <div><dt>VAT</dt><dd className="tnum">{money(Number(invoice.vat_total))}</dd></div>
            <div><dt>Invoice date</dt><dd>{longDate(invoice.invoice_date)}</dd></div>
          </dl>
        </details>
        {warnings.length > 0 && (
          <details className="gx-details">
            <summary>Reading notes ({warnings.length})</summary>
            <ul className="gx-warnings">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        )}
        {lines[0] && <CatalogImport lineId={lines[0].id} />}
      </div>
    </div>
  );
}
