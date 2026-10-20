'use client';

/**
 * Receiving a delivery: one screen for scanning packs and ticking lines.
 *
 *  - The progress card counts lines checked and packs received. Its main
 *    action opens the camera strip; "Tick all received" is for people who
 *    count by eye rather than scan.
 *  - The camera strip sits above the line list and can be made smaller or
 *    closed. A scanned pack counts up on its own line and in the totals.
 *    Packs not on the invoice are listed separately.
 *  - One tap on a line's circle marks it received in full. Tapping the line
 *    records short, damaged, returned or not received, with a stepper for
 *    quantities. Every change saves at once (PATCH /api/invoice-lines/[id]);
 *    a failed save rolls back.
 *  - When nothing is left to check, the finish bar says what happens next:
 *    close the delivery, or raise a claim for the lines short (POST
 *    /api/credits, which reuses an open claim for the same lines). Lines
 *    scanned only in part are recorded as short first.
 *
 * qty_ordered is the invoiced quantity; the screen calls it "invoiced".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckIcon, ScanIcon, Sheet, Stepper, Track } from '@/components/goods-in/ui';
import { money, supplierName } from '@/lib/goods-in/supplier';
import { lineState, linesToTick, receivingProgress, type LineState } from '@/lib/receiving-progress';
import PackReceiving, { type StrayScan } from './pack-receiving';

type DamageDisposition = 'returning' | 'disposed' | 'awaiting' | null;
type ReturnDisposition = 'damaged' | 'wrong_product' | 'expired' | 'over_ordered' | 'other' | null;

export type Line = {
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
  credit_request_id?: string | null;
  credited_via_statement_line_id?: string | null;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Patch = {
  flags?: string[];
  qty_received?: number | null;
  qty_returned?: number | null;
  damage_disposition?: DamageDisposition;
  return_disposition?: ReturnDisposition;
  notes?: string | null;
};

const dispositionLabels: Record<Exclude<DamageDisposition, null>, string> = {
  returning: 'Returning', disposed: 'Disposed of', awaiting: 'Not decided',
};
const returnLabels: Record<Exclude<ReturnDisposition, null>, string> = {
  damaged: 'Damaged', wrong_product: 'Wrong product', expired: 'Short-dated or expired', over_ordered: 'Over-ordered', other: 'Other',
};

function statusText(line: Line, status: LineState): { text: string; tone: 'good' | 'warn' | 'ink' | 'open' } {
  switch (status) {
    case 'full': return { text: 'Received', tone: 'good' };
    case 'partial': return { text: 'Part received', tone: 'ink' };
    case 'short': return { text: 'Short', tone: 'warn' };
    case 'damaged': return { text: `Damaged · ${dispositionLabels[line.damage_disposition ?? 'awaiting'].toLowerCase()}`, tone: 'warn' };
    case 'returned': return { text: `Returned ${line.qty_returned ?? line.qty_ordered}${line.return_disposition ? ` · ${returnLabels[line.return_disposition].toLowerCase()}` : ''}`, tone: 'warn' };
    case 'none': return { text: 'Not received', tone: 'warn' };
    default: return { text: 'To check', tone: 'open' };
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Runs saves a few at a time, so ticking a whole delivery does not fire forty requests at once. */
async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(run));
}

export default function LinesEditor({
  invoiceId,
  invoiceNumber,
  supplier,
  initialLines,
  startScanning = false,
}: {
  invoiceId: string;
  invoiceNumber: string;
  supplier: string;
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
  const [compact, setCompact] = useState(false);
  const [strays, setStrays] = useState<StrayScan[]>([]);
  const [hit, setHit] = useState<{ id: string; n: number } | null>(null);
  const [tickAll, setTickAll] = useState<'closed' | 'confirm' | 'saving'>('closed');
  const [bulkError, setBulkError] = useState('');
  const rows = useRef(new Map<string, HTMLLIElement>());

  // "Saved" fades back to idle after a moment.
  useEffect(() => {
    const savedIds = Object.entries(saveStates).filter(([, s]) => s === 'saved').map(([id]) => id);
    if (savedIds.length === 0) return;
    const timer = setTimeout(() => {
      setSaveStates(prev => { const next = { ...prev }; savedIds.forEach(id => { next[id] = 'idle'; }); return next; });
    }, 1500);
    return () => clearTimeout(timer);
  }, [saveStates]);

  /** PATCH a line. Optimistic, rolled back on error. Resolves true when saved. */
  const patchLine = useCallback(async (lineId: string, patch: Patch): Promise<boolean> => {
    setSaveStates(prev => ({ ...prev, [lineId]: 'saving' }));
    let before: Line | undefined;
    setLines(prev => prev.map(l => { if (l.id !== lineId) return l; before = l; return { ...l, ...patch } as Line; }));
    try {
      const res = await fetch(`/api/invoice-lines/${lineId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveStates(prev => ({ ...prev, [lineId]: 'saved' }));
      return true;
    } catch (err) {
      console.error('Save failed', err);
      setSaveStates(prev => ({ ...prev, [lineId]: 'error' }));
      if (before) { const restore = before; setLines(prev => prev.map(l => (l.id === lineId ? restore : l))); }
      return false;
    }
  }, []);

  /** Set a line's state: flags, received and returned quantities in one save.
   *  Leaving damaged or returned clears that state's follow-up. */
  async function updateStatus(lineId: string, status: LineState, qtyReceived?: number): Promise<boolean> {
    if (status === 'pending' || status === 'partial') return false;
    const line = lines.find(l => l.id === lineId);
    if (!line) return false;
    const flags: string[] = status === 'full' ? [] : [status === 'none' ? 'not_received' : status];
    // What the pharmacy holds after any return: full and damaged keep everything,
    // returned and not received hold none, short holds what was counted.
    const qty = status === 'full' || status === 'damaged' ? line.qty_ordered
      : status === 'none' || status === 'returned' ? 0 : qtyReceived ?? 0;
    const patch: Patch = { flags, qty_received: qty, qty_returned: status === 'returned' ? line.qty_ordered : null };
    if (status !== 'damaged') patch.damage_disposition = null;
    if (status !== 'returned') patch.return_disposition = null;
    return patchLine(lineId, patch);
  }

  const progress = useMemo(() => receivingProgress(lines), [lines]);
  const toTick = useMemo(() => linesToTick(lines), [lines]);

  async function tickAllReceived() {
    setTickAll('saving');
    setBulkError('');
    const ids = [...toTick];
    let failed = 0;
    await inBatches(ids, 4, async id => {
      const line = lines.find(l => l.id === id);
      if (!line) return;
      const ok = await patchLine(id, { flags: [], qty_received: line.qty_ordered, qty_returned: null, damage_disposition: null, return_disposition: null });
      if (!ok) failed++;
    });
    setTickAll('closed');
    if (failed) setBulkError(`${plural(failed, 'line')} did not save. Tick ${failed === 1 ? 'it' : 'them'} again.`);
  }

  async function raiseClaim() {
    const ids = progress.claimLineIds;
    if (ids.length === 0) return;
    setCreditState('submitting');
    setCreditError('');
    try {
      // Lines scanned only in part are short: record that before claiming.
      for (const id of progress.partialLineIds) {
        const line = lines.find(l => l.id === id);
        if (line && !(await updateStatus(id, 'short', line.qty_received ?? 0))) throw new Error('A line could not be recorded as short. Try again.');
      }
      const res = await fetch('/api/credits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_ids: [invoiceId], invoice_line_ids: ids }),
      });
      if (res.status === 404) { setCreditState('unavailable'); return; }
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (typeof j?.error === 'string') msg = j.error; } catch { /* default message */ }
        throw new Error(msg);
      }
      const result = (await res.json()) as { credit_request_id: string; mailto_url: string; reused?: boolean; auto_resolved?: boolean };
      setLines(prev => prev.map(l => (ids.includes(l.id) ? { ...l, credit_request_id: result.credit_request_id } : l)));
      if (!result.auto_resolved) window.location.assign(result.mailto_url);
      router.refresh();
      setCreditState('idle');
    } catch (err) {
      console.error('Credit request failed', err);
      setCreditState('error');
      setCreditError(err instanceof Error ? err.message : 'Could not create the claim');
    }
  }

  const onRecorded = useCallback((lineId: string, received: number) => {
    setLines(prev => prev.map(l => (l.id === lineId ? { ...l, qty_received: received } : l)));
    setHit(h => ({ id: lineId, n: (h?.n ?? 0) + 1 }));
    // Bring the line into view between the camera strip and the bottom bar, without moving if it is already there.
    const row = rows.current.get(lineId);
    if (!row) return;
    const r = row.getBoundingClientRect();
    const top = (document.querySelector('.gr-strip')?.getBoundingClientRect().bottom ?? 0) + 8;
    const bottom = window.innerHeight - (window.matchMedia('(max-width: 768px)').matches ? 100 : 16);
    const by = r.top < top ? r.top - top : r.bottom > bottom ? r.bottom - bottom : 0;
    if (by) window.scrollBy({ top: by, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, []);
  const onStray = useCallback((gtin: string, name: string | null) => {
    setStrays(prev => {
      const found = prev.find(s => s.gtin === gtin);
      if (found) return prev.map(s => (s.gtin === gtin ? { ...s, count: s.count + 1, at: Date.now(), name: name ?? s.name } : s));
      return [{ key: crypto.randomUUID(), gtin, name, at: Date.now(), count: 1 }, ...prev];
    });
  }, []);
  const onStrayResolved = useCallback((gtin: string) => setStrays(prev => prev.filter(s => s.gtin !== gtin)), []);

  const closeSheet = useCallback(() => setOpenLineId(null), []);
  const closeScanner = useCallback(() => {
    setScanning(false);
    // Drop ?scan=1 so a refresh does not reopen the camera.
    if (window.location.search.includes('scan=')) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const openLine = lines.find(l => l.id === openLineId) ?? null;
  const total = lines.length;
  const checking = progress.stage === 'checking';
  const who = supplierName(supplier);
  const claimLines = plural(progress.claimLineIds.length, 'line');
  const claimTitle = progress.shortLines >= progress.claimLineIds.length ? `${claimLines} short`
    : progress.shortLines === 0 ? `${claimLines} damaged or returned`
    : `${claimLines} short or damaged`;

  return (
    <div className="gx-check">
      <section className="gi-card gx-progress" aria-label="Checking progress">
        <div className="gx-progress-text">
          <strong className="tnum">{progress.checked} of {total} lines checked</strong>
          <span className="tnum">{progress.packsReceived} of {progress.packs} packs received</span>
        </div>
        <Track total={total} good={progress.full} warn={progress.problems} ink={progress.partial}
          label={`${progress.full} received, ${progress.problems} with problems, ${progress.pending + progress.partial} to check`} />
        {(!scanning || checking) && (
          <div className="gx-progress-actions">
            {!scanning && (
              <button type="button" className={`gi-btn ${checking ? 'gi-btn-primary' : 'gi-btn-quiet'} gx-scan-btn`} onClick={() => { setScanning(true); setCompact(false); }} disabled={!total}>
                <ScanIcon />Scan packs
              </button>
            )}
            {checking && (
              <button type="button" className="gi-btn gi-btn-quiet gx-tickall-btn" onClick={() => { setBulkError(''); setTickAll('confirm'); }}>
                {progress.checked + progress.partial > 0 ? 'Tick the rest received' : 'Tick all received'}
              </button>
            )}
          </div>
        )}
        {bulkError && <p className="gi-error" role="alert">{bulkError}</p>}
      </section>

      {scanning && (
        <PackReceiving
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          lines={lines}
          packs={progress.packs}
          packsReceived={progress.packsReceived}
          compact={compact}
          onToggleCompact={() => setCompact(c => !c)}
          onClose={closeScanner}
          onRecorded={onRecorded}
          onStray={onStray}
          onStrayResolved={onStrayResolved}
        />
      )}

      <section className="gi-card gx-lines" aria-labelledby="gx-lines-title">
        <div className="gi-card-head gx-lines-head">
          <h2 id="gx-lines-title">Lines</h2>
          <span className="gi-aside">Tap a line to record short or damaged</span>
        </div>
        <div className="gx-thead gi-desk" aria-hidden="true">
          <span /><span>Product</span><span>Code</span><span className="num">Received</span><span className="num">Net</span><span>Status</span><span />
        </div>
        <ul className="gx-list">
          {lines.map(line => (
            <LineRow
              key={line.id}
              ref={el => { if (el) rows.current.set(line.id, el); else rows.current.delete(line.id); }}
              line={line}
              status={lineState(line)}
              hit={hit?.id === line.id ? hit.n : 0}
              saveState={saveStates[line.id] ?? 'idle'}
              onTick={() => {
                const s = lineState(line);
                if (s === 'pending' || s === 'partial') void updateStatus(line.id, 'full');
                else setOpenLineId(line.id);
              }}
              onMore={() => setOpenLineId(line.id)}
            />
          ))}
        </ul>
        {!total && <p className="gi-empty" style={{ paddingTop: 16 }}>No lines were read from this invoice. Check the upload, or re-upload a clearer copy.</p>}
      </section>

      {strays.length > 0 && (
        <section className="gi-card gx-strays" aria-labelledby="gx-strays-title">
          <div className="gi-card-head">
            <h2 id="gx-strays-title">Not on this invoice</h2>
            <span className="gi-aside">{plural(strays.reduce((s, x) => s + x.count, 0), 'pack')}</span>
          </div>
          <p className="gi-empty gx-strays-note">Set these aside. They are not on {invoiceNumber}, so they are not counted. Check them with {who}.</p>
          <ul className="gx-stray-list">
            {strays.map(s => (
              <li key={s.key}>
                <span className="gx-stray-mark" aria-hidden="true">!</span>
                <span className="gx-stray-body">
                  <strong>{s.name ?? 'Unknown pack'}</strong>
                  <span className="tnum">Barcode {s.gtin}</span>
                </span>
                <span className="gx-stray-count tnum">{s.count > 1 ? `×${s.count}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {progress.stage === 'complete' && (
        <div className="gx-finish is-done" role="status">
          <span className="gx-finish-text">
            <strong className="gx-good"><CheckIcon className="gx-finish-icon" />All received</strong>
            <span>Every line matches the invoice.</span>
          </span>
          <Link href="/dashboard" className="gi-btn gi-btn-primary">Close delivery</Link>
        </div>
      )}
      {progress.stage === 'short' && progress.claimLineIds.length > 0 && !progress.claimRaised && (
        <div className="gx-finish" role="status">
          <span className="gx-finish-text">
            <strong>{claimTitle}</strong>
            <span className="tnum">{money(progress.claimValue)} to claim from {who}</span>
            {creditState === 'unavailable' && <span className="gi-error">Claims are not set up for this workspace yet.</span>}
            {creditState === 'error' && <span className="gi-error">{creditError}</span>}
          </span>
          <button type="button" className="gi-btn gi-btn-primary" onClick={raiseClaim}
            disabled={creditState === 'submitting' || creditState === 'unavailable'}>
            {creditState === 'submitting' ? 'Raising…' : 'Raise a claim'}
          </button>
        </div>
      )}
      {progress.stage === 'short' && (progress.claimRaised || progress.claimLineIds.length === 0) && (
        <div className="gx-finish is-settled" role="status">
          <span className="gx-finish-text">
            <strong>{progress.claimRaised ? 'Claim raised' : 'Already credited'}</strong>
            <span>{progress.claimRaised ? <>{plural(progress.claimLineIds.length, 'line')} · follow it up in <Link href="/credits" className="gx-inline-link">Claims</Link></> : 'The supplier statement shows a credit for these lines.'}</span>
          </span>
          <Link href="/dashboard" className="gi-btn gi-btn-primary">Close delivery</Link>
        </div>
      )}

      {openLine && (
        <LineSheet
          line={openLine}
          status={lineState(openLine)}
          onClose={closeSheet}
          onStatus={async (s, q) => { await updateStatus(openLine.id, s, q); }}
          onPatch={async p => { await patchLine(openLine.id, p); }}
          onNotesChange={n => setLines(prev => prev.map(l => (l.id === openLine.id ? { ...l, notes: n } : l)))}
        />
      )}

      {tickAll !== 'closed' && (
        <Sheet title={progress.checked + progress.partial > 0 ? 'Tick the rest received?' : 'Tick all received?'} onClose={() => { if (tickAll !== 'saving') setTickAll('closed'); }}>
          <p className="gr-sheet-text">
            Marks {plural(toTick.length, 'line')} received in full, as invoiced. Do this once the delivery is counted.
            {progress.problems > 0 ? ` The ${plural(progress.problems, 'line')} with a problem stay as they are.` : ''}
          </p>
          <div className="gr-sheet-actions">
            <button type="button" className="gi-btn gi-btn-primary gi-btn-block" disabled={tickAll === 'saving'} onClick={() => void tickAllReceived()}>
              {tickAll === 'saving' ? 'Saving…' : `Tick ${plural(toTick.length, 'line')}`}
            </button>
            <button type="button" className="gi-btn gi-btn-quiet gi-btn-block" disabled={tickAll === 'saving'} onClick={() => setTickAll('closed')}>Cancel</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** The line's circle: empty to check, an arc while packs are scanned, filled when received. */
function TickMark({ status, received, invoiced }: { status: LineState; received: number; invoiced: number }) {
  if (status === 'full') return <span className="gx-tick-mark"><CheckIcon /></span>;
  if (status !== 'pending' && status !== 'partial') return <span className="gx-tick-mark"><b aria-hidden="true">!</b></span>;
  const r = 11.5, c = 2 * Math.PI * r;
  const share = status === 'partial' && invoiced > 0 ? Math.min(1, received / invoiced) : 0;
  return (
    <span className="gx-tick-mark">
      {share > 0 && (
        <svg className="gx-arc" viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="13" r={r} strokeDasharray={`${share * c} ${c}`} />
        </svg>
      )}
    </span>
  );
}

function LineRow({ ref, line, status, hit, saveState, onTick, onMore }: {
  ref: (el: HTMLLIElement | null) => void;
  line: Line; status: LineState; hit: number; saveState: SaveState; onTick: () => void; onMore: () => void;
}) {
  const st = statusText(line, status);
  const problem = line.flags.length > 0;
  const tickClass = status === 'full' ? 'is-good' : problem ? 'is-warn' : status === 'partial' ? 'is-part' : '';
  const tickLabel = status === 'pending' || status === 'partial' ? `Mark ${line.description} received in full` : `Change ${line.description}`;
  const received = line.qty_received ?? 0;
  return (
    <li ref={ref} className={`gx-row${problem ? ' is-problem' : ''}`} data-state={status}>
      {hit > 0 && <span className="gx-hit" key={hit} aria-hidden="true" />}
      <button type="button" className={`gx-tick ${tickClass}`} onClick={onTick} aria-label={tickLabel} disabled={saveState === 'saving'}>
        <TickMark status={status} received={received} invoiced={line.qty_ordered} />
      </button>
      <button type="button" className="gx-body" onClick={onMore}>
        <span className="gx-name">{line.description}</span>
        <span className="gx-meta">
          {line.pack_size ? `Pack ${line.pack_size} · ` : ''}{line.qty_ordered} invoiced
          {status !== 'pending' && status !== 'full' && <span className="gi-phone"> · <span className="gi-status gx-inline-status"><i className={`gi-dot is-${st.tone}`} />{st.text}</span></span>}
          {line.credited_via_statement_line_id && <span className="gx-credited gi-phone">Credited</span>}
        </span>
      </button>
      <span className="gx-code gi-desk tnum">{line.supplier_sku}</span>
      <span className={`gx-qty tnum is-${status}`} aria-label={`${received} of ${line.qty_ordered} received`}>
        <span className={status === 'pending' ? 'gx-qty-none' : undefined}>{received}</span><small> of {line.qty_ordered}</small>
      </span>
      <span className="gx-net gi-desk tnum">{money(Number(line.net))}</span>
      <span className="gx-status gi-desk">
        <span className="gi-status"><i className={`gi-dot is-${st.tone}`} />{st.text}</span>
        {line.credited_via_statement_line_id && <span className="gx-credited" title="A credit for this line has been matched on a supplier statement.">Credited</span>}
      </span>
      <span className="gx-side gi-desk">
        <SaveMark state={saveState} />
        <button type="button" className="gx-more" onClick={onMore} aria-label={`Options for ${line.description}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="12.5" cy="8" r="1.4" /></svg>
        </button>
      </span>
      {saveState === 'error' && <span className="gx-save is-error gi-phone gx-row-error" role="alert">Not saved</span>}
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
  line: Line; status: LineState; onClose: () => void;
  onStatus: (s: LineState, qty?: number) => Promise<void>;
  onPatch: (p: Patch) => Promise<void>;
  onNotesChange: (n: string) => void;
}) {
  const [expanded, setExpanded] = useState<Choice | null>(status === 'short' || status === 'damaged' || status === 'returned' ? status : null);
  const [shortQty, setShortQty] = useState(status === 'short' || status === 'partial' ? Math.min(line.qty_received ?? 0, Math.max(0, line.qty_ordered - 1)) : Math.max(0, line.qty_ordered - 1));
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
    <Sheet title={line.description} subtitle={`${line.pack_size ? `Pack ${line.pack_size} · ` : ''}${line.qty_ordered} invoiced · ${line.qty_received ?? 0} received · ${money(Number(line.net))} net · ${line.supplier_sku}`} onClose={onClose}>
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
        <input className="gi-input" type="text" value={line.notes ?? ''} placeholder="For example wet packaging, expires Mar 27"
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
