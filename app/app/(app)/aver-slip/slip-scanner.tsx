'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { Chevron, ScanIcon, SupplierBadge } from '@/components/goods-in/ui';
import { money, supplierName } from '@/lib/goods-in/supplier';
import { deliveryFacts } from '@/lib/receiving-progress';

/** One invoice the slip brought in, as the slip API describes it. */
export type SlipDelivery = { id: string; supplier: string; invoiceNumber: string; invoiceDate: string; gross: number; lines: number; packs: number; checked: number };

/**
 * Camera (or a handheld scanner typing into the box) reads the slip QR; the server brings the invoice in.
 * Then it says what was opened, "Aver delivery 5804180, 19 Oct, 42 lines, 91 packs", before checking starts.
 */
export default function SlipScanner() {
  const [opened, setOpened] = useState<SlipDelivery[] | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [status, setStatus] = useState<{ tone: 'idle' | 'busy' | 'bad'; text: string }>({ tone: 'idle', text: 'Point the camera at the slip QR.' });
  const [code, setCode] = useState('');
  const busy = useRef(false);

  async function submit(text: string) {
    const raw = text.trim();
    if (!raw || busy.current) return;
    if (!/^AVERPL:/i.test(raw)) {
      setStatus({ tone: 'bad', text: /^AVERCD:/i.test(raw) ? 'That is the CD sheet. Scan the code on the picking slip.' : 'That is not an Aver slip code.' });
      return;
    }
    busy.current = true;
    setStatus({ tone: 'busy', text: 'Bringing in the invoice…' });
    try {
      const res = await fetch('/api/aver/slip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: raw }) });
      const data = await res.json();
      if (!res.ok) throw Error(data.error ?? 'Could not read the slip');
      const ids: string[] = data.invoiceIds ?? [];
      const deliveries: SlipDelivery[] = data.deliveries ?? [];
      if (!ids.length) throw Error('No invoice on this slip.');
      // The invoices are in; if their summary could not be read, open them without it.
      if (!deliveries.length) { window.location.assign(ids.length === 1 ? `/invoices/${ids[0]}?scan=1` : '/invoices?status=open'); return; }
      setCameraOn(false);
      setOpened(deliveries);
      setStatus({ tone: 'idle', text: '' });
      busy.current = false;
    } catch (e) {
      setStatus({ tone: 'bad', text: e instanceof Error ? e.message : 'Could not read the slip' });
      busy.current = false;
    }
  }
  const onDecode = useEffectEvent((text: string) => { void submit(text); });

  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    let controls: { stop(): void } | undefined;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Error('No camera here. Type or paste the code below.');
        const [{ BrowserMultiFormatReader, BarcodeFormat }] = await Promise.all([import('@zxing/browser')]);
        if (cancelled || !video.current) return;
        const reader = new BrowserMultiFormatReader();
        reader.possibleFormats = [BarcodeFormat.QR_CODE];
        controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video.current, (result) => {
          if (!cancelled && result) onDecode(result.getText());
        });
        if (cancelled) controls.stop();
      } catch (e) {
        if (!cancelled) { setStatus({ tone: 'bad', text: e instanceof Error && e.message ? e.message : 'Camera unavailable. Type or paste the code below.' }); setCameraOn(false); }
      }
    })();
    return () => { cancelled = true; controls?.stop(); };
  }, [cameraOn]);

  if (opened) return <Opened deliveries={opened} onAgain={() => { setOpened(null); setCode(''); setStatus({ tone: 'idle', text: 'Point the camera at the slip QR.' }); setCameraOn(true); }} />;

  return (
    <section className="gi-card as-card">
      {cameraOn && (
        <div className="as-camera">
          <video ref={video} muted playsInline aria-hidden="true" />
          <span className="as-frame" aria-hidden="true" />
        </div>
      )}
      <p className={`as-status is-${status.tone}`} role="status" aria-live="polite">{status.text}</p>
      <form className="as-manual" onSubmit={(e) => { e.preventDefault(); void submit(code); }}>
        <input className="gi-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="AVERPL:…" aria-label="Slip code" autoComplete="off" spellCheck={false} />
        <button type="submit" className="gi-btn gi-btn-primary">Bring in</button>
      </form>
      {!cameraOn && status.tone !== 'busy' && (
        <button type="button" className="gi-btn gi-btn-quiet gi-btn-block as-retry" onClick={() => { busy.current = false; setStatus({ tone: 'idle', text: 'Point the camera at the slip QR.' }); setCameraOn(true); }}>Use the camera</button>
      )}
    </section>
  );
}

/** What the slip opened. One invoice: its facts and one action. Several: a row each. */
function Opened({ deliveries, onAgain }: { deliveries: SlipDelivery[]; onAgain: () => void }) {
  const one = deliveries.length === 1 ? deliveries[0]! : null;
  const status = (d: SlipDelivery) => d.checked === 0 ? 'Ready to check' : d.checked >= d.lines ? 'Already checked' : `${d.checked} of ${d.lines} lines already checked`;
  return (
    <section className="gi-card as-card as-opened" aria-live="polite">
      <p className="as-opened-label">{one ? 'Delivery opened' : `This slip has ${deliveries.length} invoices`}</p>
      {one ? (
        <div className="as-delivery">
          <SupplierBadge supplier={one.supplier} />
          <div className="as-delivery-main">
            <h2 className="tnum">{supplierName(one.supplier)} delivery {one.invoiceNumber}</h2>
            <p className="tnum">{deliveryFacts(one.invoiceDate, one.lines, one.packs)}</p>
            <p className="tnum as-delivery-sub">{money(one.gross)} · {status(one)}</p>
          </div>
        </div>
      ) : (
        <ul className="gi-rows as-rows">
          {deliveries.map(d => (
            <li key={d.id}>
              <Link href={`/invoices/${d.id}?scan=1`} className="gi-row">
                <SupplierBadge supplier={d.supplier} />
                <span style={{ minWidth: 0 }}>
                  <span className="gi-row-title tnum">{supplierName(d.supplier)} delivery {d.invoiceNumber}</span>
                  <span className="gi-row-sub tnum"><span>{deliveryFacts(d.invoiceDate, d.lines, d.packs)}</span></span>
                </span>
                <span className="gi-row-fig"><strong>{money(d.gross)}</strong><small>{d.checked ? `${d.checked} of ${d.lines} checked` : 'To check'}</small></span>
                <Chevron />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="as-opened-actions">
        {one && <Link href={`/invoices/${one.id}?scan=1`} className="gi-btn gi-btn-primary gi-btn-block"><ScanIcon />{one.checked >= one.lines && one.lines > 0 ? 'Open delivery' : 'Start checking'}</Link>}
        <button type="button" className="gi-btn gi-btn-quiet gi-btn-block" onClick={onAgain}>Scan another slip</button>
      </div>
    </section>
  );
}
