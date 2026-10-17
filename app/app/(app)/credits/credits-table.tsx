'use client';

/**
 * Claims, the interactive parts:
 *  - Open claims (re-open the email, record it as sent, record the credit received)
 *  - Lines to claim: flagged lines not yet on a claim, grouped by supplier,
 *    with multi-select and one claim email per supplier.
 *
 * The page server-renders the data. This component owns:
 *  - Selection state for the lines to claim
 *  - Submitting POST /api/credits per supplier group
 *  - PATCH /api/credits/:id when recording sent or received
 *  - Re-opening the mailto: URL for a claim already drafted
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { csvCell } from '@/lib/operations-summary';
import { useRouter } from 'next/navigation';
import { buildMailto } from '@/lib/credits/build-mailto';
import { Status, SupplierTag, money, shortDate, supplierLabel, type Tone } from '../ui';

export type OutstandingRequest = {
  id: string;
  supplier: string;
  status: string;
  total_amount: number;
  email_to: string | null;
  email_subject: string | null;
  email_body: string | null;
  sent_at: string | null;
  invoiceCount: number;
  lineCount: number;
};

export type FlaggedLine = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  supplier: string;
  supplier_sku: string;
  description: string;
  pack_size: string | null;
  qty_ordered: number;
  qty_received: number | null;
  flags: string[];
  gross: number;
};

function flagLabel(flags: string[]): string {
  if (flags.includes('not_received')) return 'Not received';
  if (flags.includes('damaged')) return 'Damaged';
  if (flags.includes('short')) return 'Short';
  return flags[0] ?? '–';
}

function daysBetween(iso: string | null): number | null {
  if (!iso) return null;
  const sent = new Date(iso).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - sent) / (1000 * 60 * 60 * 24)));
}

/** How long a claim has waited: amber from 14 days, red only when overdue (30 days or marked overdue). */
function claimAge(req: OutstandingRequest): { tone: Tone; label: string } {
  if (req.status === 'draft') return { tone: 'brand', label: 'Not sent yet' };
  const days = daysBetween(req.sent_at);
  if (days === null) return { tone: 'neutral', label: 'No send date' };
  const label = days === 0 ? 'Sent today' : `${days} day${days === 1 ? '' : 's'}`;
  if (req.status === 'overdue' || days >= 30) return { tone: 'bad', label: `Overdue · ${label}` };
  if (days >= 14) return { tone: 'warn', label };
  return { tone: 'neutral', label };
}

// ---------------------------------------------------------------------------
// CSV export helpers — quote fields containing comma/quote/newline; double
// embedded quotes; prepend UTF-8 BOM so Excel renders accented chars right.
// ---------------------------------------------------------------------------
function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return csvCell(value);
}

function downloadCsv(rows: string[][], filename: string) {
  const csv = '﻿' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function CreditsTable({
  outstanding,
  flagged,
}: {
  outstanding: OutstandingRequest[];
  flagged: FlaggedLine[];
}) {
  return (
    <div>
      <OutstandingSection outstanding={outstanding} />
      <FlaggedSection flagged={flagged} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Open claims
// ---------------------------------------------------------------------------
function OutstandingSection({ outstanding }: { outstanding: OutstandingRequest[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<OutstandingRequest | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function resend(req: OutstandingRequest) {
    if (!req.email_to || !req.email_subject || !req.email_body) {
      setErrorMsg('This claim has no email saved with it.');
      return;
    }
    const { url } = buildMailto({
      to: req.email_to,
      subject: req.email_subject,
      body: req.email_body,
    });
    window.location.assign(url);
  }

  async function markSent(req: OutstandingRequest) {
    setPendingId(req.id); setErrorMsg(null);
    try {
      const res = await fetch(`/api/credits/${req.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'sent' }) });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error ?? 'Could not record sent status'); }
      router.refresh();
    } catch (error) { setErrorMsg(error instanceof Error ? error.message : 'Could not record sent status'); }
    finally { setPendingId(null); }
  }

  async function markResolved(req: OutstandingRequest, reference: string, notes: string) {
    if (!reference.trim()) return;
    setPendingId(req.id);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/credits/${req.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved', external_credit_note_number: reference.trim(), ...(notes.trim() ? { notes: notes.trim() } : {}) }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setResolving(null);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setPendingId(null);
    }
  }

  function exportCsv() {
    const today = new Date().toISOString().slice(0, 10);
    const header = ['Sent', 'Supplier', 'Status', 'Invoices', 'Lines', 'Total (£)', 'Days outstanding'];
    const body = outstanding.map(req => {
      const sentDate = req.sent_at ? new Date(req.sent_at).toISOString().slice(0, 10) : '';
      const days = daysBetween(req.sent_at);
      return [
        sentDate,
        supplierLabel(req.supplier),
        req.status,
        String(req.invoiceCount),
        String(req.lineCount),
        req.total_amount.toFixed(2),
        days === null ? '' : String(days),
      ];
    });
    downloadCsv([header, ...body], `reckon-credits-${today}.csv`);
  }

  return (
    <section className="card" style={{ overflow: 'hidden', marginBottom: '1.25rem' }} aria-labelledby="open-claims">
      {resolving && <ResolutionDialog request={resolving} pending={pendingId === resolving.id} error={errorMsg} onCancel={() => { setResolving(null); setErrorMsg(null); }} onSave={(reference, notes) => markResolved(resolving, reference, notes)} />}
      <div className="card-head">
        <h2 id="open-claims">Open claims</h2>
        {outstanding.length > 0 && (
          <button type="button" onClick={exportCsv} className="quiet-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 13 }} title="Download open claims as CSV">
            Export CSV
          </button>
        )}
      </div>
      {errorMsg && !resolving && <p role="alert" className="inline-error">{errorMsg}</p>}

      {outstanding.length === 0 ? (
        <p className="card-empty">No open claims. Claims you send from the lines below are tracked here until the credit arrives.</p>
      ) : (
        <div className="table-scroll">
          <table className="table rows">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Sent</th>
                <th>Covers</th>
                <th className="num">Claimed</th>
                <th>Waiting</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {outstanding.map(req => {
                const age = claimAge(req);
                const busy = pendingId === req.id;
                return (
                  <tr key={req.id}>
                    <td className="c-title"><SupplierTag code={req.supplier} /></td>
                    <td className="c-meta text-faint">{req.status === 'draft' ? 'Draft' : shortDate(req.sent_at)}</td>
                    <td className="c-meta text-faint">
                      {req.invoiceCount} invoice{req.invoiceCount === 1 ? '' : 's'}, {req.lineCount} line{req.lineCount === 1 ? '' : 's'}
                    </td>
                    <td className="num c-value">{money(req.total_amount)}</td>
                    <td className="c-status"><Status tone={age.tone}>{age.label}</Status></td>
                    <td className="c-wide row-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => resend(req)} disabled={!req.email_to}>
                        {req.status === 'draft' ? 'Open email' : 'Re-open email'}
                      </button>
                      {req.status === 'draft' && (
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => markSent(req)}>I have sent this</button>
                      )}
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setErrorMsg(null); setResolving(req); }} disabled={busy}>
                        {busy ? 'Saving…' : 'Credit received'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ResolutionDialog({ request, pending, error, onCancel, onSave }: {
  request: OutstandingRequest; pending: boolean; error: string | null;
  onCancel: () => void; onSave: (reference: string, notes: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="credit-resolution-dialog" aria-labelledby="credit-resolution-title" onCancel={event => { event.preventDefault(); if (!pending) onCancel(); }}>
    <form onSubmit={event => { event.preventDefault(); void onSave(reference, notes); }}>
      <h2 id="credit-resolution-title">Record a received credit</h2>
      <p>{supplierLabel(request.supplier)} · {money(request.total_amount)} claimed</p>
      <p className="ops-muted">Only close this claim once you have checked that the supplier’s credit covers all of it. A promise to issue a credit is not confirmation.</p>
      <label htmlFor="credit-reference">Supplier credit note reference</label>
      <input id="credit-reference" className="input" value={reference} onChange={event => setReference(event.target.value)} required maxLength={200} disabled={pending} autoFocus />
      <label htmlFor="credit-evidence">Evidence or notes (optional)</label>
      <textarea id="credit-evidence" className="input" value={notes} onChange={event => setNotes(event.target.value)} rows={3} maxLength={4000} disabled={pending} placeholder="For example, the statement date and where the credit was checked." />
      {error && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
      <div className="credit-resolution-actions"><button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button><button type="submit" className="btn btn-primary" disabled={pending || !reference.trim()}>{pending ? 'Saving…' : 'Confirm credit received'}</button></div>
    </form>
  </dialog>;
}

// ---------------------------------------------------------------------------
// Lines to claim: flagged but not yet on a claim, grouped by supplier
// ---------------------------------------------------------------------------
function FlaggedSection({ flagged }: { flagged: FlaggedLine[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);

  // Group by supplier
  const groups = new Map<string, FlaggedLine[]>();
  for (const l of flagged) {
    if (!groups.has(l.supplier)) groups.set(l.supplier, []);
    groups.get(l.supplier)!.push(l);
  }

  function toggleLine(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSupplier(supplier: string) {
    const lines = groups.get(supplier) ?? [];
    const allSelected = lines.every(l => selected.has(l.id));
    setSelected(prev => {
      const next = new Set(prev);
      for (const l of lines) {
        if (allSelected) next.delete(l.id);
        else next.add(l.id);
      }
      return next;
    });
  }

  async function generateForSelected() {
    if (selected.size === 0) return;
    setErrorMsg(null);
    setProgressMsg(null);

    // Bucket selected lines by supplier
    const bySupplier = new Map<string, FlaggedLine[]>();
    for (const l of flagged) {
      if (!selected.has(l.id)) continue;
      if (!bySupplier.has(l.supplier)) bySupplier.set(l.supplier, []);
      bySupplier.get(l.supplier)!.push(l);
    }

    const mailtoUrls: string[] = [];
    const errors: string[] = [];

    for (const [supplier, lines] of bySupplier.entries()) {
      const invoiceIds = Array.from(new Set(lines.map(l => l.invoice_id)));
      const lineIds = lines.map(l => l.id);
      try {
        const res = await fetch('/api/credits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoice_ids: invoiceIds,
            invoice_line_ids: lineIds,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { mailto_url: string };
        mailtoUrls.push(data.mailto_url);
      } catch (err) {
        errors.push(`${supplierLabel(supplier)}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }

    // Open the first mailto immediately; queue the rest with a small delay
    // so the OS handler can pick them up in turn.
    if (mailtoUrls.length > 0) {
      window.location.href = mailtoUrls[0]!;
      for (let i = 1; i < mailtoUrls.length; i++) {
        const url = mailtoUrls[i]!;
        setTimeout(() => {
          window.open(url, '_self');
        }, i * 800);
      }
      setProgressMsg(`Opened ${mailtoUrls.length} email${mailtoUrls.length === 1 ? '' : 's'}.`);
    }
    if (errors.length > 0) {
      setErrorMsg(errors.join(' · '));
    }

    setSelected(new Set());
    startTransition(() => router.refresh());
  }

  return (
    <section aria-labelledby="lines-to-claim">
      <div className="section-head">
        <div>
          <h2 id="lines-to-claim">Lines to claim</h2>
          <p>Flagged on a delivery but not on a claim yet. Pick lines and Reckon writes one email per supplier.</p>
        </div>
        {flagged.length > 0 && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected.size === 0 || isPending}
            onClick={generateForSelected}
          >
            {isPending
              ? 'Writing emails…'
              : selected.size === 0
              ? 'Claim selected lines'
              : `Claim ${selected.size} line${selected.size === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
      {progressMsg && <p role="status" className="inline-note">{progressMsg}</p>}
      {errorMsg && <p role="alert" className="inline-error">{errorMsg}</p>}

      {flagged.length === 0 && (
        <div className="card"><p className="card-empty">Nothing to claim. Every flagged line is on a claim.</p></div>
      )}

      {Array.from(groups.entries()).map(([supplier, lines]) => {
        const allSelected = lines.every(l => selected.has(l.id));
        const someSelected = lines.some(l => selected.has(l.id));
        const totalGross = lines.reduce((s, l) => s + Number(l.gross), 0);
        return (
          <div key={supplier} className="card" style={{ overflow: 'hidden', marginBottom: '0.875rem' }}>
            <div className="card-head group-head">
              <label className="group-pick">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => {
                    if (el) el.indeterminate = !allSelected && someSelected;
                  }}
                  onChange={() => toggleSupplier(supplier)}
                  aria-label={`Select every ${supplierLabel(supplier)} line`}
                />
                <SupplierTag code={supplier} />
                <span className="text-faint" style={{ fontWeight: 400 }}>{lines.length} line{lines.length === 1 ? '' : 's'}</span>
              </label>
              <span className="card-head-detail">Up to {money(totalGross)}</span>
            </div>
            <div className="table-scroll">
              <table className="table rows">
                <thead>
                  <tr>
                    <th style={{ width: '2.5rem' }}><span className="sr-only">Select</span></th>
                    <th>Product</th>
                    <th>Invoice</th>
                    <th>Received</th>
                    <th>Issue</th>
                    <th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => {
                    const checked = selected.has(line.id);
                    return (
                      <tr key={line.id} style={checked ? { background: 'var(--brand-soft)' } : undefined}>
                        <td className="c-lead">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleLine(line.id)}
                            aria-label={`Select ${line.description}`}
                          />
                        </td>
                        <td className="c-title">
                          {line.description}
                          {line.pack_size && <span className="sub c-desk">{line.pack_size} · {line.supplier_sku}</span>}
                        </td>
                        <td className="c-meta">
                          {line.invoice_number}
                          <span className="sub c-desk">{shortDate(line.invoice_date)}</span>
                        </td>
                        <td className="c-meta">{line.qty_received ?? 0} of {line.qty_ordered}</td>
                        <td className="c-status"><Status tone="warn">{flagLabel(line.flags)}</Status></td>
                        <td className="num c-value">{money(line.gross)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}
