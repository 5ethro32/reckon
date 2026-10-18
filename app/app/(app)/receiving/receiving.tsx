'use client';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Chevron, Sheet, Stepper, SupplierBadge } from '@/components/goods-in/ui';
import { shortDate, supplierName } from '@/lib/goods-in/supplier';

type Receipt = { id: string; pharmacy_id: string; supplier: string; delivery_reference: string; description: string; pack_size: string; quantity: number; notes: string; received_at: string; invoice_id: string | null };
type Invoice = { id: string; pharmacy_id: string; supplier: string; invoice_number: string };

/**
 * Goods that arrived before their invoice. Record them at the door; when the
 * invoice is uploaded, link it. Linking is evidence only: it does not change
 * stock or invoice quantities. Contract: POST /api/uninvoiced-receipts.
 */
export default function Receiving({ receipts, pharmacies, invoices }: { receipts: Receipt[]; pharmacies: { id: string; name: string }[]; invoices: Invoice[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showLinked, setShowLinked] = useState(false);
  const [recording, setRecording] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const preparing = useRef(false);

  async function submit(payload: Record<string, unknown>) {
    if (requestInFlight.current) return false;
    requestInFlight.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/uninvoiced-receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save');
      router.refresh();
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); return false; }
    finally { requestInFlight.current = false; setBusy(false); }
  }

  const waiting = receipts.filter(r => !r.invoice_id);
  const shown = receipts.filter(r => showLinked || !r.invoice_id);
  const open = receipts.find(r => r.id === openId) ?? null;
  const close = useCallback(() => { setOpenId(null); setError(''); }, []);
  const closeRecord = useCallback(() => { setRecording(false); setError(''); }, []);
  const matching = (r: Receipt) => invoices.filter(i => i.pharmacy_id === r.pharmacy_id && i.supplier.trim().toLowerCase() === r.supplier.trim().toLowerCase());

  return (
    <div className="rc">
      <div className="rc-actions">
        <button type="button" className="gi-btn gi-btn-primary" onClick={() => setRecording(true)} disabled={!pharmacies.length}>Record a delivery</button>
      </div>

      <section className="gi-card" aria-labelledby="rc-list-title">
        <div className="gi-card-head">
          <h2 id="rc-list-title">Waiting for an invoice</h2>
          <button type="button" className="rc-toggle" aria-pressed={showLinked} onClick={() => setShowLinked(v => !v)}>
            {showLinked ? 'Hide linked' : 'Show linked'}
          </button>
        </div>
        {shown.length ? (
          <ul className="gi-rows">
            {shown.map(r => {
              const n = matching(r).length;
              return (
                <li key={r.id}>
                  <button type="button" className="gi-row rc-row" onClick={() => setOpenId(r.id)}>
                    <SupplierBadge supplier={r.supplier} />
                    <span style={{ minWidth: 0 }}>
                      <span className="gi-row-title">{r.description}</span>
                      <span className="gi-row-sub"><span>{supplierName(r.supplier)} · pack {r.pack_size} · {shortDate(r.received_at)}</span></span>
                      <span className="gi-row-sub">
                        {r.invoice_id
                          ? <span className="gi-status"><i className="gi-dot is-good" />Linked to invoice</span>
                          : <span className="gi-status"><i className="gi-dot is-warn" />{n ? `${n} possible ${n === 1 ? 'invoice' : 'invoices'} to link` : 'Invoice not uploaded yet'}</span>}
                      </span>
                    </span>
                    <span className="gi-row-fig"><strong>{r.quantity}</strong><small>{r.quantity === 1 ? 'pack' : 'packs'}</small></span>
                    <Chevron />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="gi-empty">{waiting.length || !receipts.length ? 'Nothing is waiting. When goods arrive without an invoice, record them here.' : 'Every delivery here is linked to its invoice.'}</p>
        )}
      </section>

      {open && (
        <Sheet title={open.description} subtitle={`${supplierName(open.supplier)} · ${open.delivery_reference} · ${open.quantity} ${open.quantity === 1 ? 'pack' : 'packs'} of ${open.pack_size}`} onClose={close}>
          <dl className="rc-facts">
            <div><dt>Recorded</dt><dd>{new Date(open.received_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}</dd></div>
            {open.notes && <div><dt>Notes</dt><dd>{open.notes}</dd></div>}
          </dl>
          {open.invoice_id ? (
            <>
              <p className="gi-note">Linked. Check that invoice&apos;s line quantities without counting these goods again.</p>
              <Link href={`/invoices/${open.invoice_id}`} className="gi-btn gi-btn-primary gi-btn-block" style={{ marginTop: 16 }}>Open the invoice</Link>
            </>
          ) : (
            <LinkForm receipt={open} invoices={matching(open)} busy={busy}
              onLink={async (invoiceId) => { if (await submit({ action: 'link', id: open.id, invoice_id: invoiceId, confirm: true })) close(); }} />
          )}
          {error && <p className="gi-error" role="alert">{error}</p>}
        </Sheet>
      )}

      {recording && (
        <Sheet title="Record a delivery" subtitle="One product and pack size at a time. Use the same delivery reference for the rest of that delivery." onClose={closeRecord}>
          <RecordForm pharmacies={pharmacies} busy={busy} onSubmit={async (form, values, quantity) => {
            if (preparing.current || requestInFlight.current) return;
            preparing.current = true;
            try {
              // The same entry retried reuses its id, so a double tap records it once.
              const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ...values, quantity }))))).map(n => n.toString(16).padStart(2, '0')).join('');
              const key = `reckon-pending-receipt:${hash}`;
              let receiptId: string = crypto.randomUUID();
              try { receiptId = sessionStorage.getItem(key) || receiptId; sessionStorage.setItem(key, receiptId); } catch { /* storage unavailable; the in-flight guard remains */ }
              if (await submit({ ...values, id: receiptId, quantity })) {
                try { sessionStorage.removeItem(key); } catch { /* nothing stored */ }
                form.reset();
                setRecording(false);
              }
            } catch { setError('Could not prepare the record. Try again in a supported, secure browser.'); }
            finally { preparing.current = false; }
          }} />
          {error && <p className="gi-error" role="alert">{error}</p>}
        </Sheet>
      )}
    </div>
  );
}

function LinkForm({ receipt, invoices, busy, onLink }: { receipt: Receipt; invoices: Invoice[]; busy: boolean; onLink: (invoiceId: string) => void }) {
  const [choice, setChoice] = useState(invoices.length === 1 ? invoices[0].id : '');
  const [confirmed, setConfirmed] = useState(false);
  if (!invoices.length) {
    return (
      <div className="rc-link">
        <p className="gi-note">No {supplierName(receipt.supplier)} invoice is uploaded for this pharmacy yet. Upload it, then link it here.</p>
        <Link href="/upload" className="gi-btn gi-btn-primary gi-btn-block">Upload the invoice</Link>
      </div>
    );
  }
  const chosen = invoices.find(i => i.id === choice);
  return (
    <form className="rc-link" onSubmit={e => { e.preventDefault(); if (choice && confirmed) onLink(choice); }}>
      <span className="gi-field">Which invoice covers it?</span>
      <ul className="gi-options">
        {invoices.map(i => (
          <li key={i.id}>
            <button type="button" className="gi-option" aria-pressed={choice === i.id} onClick={() => setChoice(i.id)} disabled={busy}>
              {i.invoice_number}
              {choice === i.id && <svg className="gi-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>
          </li>
        ))}
      </ul>
      <label className="rc-confirm">
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} required />
        <span>I have checked the product, pack and delivery against this invoice. Linking adds evidence only; I will check the invoice quantities without counting these goods again.</span>
      </label>
      <button type="submit" className="gi-btn gi-btn-primary gi-btn-block" disabled={busy || !chosen || !confirmed}>
        {busy ? 'Linking…' : chosen ? `Link to ${chosen.invoice_number}` : 'Choose an invoice'}
      </button>
      <Link href="/upload" className="gi-link rc-upload">Upload a missing invoice</Link>
    </form>
  );
}

function RecordForm({ pharmacies, busy, onSubmit }: {
  pharmacies: { id: string; name: string }[]; busy: boolean;
  onSubmit: (form: HTMLFormElement, values: Record<string, FormDataEntryValue>, quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  return (
    <form className="rc-form" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; onSubmit(form, Object.fromEntries(new FormData(form)), quantity); }}>
      {pharmacies.length > 1 && (
        <label className="gi-field">Pharmacy<select name="pharmacy_id" required className="gi-select" disabled={busy}>{pharmacies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      )}
      {pharmacies.length === 1 && <input type="hidden" name="pharmacy_id" value={pharmacies[0].id} />}
      <label className="gi-field">Wholesaler<input name="supplier" required maxLength={150} className="gi-input" disabled={busy} autoComplete="off" /></label>
      <label className="gi-field">Delivery note or tote reference<input name="delivery_reference" required maxLength={150} className="gi-input" disabled={busy} autoComplete="off" /></label>
      <label className="gi-field">Product, strength and form<input name="description" required maxLength={500} className="gi-input" disabled={busy} autoComplete="off" /></label>
      <label className="gi-field">Pack size<input name="pack_size" required maxLength={100} className="gi-input" disabled={busy} inputMode="numeric" autoComplete="off" /></label>
      <div className="gi-field-row"><span>Packs received</span><Stepper label="Packs received" value={quantity} min={1} max={100000} onChange={setQuantity} /></div>
      <label className="gi-field">Location, condition and notes<textarea name="notes" maxLength={2000} className="gi-input rc-notes" disabled={busy} /></label>
      <button className="gi-btn gi-btn-primary gi-btn-block" disabled={busy || !pharmacies.length}>{busy ? 'Saving…' : 'Record delivery'}</button>
      <p className="gi-note">These records do not change stock balances or invoice quantities.</p>
    </form>
  );
}
