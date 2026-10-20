'use client';

/**
 * The camera strip on the receiving screen.
 *
 * The camera keeps reading. A pack whose barcode this pharmacy has already
 * matched to the invoice line is recorded straight away (tick, short buzz)
 * and its row in the list underneath counts up. A new barcode is matched by
 * the invoice's own GTIN, then NHS dm+d, and needs one tap to confirm the
 * product and pack before it is saved. Packs not on the invoice go to their
 * own list on the screen; expired or short-dated packs are called out.
 *
 * The strip can be made smaller (more of the list in view) or closed.
 * A handheld scanner types into the barcode box.
 *
 * Contracts unchanged: POST /api/receiving/lookup, POST /api/receiving,
 * DELETE /api/barcode-catalog.
 */

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { parsePackBarcode, type PackBarcode } from '@/lib/receiving';
import { CheckIcon, Sheet, Stepper } from '@/components/goods-in/ui';

export type StripLine = { id: string; description: string; pack_size: string | null; supplier_sku?: string | null; qty_ordered: number; qty_received: number | null; flags: string[] };
/** A pack scanned that no invoice line matches. */
export type StrayScan = { key: string; gtin: string; name: string | null; at: number; count: number };

type Lookup = { lineIds: string[]; source: 'invoice' | 'mapping' | 'dmd' | 'none'; dmdName: string | null };
type Pending = { raw: string; pack: PackBarcode; lookup: Lookup; lineId: string | null; quantity: number; choosing: boolean; shortDated: boolean; linear: boolean };
type Result = { key: string; tone: 'good' | 'warn' | 'bad'; title: string; detail?: string; mappingLineId?: string; gtin?: string; stray?: Pending };

/** Packs expiring within this many days are flagged on arrival. */
const SHORT_DATED_DAYS = 90;
const REPEAT_MS = 2500;

function expiryInfo(expiry?: string): { expired: boolean; shortDated: boolean; label: string } | null {
  if (!expiry) return null;
  const at = Date.parse(expiry + 'T23:59:59Z');
  const days = (at - Date.now()) / 86400000;
  const label = new Date(expiry + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).replace('Sept', 'Sep');
  return { expired: days < 0, shortDated: days >= 0 && days <= SHORT_DATED_DAYS, label };
}

function buzz(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

export default function PackReceiving({ invoiceId, invoiceNumber, lines, packs, packsReceived, compact, onToggleCompact, onClose, onRecorded, onStray, onStrayResolved }: {
  invoiceId: string;
  invoiceNumber: string;
  lines: StripLine[];
  packs: number;
  packsReceived: number;
  compact: boolean;
  onToggleCompact: () => void;
  onClose: () => void;
  /** A pack was recorded: the line's new received total. */
  onRecorded: (lineId: string, received: number) => void;
  onStray: (gtin: string, name: string | null) => void;
  onStrayResolved: (gtin: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [cameraError, setCameraError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(0);
  const [typed, setTyped] = useState('');
  const manual = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  const last = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const serials = useRef(new Set<string>());
  const retry = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => { pendingRef.current = pending; }, [pending]);

  const lineById = useCallback((id: string | null) => lines.find(l => l.id === id), [lines]);
  const show = (r: Omit<Result, 'key'>) => setResult({ ...r, key: crypto.randomUUID() });

  async function record(p: Pending, confirmMapping: boolean) {
    const line = lineById(p.lineId);
    if (!line) return;
    busyRef.current = true; setBusy(true);
    try {
      const payload = { lineId: line.id, gtin: p.pack.gtin, scan: p.raw, quantity: p.quantity, batch: p.pack.batch, expiry: p.pack.expiry, serial: p.pack.serial, confirmMapping };
      const key = JSON.stringify(payload);
      // A retry of the same entry reuses its id, so the server records it once.
      if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
      const response = await fetch('/api/receiving', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, eventId: retry.current.id }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? 'Could not record this pack');
      retry.current = null;
      if (p.pack.serial) serials.current.add(`${p.pack.gtin}:${p.pack.serial}`);
      onRecorded(line.id, data.receipt.quantity);
      if (p.lookup.lineIds.length === 0) onStrayResolved(p.pack.gtin);
      setFlash(f => f + 1);
      const exp = expiryInfo(p.pack.expiry);
      if (exp?.shortDated) {
        buzz([40, 60, 40]);
        show({ tone: 'warn', title: `Short-dated, expires ${exp.label}`, detail: `${line.description} · ${data.receipt.quantity} of ${line.qty_ordered}` });
      } else {
        buzz(35);
        show({ tone: 'good', title: line.description, detail: `${data.receipt.quantity} of ${line.qty_ordered}${p.quantity > 1 ? ` · ${p.quantity} packs added` : ''}` });
      }
      setPending(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not record this pack';
      buzz([80, 40, 80]);
      show({ tone: 'bad', title: message, detail: line.description, ...(/different product or pack/.test(message) ? { mappingLineId: line.id, gtin: p.pack.gtin } : {}) });
      setPending(null);
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  async function handle(raw: string) {
    const text = raw.trim();
    if (!text || busyRef.current || pendingRef.current) return;
    const now = Date.now();
    // The camera reads the same pack many times a second: one read per pack in view.
    if (last.current.text === text && now - last.current.at < REPEAT_MS) { last.current.at = now; return; }
    last.current = { text, at: now };
    let pack: PackBarcode;
    try { pack = parsePackBarcode(text); } catch (e) {
      show({ tone: 'bad', title: 'Barcode not read', detail: e instanceof Error ? e.message : undefined });
      return;
    }
    if (pack.serial && serials.current.has(`${pack.gtin}:${pack.serial}`)) {
      show({ tone: 'warn', title: 'Already scanned', detail: 'This exact pack was counted a moment ago.' });
      return;
    }
    const exp = expiryInfo(pack.expiry);
    if (exp?.expired) {
      buzz([80, 40, 80]);
      show({ tone: 'bad', title: `Expired ${exp.label}`, detail: 'Set it aside and record the line as a problem.' });
      return;
    }
    busyRef.current = true; setBusy(true);
    let lookup: Lookup = { lineIds: [], source: 'none', dmdName: null };
    try {
      const response = await fetch('/api/receiving/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId, gtin: pack.gtin }) });
      const data = await response.json();
      if (response.ok) lookup = { lineIds: data.lineIds ?? [], source: data.source, dmdName: data.dmdName ?? null };
    } catch { /* treated as not recognised */ }
    busyRef.current = false; setBusy(false);
    const p: Pending = { raw: text, pack, lookup, lineId: lookup.lineIds.length === 1 ? lookup.lineIds[0] : null, quantity: 1, choosing: lookup.lineIds.length > 1, shortDated: !!exp?.shortDated, linear: !pack.batch && !pack.expiry && !pack.serial };
    if (lookup.source === 'mapping' && lookup.lineIds.length === 1) { await record(p, false); return; }
    if (lookup.lineIds.length === 0) {
      // Not on the invoice: it joins its own list and scanning carries on. If it does belong, the
      // result offers the line list.
      buzz([60, 50, 60]);
      onStray(pack.gtin, lookup.dmdName);
      show({ tone: 'warn', title: 'Not on this invoice, set it aside', detail: lookup.dmdName ?? `Barcode ${pack.gtin}`, stray: p });
      return;
    }
    setPending(p);
  }

  const onDecode = useEffectEvent((text: string) => { void handle(text); });

  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    let controls: { stop(): void } | undefined;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Error('The camera needs a secure (https) page and a supported browser. Type the barcode, use a handheld scanner, or tick the lines by hand.');
        const [{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        if (cancelled || !video.current) return;
        // ASSUME_GS1 keeps FNC1 separators in GS1 codes; TRY_HARDER helps small DataMatrix codes on packs.
        const hints = new Map<unknown, unknown>([[DecodeHintType.ASSUME_GS1, true], [DecodeHintType.TRY_HARDER, true]]);
        const reader = new BrowserMultiFormatReader(hints as Map<never, unknown>);
        reader.possibleFormats = [BarcodeFormat.DATA_MATRIX, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE];
        controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video.current, result => {
          if (!cancelled && result) onDecode(result.getText());
        });
        if (cancelled) controls.stop();
        else setCameraError('');
      } catch (e) {
        if (!cancelled) { setCameraError(e instanceof Error && e.message ? e.message : 'Camera unavailable. Type the barcode, use a handheld scanner, or tick the lines by hand.'); setCameraOn(false); }
      }
    })();
    return () => { cancelled = true; controls?.stop(); };
  }, [cameraOn]);

  // Desktop: handheld scanners type into the barcode box, so it starts focused.
  useEffect(() => {
    if (window.matchMedia('(min-width: 769px) and (pointer: fine)').matches) manual.current?.focus();
  }, []);

  async function removeMapping(r: Result) {
    if (!r.mappingLineId || !r.gtin) return;
    setBusy(true);
    try {
      const response = await fetch('/api/barcode-catalog', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineId: r.mappingLineId, gtin: r.gtin }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? 'Could not remove the saved barcode');
      show({ tone: 'good', title: data.removed ? 'Old barcode removed' : 'No saved barcode to remove', detail: 'Scan the pack again and confirm the product.' });
      last.current = { text: '', at: 0 };
    } catch (e) {
      show({ tone: 'bad', title: e instanceof Error ? e.message : 'Could not remove the saved barcode' });
    } finally { setBusy(false); }
  }

  const chosen = lineById(pending?.lineId ?? null);
  const candidates = pending ? (pending.lookup.lineIds.length > 1 ? lines.filter(l => pending.lookup.lineIds.includes(l.id)) : lines) : [];
  const exp = pending ? expiryInfo(pending.pack.expiry) : null;
  const skip = () => setPending(null);

  return (
    <section className={`gr-strip${compact ? ' is-compact' : ''}${cameraOn ? '' : ' is-off'}`} aria-label={`Scan packs for ${invoiceNumber}`}>
      <div className="gr-camera">
        <video ref={video} muted playsInline aria-hidden="true" />
        <div className={`gs-frame gr-frame${flash ? ' is-hit' : ''}`} key={flash} aria-hidden="true">
          {flash > 0 && <span className="gs-hit"><CheckIcon /></span>}
        </div>
        <div className="gr-cam-top">
          <button type="button" className="gr-pill" onClick={onClose}>Done</button>
          <span className="gr-pill gr-count tnum" aria-live="polite">{packsReceived} of {packs} packs</span>
          <button type="button" className="gr-pill gr-size" onClick={onToggleCompact} aria-label={compact ? 'Make the camera larger' : 'Make the camera smaller'} aria-pressed={compact}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={compact ? 'M4 6.5 8 10.5l4-4' : 'M4 9.5 8 5.5l4 4'} />
            </svg>
          </button>
        </div>
        {!cameraOn && (
          <div className="gr-cam-off">
            <p>{cameraError || 'Camera paused.'}</p>
            <button type="button" className="gr-pill" onClick={() => { setCameraError(''); setCameraOn(true); }}>Try the camera again</button>
          </div>
        )}
        {cameraOn && !result && <p className="gr-hint" aria-hidden="true">{busy ? 'Checking…' : 'Point at the barcode on a pack'}</p>}
      </div>

      <div className="gr-strip-foot">
        <p className={`gr-last${result ? ` is-${result.tone}` : ''}`} role="status" aria-live="polite">
          {result ? (
            <>
              <span className="gr-last-mark" aria-hidden="true">{result.tone === 'good' ? <CheckIcon /> : '!'}</span>
              <span className="gr-last-text"><strong>{result.title}</strong>{result.detail && <span className="tnum">{result.detail}</span>}</span>
              {result.mappingLineId && <button type="button" className="gs-text-btn" disabled={busy} onClick={() => void removeMapping(result)}>Remove saved barcode</button>}
              {result.stray && <button type="button" className="gs-text-btn" disabled={busy || !!pending} onClick={() => setPending({ ...result.stray!, choosing: true })}>Choose line</button>}
            </>
          ) : <span className="gr-last-text"><span>{busy ? 'Checking…' : 'Each pack you scan counts on its line below.'}</span></span>}
        </p>
        <form className="gr-manual" onSubmit={e => { e.preventDefault(); last.current = { text: '', at: 0 }; void handle(typed); setTyped(''); }}>
          <input ref={manual} className="gi-input" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Type or scan a barcode"
            autoComplete="off" inputMode="numeric" aria-label="Barcode" disabled={!!pending} />
          <button type="submit" className="gi-btn gi-btn-quiet gi-btn-sm" disabled={!typed.trim() || !!pending}>Add</button>
        </form>
      </div>

      {pending && (
        <Sheet
          title={chosen && !pending.choosing ? chosen.description : 'Which line is this pack?'}
          subtitle={chosen && !pending.choosing ? `${chosen.pack_size ? `Pack ${chosen.pack_size} · ` : ''}${chosen.qty_received ?? 0} of ${chosen.qty_ordered} received` : undefined}
          onClose={skip}
        >
          {pending.choosing ? (
            <>
              {pending.lookup.lineIds.length > 1 && <p className="gr-sheet-text">This barcode fits {pending.lookup.lineIds.length} lines.</p>}
              <ul className="gi-options gr-choices">
                {candidates.map(l => (
                  <li key={l.id}>
                    <button type="button" className="gi-option" aria-pressed={pending.lineId === l.id}
                      onClick={() => setPending({ ...pending, lineId: l.id, choosing: false })}>
                      <span className="gs-choice-name">{l.description}</span>
                      <small className="tnum">{l.qty_received ?? 0} of {l.qty_ordered}</small>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="gi-btn gi-btn-quiet gi-btn-block" onClick={skip}>Skip this pack</button>
            </>
          ) : chosen ? (
            <>
              <p className="gr-sheet-text">
                {pending.lookup.source === 'dmd' ? `Suggested from NHS dm+d (${pending.lookup.dmdName}). ` : pending.lookup.source === 'invoice' ? 'Matched by the barcode printed on the invoice. ' : ''}
                Check the product and pack size match, then record. The barcode is saved for next time.
              </p>
              {exp?.shortDated && <p className="gr-sheet-text"><i className="gi-dot is-warn" /> Short-dated, expires {exp.label}.</p>}
              {!chosen.pack_size && <p className="gi-error">This line has no pack size on the invoice. Check the invoice before receiving by barcode.</p>}
              <div className="gr-sheet-row">
                {!pending.pack.serial && (
                  <Stepper label="Packs" value={pending.quantity} min={1} max={Math.max(1, chosen.qty_ordered - (chosen.qty_received ?? 0))}
                    onChange={n => setPending({ ...pending, quantity: n })} />
                )}
                <button type="button" className="gi-btn gi-btn-primary" disabled={busy || !chosen.pack_size} onClick={() => void record(pending, true)}>
                  {busy ? 'Saving…' : `Record ${pending.quantity} ${pending.quantity === 1 ? 'pack' : 'packs'}`}
                </button>
              </div>
              {pending.linear && (
                // A plain (linear) barcode names the product only; batch and expiry can be typed from the pack.
                <details className="gs-extra">
                  <summary>Add batch and expiry</summary>
                  <div className="gs-extra-fields">
                    <label className="gi-field">Batch<input className="gi-input" maxLength={100} value={pending.pack.batch ?? ''}
                      onChange={e => setPending({ ...pending, pack: { ...pending.pack, batch: e.target.value || undefined } })} /></label>
                    <label className="gi-field">Expiry<input className="gi-input" type="date" value={pending.pack.expiry ?? ''}
                      onChange={e => setPending({ ...pending, pack: { ...pending.pack, expiry: e.target.value || undefined } })} /></label>
                  </div>
                </details>
              )}
              <div className="gs-secondary">
                <button type="button" className="gs-text-btn" onClick={() => setPending({ ...pending, choosing: true })}>Choose another line</button>
                <button type="button" className="gs-text-btn" onClick={skip}>Skip this pack</button>
              </div>
            </>
          ) : null}
        </Sheet>
      )}
    </section>
  );
}
