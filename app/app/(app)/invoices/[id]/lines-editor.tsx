'use client';

/**
 * Lines tick-off editor (autosave model) + sticky credit action bar.
 *
 * UX principles enforced here:
 *  - Autosave on every change. Visible per-row save state (spinner → ✓ → fade).
 *  - Default = "Received in full". User changes only the exceptions.
 *  - Quantity cells always show "[N] of M ordered" — never lose the expected
 *    qty context.
 *  - Damaged lines reveal a follow-up disposition (returning / disposed /
 *    awaiting) inline below the row.
 *  - All exception lines reveal a Notes field — pharmacist's freeform
 *    context (e.g. "broken vial 3 of 12", "expired Mar 26").
 *  - Sticky action bar appears when exceptions exist. "Generate credit
 *    request" posts to /api/credits, opens mailto, refreshes view.
 *  - Smart recovery: if all selected lines are already on the same open
 *    credit_request, the API re-opens it (idempotent). If different,
 *    cancels old + creates new. The UI just retries the request.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type DamageDisposition = 'returning' | 'disposed' | 'awaiting' | null;

type Line = {
  id: string;
  line_number: number;
  supplier_sku: string;
  description: string;
  pack_size: string | null;
  qty_ordered: number;
  qty_received: number | null;
  unit_price: number;
  net: number;
  vat_rate: number;
  vat_amount: number;
  gross: number;
  flags: string[];
  notes: string | null;
  damage_disposition?: DamageDisposition;
};

type LineStatus = 'full' | 'short' | 'damaged' | 'none';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function getStatus(line: Line): LineStatus {
  if (line.flags.includes('not_received')) return 'none';
  if (line.flags.includes('damaged')) return 'damaged';
  if (line.flags.includes('short')) return 'short';
  return 'full';
}

const statusLabels: Record<LineStatus, string> = {
  full: 'Received in full',
  short: 'Short',
  damaged: 'Damaged',
  none: 'Not received',
};

const statusBadge: Record<LineStatus, string> = {
  full: 'badge-success',
  short: 'badge-warning',
  damaged: 'badge-warning',
  none: 'badge-critical',
};

const dispositionLabels: Record<Exclude<DamageDisposition, null>, string> = {
  returning: 'Returning to supplier',
  disposed: 'Disposed of',
  awaiting: 'Awaiting decision',
};

export default function LinesEditor({
  invoiceId,
  initialLines,
}: {
  invoiceId: string;
  initialLines: Line[];
}) {
  const router = useRouter();
  const [lines, setLines] = useState(initialLines);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [creditState, setCreditState] = useState<'idle' | 'submitting' | 'unavailable' | 'error'>('idle');
  const [creditError, setCreditError] = useState<string>('');

  // Auto-clear "saved" state after a moment so it fades back to idle
  useEffect(() => {
    const savedIds = Object.entries(saveStates)
      .filter(([, state]) => state === 'saved')
      .map(([id]) => id);
    if (savedIds.length === 0) return;
    const timer = setTimeout(() => {
      setSaveStates(prev => {
        const next = { ...prev };
        savedIds.forEach(id => { next[id] = 'idle'; });
        return next;
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [saveStates]);

  /** PATCH a line with arbitrary partial updates. Optimistic + rollback on error. */
  async function patchLine(
    lineId: string,
    patch: {
      flags?: string[];
      qty_received?: number;
      damage_disposition?: DamageDisposition;
      notes?: string | null;
    }
  ) {
    setSaveStates(prev => ({ ...prev, [lineId]: 'saving' }));

    // Optimistic update
    setLines(prev =>
      prev.map(l => (l.id === lineId ? { ...l, ...patch } : l))
    );

    try {
      const res = await fetch(`/api/invoice-lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveStates(prev => ({ ...prev, [lineId]: 'saved' }));
      router.refresh();
    } catch (err) {
      console.error('Save failed', err);
      setSaveStates(prev => ({ ...prev, [lineId]: 'error' }));
      const original = initialLines.find(l => l.id === lineId);
      if (original) {
        setLines(prev => prev.map(l => (l.id === lineId ? original : l)));
      }
    }
  }

  /** Top-level status change (full / short / damaged / none).
   *  Sets flags + qty_received in one save. Clears damage_disposition when
   *  moving away from damaged. */
  async function updateStatus(lineId: string, status: LineStatus, qtyReceived?: number) {
    const line = lines.find(l => l.id === lineId);
    if (!line) return;

    const flags: string[] =
      status === 'full' ? [] : [status === 'none' ? 'not_received' : status];

    const newQty =
      status === 'full' || status === 'damaged'
        ? line.qty_ordered
        : status === 'none'
        ? 0
        : qtyReceived ?? 0;

    const patch: Parameters<typeof patchLine>[1] = {
      flags,
      qty_received: newQty,
    };

    // Clear disposition when leaving damaged
    if (status !== 'damaged') {
      patch.damage_disposition = null;
    }

    await patchLine(lineId, patch);
  }

  // Header summary computed from current lines
  const fullCount = lines.filter(l => getStatus(l) === 'full').length;
  const exceptionCount = lines.length - fullCount;

  // Sticky action bar — exception lines and total credit potential
  const exceptionLines = lines.filter(l => l.flags.length > 0);
  const exceptionTotal = exceptionLines.reduce((sum, l) => sum + Number(l.gross), 0);
  const showActionBar = exceptionLines.length > 0;

  async function generateCredit() {
    if (exceptionLines.length === 0) return;
    setCreditState('submitting');
    setCreditError('');

    try {
      const res = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_ids: [invoiceId],
          invoice_line_ids: exceptionLines.map(l => l.id),
        }),
      });

      if (res.status === 404) {
        setCreditState('unavailable');
        return;
      }

      if (!res.ok) {
        // Try to extract a friendly error message
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          if (typeof j?.error === 'string') msg = j.error;
        } catch {
          // Ignore parse failure, use default
        }
        throw new Error(msg);
      }

      const result = (await res.json()) as {
        credit_request_id: string;
        mailto_url: string;
        reused?: boolean;
      };

      // Open email client, then refresh so lines show as "credit requested"
      window.location.href = result.mailto_url;
      router.refresh();
      setCreditState('idle');
    } catch (err) {
      console.error('Credit request failed', err);
      setCreditState('error');
      setCreditError(err instanceof Error ? err.message : 'Could not create credit request');
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: '0.75rem',
        }}
      >
        <h2 style={{
          fontSize: '15px',
          fontWeight: 600,
          margin: 0,
          letterSpacing: '-0.005em',
        }}>
          Lines{' '}
          <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
            ({lines.length})
          </span>
        </h2>
        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
          {exceptionCount === 0
            ? 'All received in full'
            : `${fullCount} of ${lines.length} received · ${exceptionCount} exception${exceptionCount === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Description</th>
              <th className="num">Received</th>
              <th className="num">Net</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(line => {
              const status = getStatus(line);
              const saveState = saveStates[line.id] ?? 'idle';
              const isException = status !== 'full';
              return (
                <LineRow
                  key={line.id}
                  line={line}
                  status={status}
                  isException={isException}
                  saveState={saveState}
                  onStatusChange={(s) => updateStatus(line.id, s)}
                  onQtyChange={(q) => {
                    setLines(prev =>
                      prev.map(l => (l.id === line.id ? { ...l, qty_received: q } : l))
                    );
                  }}
                  onQtyCommit={(q) => updateStatus(line.id, 'short', q)}
                  onDispositionChange={(d) => patchLine(line.id, { damage_disposition: d })}
                  onNotesChange={(n) => {
                    setLines(prev =>
                      prev.map(l => (l.id === line.id ? { ...l, notes: n } : l))
                    );
                  }}
                  onNotesCommit={(n) => patchLine(line.id, { notes: n || null })}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sticky credit action bar — only when there are exceptions */}
      {showActionBar && (
        <div className="action-bar-sticky fade-in">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.625rem', minWidth: 0 }}>
            <span style={{ fontSize: '13px', fontWeight: 500 }}>
              {exceptionLines.length} exception{exceptionLines.length === 1 ? '' : 's'}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>·</span>
            <span style={{ fontSize: '13px', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              £{exceptionTotal.toFixed(2)} to chase
            </span>
            {creditState === 'unavailable' && (
              <span style={{
                fontSize: '11px',
                color: 'var(--muted)',
                marginLeft: '0.5rem',
                fontStyle: 'italic',
              }}>
                · Credit chasing not configured yet
              </span>
            )}
            {creditState === 'error' && (
              <span style={{
                fontSize: '11px',
                color: 'var(--status-critical-text)',
                marginLeft: '0.5rem',
              }}>
                · {creditError}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={generateCredit}
            disabled={creditState === 'submitting' || creditState === 'unavailable'}
            className="btn btn-primary btn-sm"
          >
            {creditState === 'submitting' ? 'Generating…' : 'Generate credit request'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One line row — main row PLUS optional follow-up rows for damage
 * disposition and notes when the line is an exception.
 */
function LineRow({
  line,
  status,
  isException,
  saveState,
  onStatusChange,
  onQtyChange,
  onQtyCommit,
  onDispositionChange,
  onNotesChange,
  onNotesCommit,
}: {
  line: Line;
  status: LineStatus;
  isException: boolean;
  saveState: SaveState;
  onStatusChange: (s: LineStatus) => void;
  onQtyChange: (q: number) => void;
  onQtyCommit: (q: number) => void;
  onDispositionChange: (d: DamageDisposition) => void;
  onNotesChange: (n: string) => void;
  onNotesCommit: (n: string) => void;
}) {
  return (
    <>
      <tr className={isException ? 'is-warning' : undefined}>
        <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>
          {line.supplier_sku}
        </td>
        <td>
          <p style={{ margin: 0, fontWeight: 500 }}>{line.description}</p>
          {line.pack_size && (
            <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0.125rem 0 0 0' }}>
              Pack: {line.pack_size}
            </p>
          )}
        </td>
        <td className="num">
          <QtyCell
            line={line}
            status={status}
            onCommit={onQtyCommit}
            onChange={onQtyChange}
          />
        </td>
        <td className="num">£{Number(line.net).toFixed(2)}</td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <select
              value={status}
              disabled={saveState === 'saving'}
              onChange={e => onStatusChange(e.target.value as LineStatus)}
              className={`select-mini badge ${statusBadge[status]}`}
              style={{ appearance: 'none' as const }}
            >
              <option value="full">{statusLabels.full}</option>
              <option value="short">{statusLabels.short}</option>
              <option value="damaged">{statusLabels.damaged}</option>
              <option value="none">{statusLabels.none}</option>
            </select>
            <SaveIndicator state={saveState} />
          </div>
        </td>
      </tr>

      {/* Follow-up row: only renders for exceptions, holds disposition + notes.
       *
       * Two columns: an empty SKU column to keep alignment, then the controls
       * spanning the remaining four columns. Controls indent further from the
       * description text so they read as a clear continuation of the row above. */}
      {isException && (
        <tr className="exception-followup">
          <td />
          <td colSpan={4} className="exception-followup-cell">
            {status === 'damaged' && (
              <label className="exception-followup-control">
                <span className="exception-followup-label">Disposition</span>
                <select
                  value={line.damage_disposition ?? 'awaiting'}
                  onChange={e =>
                    onDispositionChange(e.target.value as Exclude<DamageDisposition, null>)
                  }
                  className="exception-followup-select"
                >
                  <option value="returning">{dispositionLabels.returning}</option>
                  <option value="disposed">{dispositionLabels.disposed}</option>
                  <option value="awaiting">{dispositionLabels.awaiting}</option>
                </select>
              </label>
            )}

            <label className="exception-followup-control" style={{ flex: '1 1 18rem' }}>
              <span className="exception-followup-label">Note</span>
              <input
                type="text"
                value={line.notes ?? ''}
                onChange={e => onNotesChange(e.target.value)}
                onBlur={e => onNotesCommit(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                placeholder="Optional — e.g. wet packaging, expired Mar 26"
                className="exception-followup-input"
              />
            </label>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Qty cell — shows "M ordered" by default, swaps to "[N] of M" input when short.
 * Both states keep the qty_ordered context visible.
 */
function QtyCell({
  line,
  status,
  onCommit,
  onChange,
}: {
  line: Line;
  status: LineStatus;
  onCommit: (qty: number) => void;
  onChange: (qty: number) => void;
}) {
  if (status === 'short') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
        <input
          type="number"
          min={0}
          max={line.qty_ordered - 1}
          value={line.qty_received ?? 0}
          onChange={e => {
            let v = parseInt(e.target.value) || 0;
            if (v < 0) v = 0;
            if (v >= line.qty_ordered) v = line.qty_ordered - 1;
            onChange(v);
          }}
          onBlur={() => onCommit(line.qty_received ?? 0)}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          style={{
            width: '3.5rem',
            height: '1.75rem',
            padding: '0 0.4rem',
            textAlign: 'right',
            borderRadius: '0.375rem',
            border: '1px solid var(--border)',
            background: 'var(--input-bg)',
            color: 'var(--foreground)',
            fontSize: '12px',
            fontVariantNumeric: 'tabular-nums',
            fontFamily: 'inherit',
          }}
        />
        <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
          of {line.qty_ordered}
        </span>
      </span>
    );
  }

  if (status === 'none') {
    return (
      <span>
        <span style={{ color: 'var(--status-critical-text)', fontWeight: 500 }}>0</span>
        <span style={{ fontSize: '11px', color: 'var(--muted)' }}> of {line.qty_ordered}</span>
      </span>
    );
  }

  // full or damaged — full quantity received
  return (
    <span>
      <span style={{ fontWeight: 500 }}>{line.qty_ordered}</span>
      <span style={{ fontSize: '11px', color: 'var(--muted)' }}> of {line.qty_ordered}</span>
    </span>
  );
}

/**
 * Inline save state next to each row's status select.
 */
function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') {
    return <span style={{ width: '0.875rem', display: 'inline-block' }} />;
  }
  if (state === 'saving') {
    return (
      <span
        title="Saving"
        style={{
          width: '0.875rem',
          height: '0.875rem',
          borderRadius: '50%',
          border: '2px solid var(--border)',
          borderTopColor: 'var(--foreground)',
          animation: 'reckon-spin 700ms linear infinite',
          display: 'inline-block',
        }}
      />
    );
  }
  if (state === 'saved') {
    return (
      <span
        title="Saved"
        style={{
          fontSize: '12px',
          color: 'var(--status-success-text)',
          lineHeight: 1,
        }}
      >
        ✓
      </span>
    );
  }
  return (
    <span
      title="Save failed"
      style={{
        fontSize: '12px',
        color: 'var(--status-critical-text)',
        lineHeight: 1,
      }}
    >
      ✕
    </span>
  );
}
