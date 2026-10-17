/**
 * Credits ledger — outstanding chase requests + flagged lines waiting to be chased.
 *
 * Server-renders both data sets, hands them to the interactive client table.
 * RLS scopes everything to the user's pharmacy.
 */

import Link from 'next/link';
import { getRequestClient } from '@/lib/session';
import { Figure, money } from '../ui';
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
  const supabase = await getRequestClient();

  // Both reads are independent, so they run in parallel.
  const [
    // 1. Outstanding credit_requests with their linked lines (for invoice/line counts)
    { data: reqsData, error: reqsError },
    // 2. Flagged invoice_lines that aren't on any open credit request yet.
    //    flags is a jsonb array, so "no flags" is '[]' (not '{}', which
    //    matched every unclaimed line).
    { data: linesData, error: linesError },
  ] = await Promise.all([
    supabase
      .from('credit_requests')
      .select(
        `id, supplier, status, total_amount, email_to, email_subject, email_body, sent_at,
         invoice_lines ( id, invoice_id )`
      )
      .in('status', ['draft', 'sent', 'overdue'])
      .order('sent_at', { ascending: false, nullsFirst: false }),
    supabase
      .from('invoice_lines')
      .select(
        `id, invoice_id, supplier_sku, description, pack_size,
         qty_ordered, qty_received, gross, flags,
         invoices ( id, invoice_number, invoice_date, supplier, deleted_at )`
      )
      .is('credit_request_id', null)
      .neq('flags', '[]'),
  ]);

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

  // What is still owed: open claims, the part of it that has waited too long,
  // and flagged lines nobody has claimed yet.
  const outstandingTotal = outstanding.reduce((s, r) => s + r.total_amount, 0);
  const now = Date.now();
  const waited = outstanding.filter(r => r.status !== 'draft' && (r.status === 'overdue' || (r.sent_at !== null && now - new Date(r.sent_at).getTime() >= 14 * 86400000)));
  const waitedTotal = waited.reduce((s, r) => s + r.total_amount, 0);
  const unclaimedTotal = flagged.reduce((s, l) => s + l.gross, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Claims</h1>
          <p className="page-header-subtitle">Credits you have asked suppliers for, and flagged lines still to claim.</p>
        </div>
        <Link href="/suppliers" className="btn btn-secondary">Claim emails</Link>
      </div>

      {outstanding.length === 0 && flagged.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section className="figures" aria-label="Still owed">
            <Figure
              label="Owed to you"
              value={money(outstandingTotal)}
              line={outstanding.length ? `${outstanding.length} open claim${outstanding.length === 1 ? '' : 's'}` : 'No open claims'}
            />
            <Figure
              label="Waiting too long"
              value={money(waitedTotal)}
              valueClass={waited.length ? 'text-warn' : undefined}
              line={waited.length ? `${waited.length} over 14 days` : 'None over 14 days'}
            />
            <Figure
              label="Not claimed yet"
              value={money(unclaimedTotal)}
              line={flagged.length ? `${flagged.length} flagged line${flagged.length === 1 ? '' : 's'}` : 'All claimed'}
            />
          </section>
          <CreditsTable outstanding={outstanding} flagged={flagged} />
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card empty-card">
      <h2>Nothing to claim</h2>
      <p>Mark a line short, damaged or not received on a delivery and it appears here, ready to claim.</p>
      <Link href="/invoices" className="btn btn-primary">Go to deliveries</Link>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="card notice" role="alert">
      <strong>Claims did not load</strong>
      <p>{message}</p>
    </div>
  );
}
