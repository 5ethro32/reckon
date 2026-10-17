'use client';

/**
 * Full-screen pack scanning.
 *
 * The camera keeps reading. A pack whose barcode this pharmacy has already
 * matched to the invoice line is recorded straight away (tick, short buzz).
 * A new barcode is matched by the invoice's own GTIN, then NHS dm+d, and needs
 * one tap to confirm the product and pack before it is saved, as before.
 * Packs not on the invoice, expired or short-dated packs are called out.
 *
 * Contracts unchanged: POST /api/receiving/lookup, POST and GET /api/receiving,
 * DELETE /api/barcode-catalog.
 */

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { parsePackBarcode, type PackBarcode } from '@/lib/receiving';
import { CheckIcon, Stepper } from '@/components/goods-in/ui';

type Line = { id: string; description: string; pack_size: string | null; supplier_sku?: string | null; qty_ordered: number; qty_received: number | null; flags?: string[] };

type Lookup = { lineIds: string[]; source: 'invoice' | 'mapping' | 'dmd' | 'none'; dmdName: string | null };
type Pending = { raw: string; pack: PackBarcode; lookup: Lookup; lineId: string | null; quantity: number; choosing: boolean; shortDated: boolean; linear: boolean };
type Result = { key: string; tone: 'good' | 'warn' | 'bad'; title: string; detail?: string; mappingLineId?: string; gtin?: string };

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

export default function PackReceiving({ invoiceId, invoiceNumber, lines, onClose }: {
  invoiceId: string; invoiceNumber: string; lines: Line[]; onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [cameraError, setCameraError] = useState('');
  const [count, setCount] = useState(0);
  const [received, setReceived] = useState<Record<string, number>>(() => Object.fromEntries(lines.map(l => [l.id, l.qty_received ?? 0])));
  const [results, setResults] = useState<Result[]>([]);
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
  const push = (r: Omit<Result, 'key'>) => setResults(prev => [{ ...r, key: crypto.randomUUID() }, ...prev].slice(0, 6));

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
      setCount(c => c + p.quantity);
      setReceived(prev => ({ ...prev, [line.id]: data.receipt.quantity }));
      setFlash(f => f + 1);
      const exp = expiryInfo(p.pack.expiry);
      if (exp?.shortDated) {
        buzz([40, 60, 40]);
        push({ tone: 'warn', title: `Short-dated · expires ${exp.label}`, detail: `${line.description} · ${data.receipt.quantity} of ${line.qty_ordered} received` });
      } else {
        buzz(35);
        push({ tone: 'good', title: line.description, detail: `${data.receipt.quantity} of ${line.qty_ordered} received${p.quantity > 1 ? ` · ${p.quantity} packs added` : ''}` });
      }
      setPending(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not record this pack';
      buzz([80, 40, 80]);
      push({ tone: 'bad', title: message, detail: line.description, ...(/different product or pack/.test(message) ? { mappingLineId: line.id, gtin: p.pack.gtin } : {}) });
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
      push({ tone: 'bad', title: 'Barcode not read', detail: e instanceof Error ? e.message : undefined });
      return;
    }
    if (pack.serial && serials.current.has(`${pack.gtin}:${pack.serial}`)) {
      push({ tone: 'warn', title: 'Already scanned', detail: 'This exact pack was counted a moment ago.' });
      return;
    }
    const exp = expiryInfo(pack.expiry);
    if (exp?.expired) {
      buzz([80, 40, 80]);
      push({ tone: 'bad', title: `Expired ${exp.label}`, detail: 'Set it aside and record the line as a problem.' });
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
    if (lookup.lineIds.length === 0) buzz([60, 50, 60]);
    setPending(p);
  }

  const onDecode = useEffectEvent((text: string) => { void handle(text); });

  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    let controls: { stop(): void } | undefined;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Error('The camera needs a secure (https) page and a supported browser. Type the barcode or use a handheld scanner below.');
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
        if (!cancelled) { setCameraError(e instanceof Error && e.message ? e.message : 'Camera unavailable. Type the barcode or use a handheld scanner below.'); setCameraOn(false); }
      }
    })();
    return () => { cancelled = true; controls?.stop(); };
  }, [cameraOn]);

  // Desktop: handheld scanners type into the barcode box, so it starts focused.
  useEffect(() => {
    if (window.matchMedia('(min-width: 769px) and (pointer: fine)').matches) manual.current?.focus();
  }, []);

  // Escape closes; the page behind does not scroll.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pendingRef.current) onClose(); };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [onClose]);

  async function removeMapping(r: Result) {
    if (!r.mappingLineId || !r.gtin) return;
    setBusy(true);
    try {
      const response = await fetch('/api/barcode-catalog', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineId: r.mappingLineId, gtin: r.gtin }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? 'Could not remove the saved barcode');
      setResults(prev => prev.filter(x => x.key !== r.key));
      push({ tone: 'good', title: data.removed ? 'Old barcode removed' : 'No saved barcode to remove', detail: 'Scan the pack again and confirm the product.' });
      last.current = { text: '', at: 0 };
    } catch (e) {
      push({ tone: 'bad', title: e instanceof Error ? e.message : 'Could not remove the saved barcode' });
    } finally { setBusy(false); }
  }

  const totalOrdered = lines.reduce((s, l) => s + l.qty_ordered, 0);
  const totalReceived = Object.values(received).reduce((s, n) => s + n, 0);
  const chosen = lineById(pending?.lineId ?? null);
  const candidates = pending ? (pending.lookup.lineIds.length > 1 ? lines.filter(l => pending.lookup.lineIds.includes(l.id)) : lines) : [];
  const exp = pending ? expiryInfo(pending.pack.expiry) : null;

  return (
    <div className="gi gs" role="dialog" aria-modal="true" aria-label={`Scan packs for ${invoiceNumber}`}>
      <div className="gs-camera">
        <video ref={video} muted playsInline aria-hidden="true" />
        <div className={`gs-frame${flash ? ' is-hit' : ''}`} key={flash} aria-hidden="true">
          {flash > 0 && <span className="gs-hit"><CheckIcon /></span>}
        </div>
        <div className="gs-top">
          <button type="button" className="gs-done" onClick={onClose}>Done</button>
          <span className="gs-title">{invoiceNumber}</span>
          <span className="gs-count tnum" aria-live="polite">{count} {count === 1 ? 'pack' : 'packs'}</span>
        </div>
        {!cameraOn && (
          <div className="gs-camera-off">
            <p>{cameraError || 'Camera paused.'}</p>
            <button type="button" className="gi-btn gi-btn-sm gs-ghost" onClick={() => { setCameraError(''); setCameraOn(true); }}>Try the camera again</button>
          </div>
        )}
        <p className="gs-hint" aria-hidden="true">{busy ? 'Checking…' : 'Point at the barcode on the pack'}</p>
      </div>

      <div className="gs-panel">
        <div className="gs-tally">
          <span className="tnum"><strong>{totalReceived}</strong> of {totalOrdered} packs received</span>
          <span className="gi-track" aria-hidden="true"><span className="is-good" style={{ width: `${totalOrdered ? Math.min(100, (totalReceived / totalOrdered) * 100) : 0}%` }} /></span>
        </div>

        {pending && (
          <div className={`gs-card${pending.lookup.lineIds.length === 0 && !chosen ? ' is-warn' : ''}`} role="alert">
            {pending.lookup.lineIds.length === 0 && !pending.lineId ? (
              <>
                <p className="gs-card-title"><i className="gi-dot is-warn" />Not on this invoice</p>
                <p className="gs-card-text">{pending.lookup.dmdName ? `NHS dm+d lists this pack as ${pending.lookup.dmdName}, but no line on ${invoiceNumber} matches it.` : 'This barcode is not known yet and no invoice line matches it.'} Set it aside, or choose the line if you are sure it belongs here.</p>
              </>
            ) : chosen && !pending.choosing ? (
              <>
                <p className="gs-card-title">{chosen.description}</p>
                <p className="gs-card-text">
                  {chosen.pack_size ? `Pack ${chosen.pack_size} · ` : ''}{received[chosen.id] ?? 0} of {chosen.qty_ordered} received.{' '}
                  {pending.lookup.source === 'dmd' ? `Suggested from NHS dm+d (${pending.lookup.dmdName}).` : pending.lookup.source === 'invoice' ? 'Matched by the barcode printed on the invoice.' : ''}{' '}
                  Check the product and pack size match, then record. The barcode is saved for next time.
                </p>
                {exp?.shortDated && <p className="gs-card-text"><i className="gi-dot is-warn" /> Short-dated: expires {exp.label}.</p>}
              </>
            ) : (
              <p className="gs-card-title">{pending.lookup.lineIds.length > 1 ? `This barcode fits ${pending.lookup.lineIds.length} lines. Which one is it?` : 'Which line is this pack?'}</p>
            )}

            {pending.choosing && (
              <ul className="gs-choices">
                {candidates.map(l => (
                  <li key={l.id}>
                    <button type="button" className="gi-option" aria-pressed={pending.lineId === l.id}
                      onClick={() => setPending({ ...pending, lineId: l.id, choosing: false })}>
                      <span className="gs-choice-name">{l.description}</span>
                      <small>{l.pack_size ? `${l.pack_size} · ` : ''}{received[l.id] ?? 0}/{l.qty_ordered}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {chosen && !pending.choosing && (
              <div className="gs-actions">
                {!pending.pack.serial && (
                  <Stepper label="Packs" value={pending.quantity} min={1} max={Math.max(1, chosen.qty_ordered - (received[chosen.id] ?? 0))}
                    onChange={n => setPending({ ...pending, quantity: n })} />
                )}
                <button type="button" className="gi-btn gi-btn-primary" disabled={busy || !chosen.pack_size} onClick={() => void record(pending, true)}>
                  {busy ? 'Saving…' : `Record ${pending.quantity} ${pending.quantity === 1 ? 'pack' : 'packs'}`}
                </button>
              </div>
            )}
            {chosen && !pending.choosing && pending.linear && (
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
            {chosen && !chosen.pack_size &&<p className="gi-error">This line has no pack size on the invoice. Check the invoice before receiving by barcode.</p>}
            <div className="gs-secondary">
              {chosen && !pending.choosing && <button type="button" className="gs-text-btn" onClick={() => setPending({ ...pending, choosing: true })}>Choose another line</button>}
              {pending.lookup.lineIds.length === 0 && !pending.choosing && <button type="button" className="gs-text-btn" onClick={() => setPending({ ...pending, choosing: true })}>Choose a line</button>}
              <button type="button" className="gs-text-btn" onClick={() => setPending(null)}>Skip this pack</button>
            </div>
          </div>
        )}

        <ul className="gs-results" aria-live="polite">
          {results.map(r => (
            <li key={r.key} className={`is-${r.tone}`}>
              <span className="gs-result-mark" aria-hidden="true">{r.tone === 'good' ? <CheckIcon /> : '!'}</span>
              <span className="gs-result-body">
                <strong>{r.title}</strong>
                {r.detail && <small>{r.detail}</small>}
                {r.mappingLineId && <button type="button" className="gs-text-btn" disabled={busy} onClick={() => void removeMapping(r)}>Remove the old saved barcode (owner or admin)</button>}
              </span>
            </li>
          ))}
          {!results.length && !pending && <li className="gs-empty">Each pack you scan is counted here.</li>}
        </ul>

        <form className="gs-manual" onSubmit={e => { e.preventDefault(); last.current = { text: '', at: 0 }; void handle(typed); setTyped(''); }}>
          <input ref={manual} className="gi-input" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Type or scan a barcode"
            autoComplete="off" inputMode="text" aria-label="Barcode" disabled={!!pending} />
          <button type="submit" className="gi-btn gi-btn-quiet" disabled={!typed.trim() || !!pending}>Add</button>
        </form>
        <p className="gi-note">Pack names and barcodes from the NHS Dictionary of Medicines and Devices (dm+d), Open Government Licence v3.0.</p>
      </div>
    </div>
  );
}
