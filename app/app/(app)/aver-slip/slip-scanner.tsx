'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Camera (or a handheld scanner typing into the box) reads the slip QR; the server brings the invoice in. */
export default function SlipScanner() {
  const router = useRouter();
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
      if (!ids.length) throw Error('No invoice on this slip.');
      setCameraOn(false);
      router.push(ids.length === 1 ? `/invoices/${ids[0]}?scan=1` : '/invoices?status=open');
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
