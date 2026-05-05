/**
 * Credits ledger — outstanding chase requests + flagged lines waiting to be chased.
 *
 * Server-renders both data sets, hands them to the interactive client table.
 * RLS scopes everything to the user's pharmacy.
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import CreditsTable, {
  type OutstandingRequest,
  type FlaggedLine,
} from './credits-table';

type CreditRequestRow = {
  id: string;
  supplier: string;
  status: string;
  total_amount: number | string;
  email_to: string | null;
  email_subject: string | null;
  email_body: string | null;
  sent_at: string | null;
  invoice_lines: Array<{ id: string; invoice_id: string }> | null;
};

type FlaggedLineRow = {
  id: string;
  invoice_id: string;
  supplier_sku: string;
  description: string;
  pack_size: string | null;
  qty_ordered: number | string;
  qty_received: number | string | null;
  gross: number | string;
  flags: string[] | null;
  invoices:
    | { id: string; invoice_number: string; invoice_date: string; supplier: string; deleted_at: string | null }
    | { id: string; invoice_number: string; invoice_date: string; supplier: string; deleted_at: string | null }[]
    | null;
};

export default async function CreditsPage() {
  const supabase = await createClient();

  // 1. Outstanding credit_requests with their linked lines (for invoice/line counts)
  const { data: reqsData, error: reqsError } = await supabase
    .from('credit_requests')
    .select(
      `id, supplier, status, total_amount, email_to, email_subject, email_body, sent_at,
       invoice_lines ( id, invoice_id )`
    )
    .in('status', ['sent', 'overdue'])
    .order('sent_at', { ascending: false, nullsFirst: false });

  if (reqsError) return <ErrorState message={reqsError.message} />;

  const outstanding: OutstandingRequest[] = ((reqsData ?? []) as CreditRequestRow[]).map(r => {
    const lines = r.invoice_lines ?? [];
    const invoiceIds = new Set(lines.map(l => l.invoice_id));
    return {
      id: r.id,
      supplier: r.supplier,
      status: r.status,
      total_amount: Number(r.total_amount),
      email_to: r.email_to,
      email_subject: r.email_subject,
      email_body: r.email_body,
      sent_at: r.sent_at,
      invoiceCount: invoiceIds.size,
      lineCount: lines.length,
    };
  });

  // 2. Flagged invoice_lines that aren't on any open credit request yet
  const { data: linesData, error: linesError } = await supabase
    .from('invoice_lines')
    .select(
      `id, invoice_id, supplier_sku, description, pack_size,
       qty_ordered, qty_received, gross, flags,
       invoices ( id, invoice_number, invoice_date, supplier, deleted_at )`
    )
    .is('credit_request_id', null)
    .not('flags', 'eq', '{}');

  if (linesError) return <ErrorState message={linesError.message} />;

  const flagged: FlaggedLine[] = ((linesData ?? []) as FlaggedLineRow[])
    .map(raw => {
      const inv = Array.isArray(raw.invoices) ? raw.invoices[0] : raw.invoices;
      if (!inv || inv.deleted_at) return null;
      const flags = raw.flags ?? [];
      // Defensive: skip any rows where flags is somehow empty after the filter
      if (flags.length === 0) return null;
      return {
        id: raw.id,
        invoice_id: raw.invoice_id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        supplier: inv.supplier,
        supplier_sku: raw.supplier_sku,
        description: raw.description,
        pack_size: raw.pack_size,
        qty_ordered: Number(raw.qty_ordered),
        qty_received: raw.qty_received === null ? null : Number(raw.qty_received),
        flags,
        gross: Number(raw.gross),
      } satisfies FlaggedLine;
    })
    .filter((x): x is FlaggedLine => x !== null)
    .sort((a, b) => {
      // Group by supplier, then by invoice date desc
      if (a.supplier !== b.supplier) return a.supplier.localeCompare(b.supplier);
      return b.invoice_date.localeCompare(a.invoice_date);
    });

  const outstandingTotal = outstanding.reduce((s, r) => s + r.total_amount, 0);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
          gap: '1rem',
        }}
      >
        <div>
          <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>
            Credit requests
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
            {outstanding.length} outstanding · £{outstandingTotal.toFixed(2)} total
          </p>
        </div>
        <Link href="/suppliers" className="btn btn-secondary">
          Supplier settings
        </Link>
      </div>

      {outstanding.length === 0 && flagged.length === 0 ? (
        <EmptyState />
      ) : (
        <CreditsTable outstanding={outstanding} flagged={flagged} />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
      <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0, marginBottom: '0.375rem' }}>
        Nothing to chase
      </h2>
      <p
        style={{
          fontSize: '12px',
          color: 'var(--muted)',
          margin: 0,
          marginBottom: '1.5rem',
        }}
      >
        Flag a short or damaged line on a delivery to start a credit request.
      </p>
      <Link href="/invoices" className="btn btn-primary">
        Go to deliveries
      </Link>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '1rem',
        borderRadius: '0.5rem',
        background: 'var(--status-critical-bg)',
        border: '1px solid var(--status-critical-border)',
        color: 'var(--status-critical-text)',
      }}
    >
      <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>Couldn&apos;t load credits</p>
      <p style={{ fontSize: '12px', margin: 0, marginTop: '0.25rem' }}>{message}</p>
    </div>
  );
}
