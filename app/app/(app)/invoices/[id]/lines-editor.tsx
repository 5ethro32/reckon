'use client';

/**
 * Checking a delivery against its invoice.
 *
 *  - One tap on a line's circle marks it received in full.
 *  - Its menu records short, damaged, returned or not received, with a
 *    stepper for quantities, so the common cases need no typing.
 *  - Every change saves at once (PATCH /api/invoice-lines/[id]); the row shows
 *    saving, saved or failed, and a failed save rolls back.
 *  - "Scan packs" opens the camera; scans add to received quantities.
 *  - When lines have problems, "Raise claim" posts to /api/credits and opens
 *    the email, as before. The API reuses an open claim for the same lines.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckIcon, ScanIcon, Sheet, Stepper, Track } from '@/components/goods-in/ui';
import { money } from '@/lib/goods-in/supplier';
import PackReceiving from './pack-receiving';

type DamageDisposition = 'returning' | 'disposed' | 'awaiting' | null;
type ReturnDisposition = 'damaged' | 'wrong_product' | 'expired' | 'over_ordered' | 'other' | null;

type Line = {
  id: string;
  line_number: number;
  supplier_sku: string;
  description: string;
  pack_size: string | null;
  qty_ordered: number;
  qty_received: number | null;
  qty_returned: number | null;
  unit_price: number;
  net: number;
  vat_rate: number;
  vat_amount: number;
  gross: number;
  flags: string[];
  notes: string | null;
  damage_disposition?: DamageDisposition;
  return_disposition?: ReturnDisposition;
  credited_via_statement_line_id?: string | null;
};

type LineStatus = 'pending' | 'partial' | 'full' | 'short' | 'damaged' | 'returned' | 'none';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Patch = {
  flags?: string[];
  qty_received?: number | null;
  qty_returned?: number | null;
  damage_disposition?: DamageDisposition;
  return_disposition?: ReturnDisposition;
  notes?: string | null;
};

function getStatus(line: Line): LineStatus {
  if (line.flags.includes('not_received')) return 'none';
  if (line.flags.includes('returned')) return 'returned';
  if (line.flags.includes('damaged')) return 'damaged';
  if (line.flags.includes('short')) return 'short';
  if (line.qty_received === null) return 'pending';
  if (line.qty_received !== line.qty_ordered) return 'partial';
  return 'full';
}

const dispositionLabels: Record<Exclude<DamageDisposition, null>, string> = {
  returning: 'Returning', disposed: 'Disposed of', awaiting: 'Not decided',
};
const returnLabels: Record<Exclude<ReturnDisposition, null>, string> = {
  damaged: 'Damaged', wrong_product: 'Wrong product', expired: 'Short-dated or expired', over_ordered: 'Over-ordered', other: 'Other',
};

function statusText(line: Line, status: LineStatus): { text: string; tone: 'good' | 'warn' | 'ink' | 'open' } {
  const of = `${line.qty_received ?? 0} of ${line.qty_ordered}`;
  switch (status) {
    case 'full': return { text: 'Received', tone: 'good' };
    case 'partial': return { text: `${of} scanned`, tone: 'ink' };
    case 'short': return { text: `Short · ${of} received`, tone: 'warn' };
    case 'damaged': return { text: `Damaged · ${dispositionLabels[line.damage_disposition ?? 'awaiting'].toLowerCase()}`, tone: 'warn' };
    case 'returned': return { text: `Returned ${line.qty_returned ?? line.qty_ordered}${line.return_disposition ? ` · ${returnLabels[line.return_disposition].toLowerCase()}` : ''}`, tone: 'warn' };
    case 'none': return { text: 'Not received', tone: 'warn' };
    default: return { text: 'Not checked', tone: 'open' };
  }
}

export default function LinesEditor({
  invoiceId,
  invoiceNumber,
  initialLines,
  startScanning = false,
}: {
  invoiceId: string;
  invoiceNumber: string;
  initialLines: Line[];
  startScanning?: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState(initialLines);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [creditState, setCreditState] = useState<'idle' | 'submitting' | 'unavailable' | 'error'>('idle');
  const [creditError, setCreditError] = useState('');
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(startScanning);

  // "Saved" fades back to idle after a moment.
  useEffect(() => {
    const savedIds = Object.entries(saveStates).filter(([, s]) => s === 'saved').map(([id]) => id);
    if (savedIds.length === 0) return;
    const timer = setTimeout(() => {
      setSaveStates(prev => { const next = { ...prev }; savedIds.forEach(id => { next[id] = 'idle'; }); return next; });
    }, 1500);
    return () => clearTimeout(timer);
  }, [saveStates]);

  /** PATCH a line. Optimistic, rolled back on error. */
  async function patchLine(lineId: string, patch: Patch) {
    setSaveStates(prev => ({ ...prev, [lineId]: 'saving' }));
    setLines(prev => prev.map(l => (l.id === lineId ? { ...l, ...patch } : l)));
    try {
      const res = await fetch(`/api/invoice-lines/${lineId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveStates(prev => ({ ...prev, [lineId]: 'saved' }));
      router.refresh();
    } catch (err) {
      console.error('Save failed', err);
      setSaveStates(prev => ({ ...prev, [lineId]: 'error' }));
      const original = initialLines.find(l => l.id === lineId);
      if (original) setLines(prev => prev.map(l => (l.id === lineId ? original : l)));
    }
  }

  /** Set a line's state: flags, received and returned quantities in one save.
   *  Leaving damaged or returned clears that state's follow-up. */
  async function updateStatus(lineId: string, status: LineStatus, qtyReceived?: number) {
    if (status === 'pending' || status === 'partial') return;
    const line = lines.find(l => l.id === lineId);
    if (!line) return;
    const flags: string[] = status === 'full' ? [] : [status === 'none' ? 'not_received' : status];
    // What the pharmacy holds after any return: full and damaged keep everything,
    // returned and not received hold none, short holds what was counted.
    const qty = status === 'full' || status === 'damaged' ? line.qty_ordered
      : status === 'none' || status === 'returned' ? 0 : qtyReceived ?? 0;
    const patch: Patch = { flags, qty_received: qty, qty_returned: status === 'returned' ? line.qty_ordered : null };
    if (status !== 'damaged') patch.damage_disposition = null;
    if (status !== 'returned') patch.return_disposition = null;
    await patchLine(lineId, patch);
  }

  const counts = useMemo(() => {
    let full = 0, pending = 0, partial = 0, problems = 0;
    for (const l of lines) {
      const s = getStatus(l);
      if (s === 'full') full++; else if (s === 'pending') pending++; else if (s === 'partial') partial++; else problems++;
    }
    return { full, pending, partial, problems, checked: lines.length - pending - partial };
  }, [lines]);

  const exceptionLines = lines.filter(l => l.flags.length > 0);
  const exceptionTotal = exceptionLines.reduce((sum, l) => sum + Number(l.gross), 0);

  async function generateCredit() {
    if (exceptionLines.length === 0) return;
    setCreditState('submitting');
    setCreditError('');
    try {
      const res = await fetch('/api/credits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_ids: [invoiceId], invoice_line_ids: exceptionLines.map(l => l.id) }),
      });
      if (res.status === 404) { setCreditState('unavailable'); return; }
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (typeof j?.error === 'string') msg = j.error; } catch { /* default message */ }
        throw new Error(msg);
      }
      const result = (await res.json()) as { credit_request_id: string; mailto_url: string; reused?: boolean; auto_resolved?: boolean };
      if (!result.auto_resolved) window.location.assign(result.mailto_url);
      router.refresh();
      setCreditState('idle');
    } catch (err) {
      console.error('Credit request failed', err);
      setCreditState('error');
      setCreditError(err instanceof Error ? err.message : 'Could not create the claim');
    }
  }

  const closeSheet = useCallback(() => setOpenLineId(null), []);
  const closeScanner = useCallback(() => {
    setScanning(false);
    // Drop ?scan=1 so a refresh does not reopen the camera.
    if (window.location.search.includes('scan=')) window.history.replaceState(null, '', window.location.pathname);
    router.refresh();
  }, [router]);

  const openLine = lines.find(l => l.id === openLineId) ?? null;
  const total = lines.length;
  const done = total > 0 && counts.pending === 0 && counts.partial === 0;

  return (
    <div className="gx-check">
      <section className="gi-card gx-progress" aria-label="Checking progress">
        <div className="gx-progress-text">
          <strong className="tnum">{counts.checked} of {total} lines checked</strong>
          <span>
            {done && counts.problems === 0 ? 'Everything received'
              : counts.problems ? <span className="gi-status"><i className="gi-dot is-warn" />{counts.problems} {counts.problems === 1 ? 'problem' : 'problems'}</span> : null}
          </span>
        </div>
        <Track total={total} good={counts.full} warn={counts.problems} ink={counts.partial} label={`${counts.full} received, ${counts.problems} with problems, ${counts.pending + counts.partial} to check`} />
        <button type="button" className="gi-btn gi-btn-primary gx-scan-btn" onClick={() => setScanning(true)} disabled={!total}>
          <ScanIcon />Scan packs
        </button>
      </section>

      <section className="gi-card gx-lines" aria-label="Invoice lines">
        <div className="gx-thead gi-desk" aria-hidden="true">
          <span /><span>Product</span><span>Code</span><span className="num">Qty</span><span className="num">Net</span><span>Status</span><span />
        </div>
        <ul className="gx-list">
          {lines.map(line => (
            <LineRow
              key={line.id}
              line={line}
              status={getStatus(line)}
              saveState={saveStates[line.id] ?? 'idle'}
              onTick={() => {
                const s = getStatus(line);
                if (s === 'pending' || s === 'partial') void updateStatus(line.id, 'full');
                else setOpenLineId(line.id);
              }}
              onMore={() => setOpenLineId(line.id)}
            />
          ))}
        </ul>
        {!total && <p className="gi-empty" style={{ paddingTop: 16 }}>No lines were read from this invoice. Check the upload, or re-upload a clearer copy.</p>}
      </section>

      {(exceptionLines.length > 0 || done) && (
        <div className={`gx-finish${exceptionLines.length ? '' : ' is-done'}`} role="status">
          {exceptionLines.length > 0 ? (
            <>
              <span className="gx-finish-text">
                <strong>{exceptionLines.length} {exceptionLines.length === 1 ? 'problem' : 'problems'}</strong>
                <span className="tnum">{money(exceptionTotal)}{done ? ' on these lines' : ` · ${counts.pending + counts.partial} to check`}</span>
                {creditState === 'unavailable' && <span className="gi-error">Claims are not set up for this workspace yet.</span>}
                {creditState === 'error' && <span className="gi-error">{creditError}</span>}
              </span>
              <button type="button" className="gi-btn gi-btn-primary" onClick={generateCredit}
                disabled={creditState === 'submitting' || creditState === 'unavailable'}>
                {creditState === 'submitting' ? 'Raising…' : 'Raise claim'}
              </button>
            </>
          ) : (
            <span className="gx-finish-text">
              <strong className="gx-good"><CheckIcon className="gx-finish-icon" />All received</strong>
              <span>Every line matches the invoice.</span>
            </span>
          )}
        </div>
      )}

      {openLine && (
        <LineSheet
          line={openLine}
          status={getStatus(openLine)}
          onClose={closeSheet}
          onStatus={(s, q) => updateStatus(openLine.id, s, q)}
          onPatch={p => patchLine(openLine.id, p)}
          onNotesChange={n => setLines(prev => prev.map(l => (l.id === openLine.id ? { ...l, notes: n } : l)))}
        />
      )}

      {scanning && <PackReceiving invoiceId={invoiceId} invoiceNumber={invoiceNumber} lines={lines} onClose={closeScanner} />}
    </div>
  );
}

function LineRow({ line, status, saveState, onTick, onMore }: {
  line: Line; status: LineStatus; saveState: SaveState; onTick: () => void; onMore: () => void;
}) {
  const st = statusText(line, status);
  const problem = line.flags.length > 0;
  const tickClass = status === 'full' ? 'is-good' : problem ? 'is-warn' : status === 'partial' ? 'is-part' : '';
  const tickLabel = status === 'pending' || status === 'partial' ? `Mark ${line.description} received in full` : `Change ${line.description}`;
  return (
    <li className={`gx-row${problem ? ' is-problem' : ''}`}>
      <button type="button" className={`gx-tick ${tickClass}`} onClick={onTick} aria-label={tickLabel} disabled={saveState === 'saving'}>
        <span className="gx-tick-mark">
          {status === 'full' ? <CheckIcon /> : problem ? <b aria-hidden="true">!</b> : null}
        </span>
      </button>
      <button type="button" className="gx-body" onClick={onMore}>
        <span className="gx-name">{line.description}</span>
        <span className="gx-meta">
          {line.pack_size ? `Pack ${line.pack_size} · ` : ''}{line.qty_ordered} ordered
          <span className="gi-phone"> · {money(Number(line.net))}</span>
        </span>
        {(status !== 'pending' && status !== 'full' || line.credited_via_statement_line_id) && <span className="gx-meta gx-state gi-phone">
          <i className={`gi-dot is-${st.tone}`} />{st.text}
          {line.credited_via_statement_line_id && <span className="gx-credited">Credited</span>}
        </span>}
      </button>
      <span className="gx-code gi-desk tnum">{line.supplier_sku}</span>
      <span className="gx-qty gi-desk tnum">{line.qty_received ?? '–'} <small>of {line.qty_ordered}</small></span>
      <span className="gx-net gi-desk tnum">{money(Number(line.net))}</span>
      <span className="gx-status gi-desk">
        <span className="gi-status"><i className={`gi-dot is-${st.tone}`} />{st.text}</span>
        {line.credited_via_statement_line_id && <span className="gx-credited" title="A credit for this line has been matched on a supplier statement.">Credited</span>}
      </span>
      <span className="gx-side">
        <SaveMark state={saveState} />
        <button type="button" className="gx-more" onClick={onMore} aria-label={`Options for ${line.description}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="12.5" cy="8" r="1.4" /></svg>
        </button>
      </span>
    </li>
  );
}

function SaveMark({ state }: { state: SaveState }) {
  if (state === 'saving') return <span className="gx-save is-saving" title="Saving" />;
  if (state === 'saved') return <span className="gx-save is-saved" title="Saved"><CheckIcon /></span>;
  if (state === 'error') return <span className="gx-save is-error" title="Not saved. Try again." role="alert">Not saved</span>;
  return <span className="gx-save" />;
}

type Choice = 'full' | 'short' | 'damaged' | 'returned' | 'none';

function LineSheet({ line, status, onClose, onStatus, onPatch, onNotesChange }: {
  line: Line; status: LineStatus; onClose: () => void;
  onStatus: (s: LineStatus, qty?: number) => Promise<void>;
  onPatch: (p: Patch) => Promise<void>;
  onNotesChange: (n: string) => void;
}) {
  const [expanded, setExpanded] = useState<Choice | null>(status === 'short' || status === 'damaged' || status === 'returned' ? status : null);
  const [shortQty, setShortQty] = useState(status === 'short' ? line.qty_received ?? 0 : Math.max(0, line.qty_ordered - 1));
  const [returnQty, setReturnQty] = useState(line.qty_returned ?? line.qty_ordered);

  const options: { key: Choice; label: string }[] = [
    { key: 'full', label: 'Received in full' },
    { key: 'short', label: 'Short' },
    { key: 'damaged', label: 'Damaged' },
    { key: 'returned', label: 'Returned' },
    { key: 'none', label: 'Not received' },
  ];

  async function choose(key: Choice) {
    if (key === 'full' || key === 'none') { await onStatus(key); onClose(); return; }
    if (key === 'short') { setExpanded('short'); return; }
    setExpanded(key);
    if (status !== key) await onStatus(key);
  }

  return (
    <Sheet title={line.description} subtitle={`${line.pack_size ? `Pack ${line.pack_size} · ` : ''}${line.qty_ordered} ordered · ${money(Number(line.net))} net · ${line.supplier_sku}`} onClose={onClose}>
      <ul className="gi-options">
        {options.map(o => (
          <li key={o.key}>
            <button type="button" className="gi-option" aria-pressed={status === o.key} onClick={() => void choose(o.key)}>
              {o.label}
              {status === o.key && <CheckIcon className="gi-check" />}
            </button>
            {expanded === 'short' && o.key === 'short' && (
              <div className="gi-option-detail">
                <div className="gi-field-row">
                  <span>Packs received</span>
                  <Stepper label="Packs received" value={shortQty} min={0} max={Math.max(0, line.qty_ordered - 1)} onChange={setShortQty} />
                </div>
                <button type="button" className="gi-btn gi-btn-primary" onClick={async () => { await onStatus('short', shortQty); onClose(); }}>
                  Save · {shortQty} of {line.qty_ordered} received
                </button>
              </div>
            )}
            {expanded === 'damaged' && o.key === 'damaged' && status === 'damaged' && (
              <div className="gi-option-detail">
                <span className="gi-field">What happens to it</span>
                <div className="gi-chips">
                  {(Object.keys(dispositionLabels) as Exclude<DamageDisposition, null>[]).map(d => (
                    <button key={d} type="button" className="gi-chip" aria-pressed={(line.damage_disposition ?? 'awaiting') === d}
                      onClick={() => void onPatch({ damage_disposition: d })}>{dispositionLabels[d]}</button>
                  ))}
                </div>
              </div>
            )}
            {expanded === 'returned' && o.key === 'returned' && status === 'returned' && (
              <div className="gi-option-detail">
                <div className="gi-field-row">
                  <span>Packs returned</span>
                  <Stepper label="Packs returned" value={returnQty} min={1} max={line.qty_ordered}
                    onChange={n => { setReturnQty(n); void onPatch({ qty_returned: n }); }} />
                </div>
                <span className="gi-field">Reason</span>
                <div className="gi-chips">
                  {(Object.keys(returnLabels) as Exclude<ReturnDisposition, null>[]).map(d => (
                    <button key={d} type="button" className="gi-chip" aria-pressed={(line.return_disposition ?? 'other') === d}
                      onClick={() => void onPatch({ return_disposition: d })}>{returnLabels[d]}</button>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {line.credited_via_statement_line_id && (
        <p className="gx-sheet-note"><i className="gi-dot is-good" />A credit for this line has been matched on a supplier statement.</p>
      )}
      <label className="gi-field" style={{ marginTop: 16 }}>
        Note
        <input className="gi-input" type="text" value={line.notes ?? ''} placeholder="For example: wet packaging, expires Mar 27"
          onChange={e => onNotesChange(e.target.value)}
          onBlur={e => void onPatch({ notes: e.target.value || null })}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </label>
      <ScanHistory lineId={line.id} />
      <button type="button" className="gi-btn gi-btn-quiet gi-btn-block" style={{ marginTop: 20 }} onClick={onClose}>Done</button>
    </Sheet>
  );
}

type ReceiptEvent = { id: string; quantity: number; gtin: string; batch: string | null; expiry: string | null; serial: string | null; recorded_at: string };

/** Scanned packs for one line, loaded when opened. Manual changes are not scans. */
function ScanHistory({ lineId }: { lineId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ events: ReceiptEvent[]; error: string; loaded: boolean }>({ events: [], error: '', loaded: false });
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/receiving?lineId=${encodeURIComponent(lineId)}`, { signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok) throw Error(data.error); setState({ events: data.events, error: '', loaded: true }); })
      .catch(e => { if (!controller.signal.aborted) setState({ events: [], error: e instanceof Error ? e.message : 'History unavailable', loaded: true }); });
    return () => controller.abort();
  }, [open, lineId]);
  return (
    <details className="gx-history" onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Scanned packs</summary>
      {!state.loaded ? <p className="gi-note">Loading…</p>
        : state.error ? <p className="gi-error">{state.error}</p>
        : state.events.length ? (
          <ul>
            {state.events.map(e => (
              <li key={e.id}>
                <span className="tnum">{e.quantity} {e.quantity === 1 ? 'pack' : 'packs'}</span>
                <span>{new Date(e.recorded_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}</span>
                <small>{[e.batch && `Batch ${e.batch}`, e.expiry && `Exp ${e.expiry}`, e.serial && `Serial ${e.serial}`].filter(Boolean).join(' · ') || `GTIN ${e.gtin}`}</small>
              </li>
            ))}
          </ul>
        ) : <p className="gi-note">No scans recorded for this line.</p>}
    </details>
  );
}
