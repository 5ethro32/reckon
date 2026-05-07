'use client';

/**
 * Credits ledger interactive bits:
 *  - Outstanding requests table (re-send, mark resolved)
 *  - "To-do list" of flagged lines not yet on a credit request, grouped by
 *    supplier with multi-select + batch generate.
 *
 * The page server-renders the underlying data. This component owns:
 *  - Selection state for the to-do list
 *  - Submitting POST /api/credits per supplier group
 *  - PATCH /api/credits/:id when marking resolved
 *  - Re-opening the mailto: URL for previously sent requests
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { buildMailto } from '@/lib/credits/build-mailto';

const supplierLabels: Record<string, string> = {
  aah: 'AAH',
  aver: 'Aver',
  phoenix: 'Phoenix',
  alliance: 'Alliance',
  ethigen: 'Ethigen',
  numark: 'Numark',
};

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
  return flags[0] ?? '—';
}

function daysBetween(iso: string | null): number | null {
  if (!iso) return null;
  const sent = new Date(iso).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - sent) / (1000 * 60 * 60 * 24)));
}

function ageBadge(days: number | null): { label: string; cls: string } {
  if (days === null) return { label: '—', cls: 'badge badge-neutral' };
  if (days >= 30) return { label: `${days}d`, cls: 'badge badge-critical' };
  if (days >= 14) return { label: `${days}d`, cls: 'badge badge-warning' };
  return { label: `${days}d`, cls: 'badge badge-neutral' };
}

// ---------------------------------------------------------------------------
// CSV export helpers — quote fields containing comma/quote/newline; double
// embedded quotes; prepend UTF-8 BOM so Excel renders accented chars right.
// ---------------------------------------------------------------------------
function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
      style={{ verticalAlign: '-2px', marginRight: '0.375rem' }}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
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
// Outstanding requests table
// ---------------------------------------------------------------------------
function OutstandingSection({ outstanding }: { outstanding: OutstandingRequest[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function resend(req: OutstandingRequest) {
    if (!req.email_to || !req.email_subject || !req.email_body) {
      setErrorMsg('Missing email content for this request');
      return;
    }
    const { url } = buildMailto({
      to: req.email_to,
      subject: req.email_subject,
      body: req.email_body,
    });
    window.location.href = url;
  }

  async function markResolved(req: OutstandingRequest) {
    if (
      !window.confirm(
        `Mark credit request to ${supplierLabels[req.supplier] ?? req.supplier} as resolved? The associated lines will be considered settled.`
      )
    ) {
      return;
    }
    setPendingId(req.id);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/credits/${req.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
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
      const supplierLabel = supplierLabels[req.supplier] ?? req.supplier;
      const sentDate = req.sent_at ? new Date(req.sent_at).toISOString().slice(0, 10) : '';
      const days = daysBetween(req.sent_at);
      return [
        sentDate,
        supplierLabel,
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
    <section style={{ marginBottom: '2rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.75rem',
          marginBottom: '0.875rem',
        }}
      >
        <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>
          Outstanding ({outstanding.length})
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {errorMsg && (
            <span style={{ fontSize: '11px', color: 'var(--status-critical-text)' }}>
              {errorMsg}
            </span>
          )}
          {outstanding.length > 0 && (
            <button
              type="button"
              onClick={exportCsv}
              className="btn btn-ghost btn-sm"
              title="Download outstanding credits as CSV"
            >
              <DownloadIcon /> Export CSV
            </button>
          )}
        </div>
      </div>

      {outstanding.length === 0 ? (
        <div
          className="card"
          style={{
            padding: '2.5rem 1.5rem',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '14px', fontWeight: 500, margin: 0, marginBottom: '0.375rem' }}>
            No credits to chase.
          </p>
          <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
            When you flag short or damaged lines on a delivery, a credit
            request lands here so you can track it through to recovery.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Sent</th>
                <th>Supplier</th>
                <th className="num">Invoices</th>
                <th className="num">Lines</th>
                <th className="num">Total</th>
                <th>Outstanding</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.map(req => {
                const days = daysBetween(req.sent_at);
                const age = ageBadge(days);
                return (
                  <tr key={req.id}>
                    <td style={{ color: 'var(--muted)' }}>
                      {req.sent_at
                        ? new Date(req.sent_at).toLocaleDateString('en-GB')
                        : '—'}
                    </td>
                    <td>{supplierLabels[req.supplier] ?? req.supplier}</td>
                    <td className="num">{req.invoiceCount}</td>
                    <td className="num">{req.lineCount}</td>
                    <td className="num">£{Number(req.total_amount).toFixed(2)}</td>
                    <td>
                      <span className={age.cls}>{age.label}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          display: 'inline-flex',
                          gap: '0.375rem',
                          justifyContent: 'flex-end',
                        }}
                      >
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => resend(req)}
                          disabled={!req.email_to}
                        >
                          Re-send email
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => markResolved(req)}
                          disabled={pendingId === req.id}
                        >
                          {pendingId === req.id ? 'Saving…' : 'Mark resolved'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Flagged-but-not-yet-chased lines, grouped by supplier
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
        errors.push(
          `${supplierLabels[supplier] ?? supplier}: ${
            err instanceof Error ? err.message : 'failed'
          }`
        );
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
      setProgressMsg(
        `Opened ${mailtoUrls.length} email${mailtoUrls.length === 1 ? '' : 's'}.`
      );
    }
    if (errors.length > 0) {
      setErrorMsg(errors.join(' · '));
    }

    setSelected(new Set());
    startTransition(() => router.refresh());
  }

  if (flagged.length === 0) {
    return (
      <section>
        <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 0.875rem 0' }}>
          To chase
        </h2>
        <div
          className="card"
          style={{
            padding: '2rem 1rem',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: '12px',
          }}
        >
          Nothing to chase. All flagged lines are on a credit request.
        </div>
      </section>
    );
  }

  return (
    <section>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: '0.875rem',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>
            To chase ({flagged.length})
          </h2>
          <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0.125rem 0 0' }}>
            Flagged lines that haven&apos;t been chased yet. Select and generate emails per
            supplier.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {progressMsg && (
            <span style={{ fontSize: '11px', color: 'var(--status-success-text)' }}>
              {progressMsg}
            </span>
          )}
          {errorMsg && (
            <span
              style={{
                fontSize: '11px',
                color: 'var(--status-critical-text)',
                maxWidth: '20rem',
              }}
            >
              {errorMsg}
            </span>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected.size === 0 || isPending}
            onClick={generateForSelected}
          >
            {isPending
              ? 'Generating…'
              : selected.size === 0
              ? 'Generate credit requests'
              : `Generate ${selected.size} credit request${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      {Array.from(groups.entries()).map(([supplier, lines]) => {
        const allSelected = lines.every(l => selected.has(l.id));
        const someSelected = lines.some(l => selected.has(l.id));
        const totalGross = lines.reduce((s, l) => s + Number(l.gross), 0);
        return (
          <div key={supplier} className="card" style={{ overflow: 'hidden', marginBottom: '1rem' }}>
            <div
              style={{
                padding: '0.625rem 1rem',
                background: 'var(--surface-raised)',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => {
                    if (el) el.indeterminate = !allSelected && someSelected;
                  }}
                  onChange={() => toggleSupplier(supplier)}
                  style={{ accentColor: 'var(--foreground)' }}
                />
                {supplierLabels[supplier] ?? supplier}
                <span style={{ fontWeight: 400, color: 'var(--muted)' }}>
                  · {lines.length} line{lines.length === 1 ? '' : 's'}
                </span>
              </label>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                Max £{totalGross.toFixed(2)}
              </span>
            </div>
            <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '2.5rem' }}></th>
                  <th>Invoice</th>
                  <th>SKU</th>
                  <th>Description</th>
                  <th className="num">Qty</th>
                  <th>Issue</th>
                  <th className="num">Gross</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(line => {
                  const checked = selected.has(line.id);
                  return (
                    <tr
                      key={line.id}
                      style={
                        checked
                          ? { background: 'var(--surface-hover)' }
                          : undefined
                      }
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleLine(line.id)}
                          style={{ accentColor: 'var(--foreground)' }}
                        />
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{line.invoice_number}</div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {new Date(line.invoice_date).toLocaleDateString('en-GB')}
                        </div>
                      </td>
                      <td>{line.supplier_sku}</td>
                      <td>
                        <div>{line.description}</div>
                        {line.pack_size && (
                          <div
                            style={{
                              fontSize: '11px',
                              color: 'var(--muted)',
                              marginTop: '0.125rem',
                            }}
                          >
                            Pack: {line.pack_size}
                          </div>
                        )}
                      </td>
                      <td className="num">
                        {line.qty_received ?? 0}
                        <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {' '}of {line.qty_ordered}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-warning">{flagLabel(line.flags)}</span>
                      </td>
                      <td className="num">£{Number(line.gross).toFixed(2)}</td>
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
