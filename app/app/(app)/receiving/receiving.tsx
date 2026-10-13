'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
type Receipt={id:string;pharmacy_id:string;supplier:string;delivery_reference:string;description:string;pack_size:string;quantity:number;notes:string;received_at:string;invoice_id:string|null};
type Invoice={id:string;pharmacy_id:string;supplier:string;invoice_number:string};
export default function Receiving({receipts,pharmacies,invoices}:{receipts:Receipt[];pharmacies:{id:string;name:string}[];invoices:Invoice[]}){
 const router=useRouter();const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[showLinked,setShowLinked]=useState(false);const requestInFlight=useRef(false);const preparing=useRef(false);
 async function submit(payload:Record<string,unknown>){if(requestInFlight.current)return false;requestInFlight.current=true;setBusy(true);setError('');try{const response=await fetch('/api/uninvoiced-receipts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save');router.refresh();return true;}catch(e){setError(e instanceof Error?e.message:'Could not save');return false;}finally{requestInFlight.current=false;setBusy(false);}}
 return <div style={{display:'grid',gap:'1.5rem'}}>
 <p>Record one product and pack size at a time. Use the same delivery reference for other products in that delivery. These records do not change stock balances or invoice quantities.</p>
 <form style={{display:'grid',gap:'0.8rem',maxWidth:650}} onSubmit={async e=>{e.preventDefault();if(preparing.current||requestInFlight.current)return;preparing.current=true;const form=e.currentTarget;const values=Object.fromEntries(new FormData(form));try{const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(values))))).map(n=>n.toString(16).padStart(2,'0')).join('');const key=`reckon-pending-receipt:${hash}`;let receiptId=crypto.randomUUID();try{receiptId=sessionStorage.getItem(key)||receiptId;sessionStorage.setItem(key,receiptId);}catch{/* Session storage may be unavailable; current submit remains guarded. */}if(await submit({...values,id:receiptId,quantity:Number(values.quantity)})){try{sessionStorage.removeItem(key);}catch{}form.reset();}}catch{setError('Could not prepare the receipt. Retry in a supported secure browser.');}finally{preparing.current=false;}}}>
 <label>Pharmacy<select name="pharmacy_id" required className="input" disabled={busy}>{pharmacies.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 <label>Supplier<input name="supplier" required maxLength={150} className="input" disabled={busy}/></label>
 <label>Delivery reference<input name="delivery_reference" required maxLength={150} className="input" disabled={busy}/></label>
 <label>Product, strength and form<input name="description" required maxLength={500} className="input" disabled={busy}/></label>
 <label>Pack size<input name="pack_size" required maxLength={100} className="input" disabled={busy}/></label>
 <label>Packs physically received<input name="quantity" type="number" min={1} max={100000} step={1} required className="input" disabled={busy}/></label>
 <label>Location, condition and notes<textarea name="notes" maxLength={2000} className="input" disabled={busy}/></label>
 <button className="btn btn-primary" disabled={busy||!pharmacies.length}>{busy?'Saving…':'Record delivery'}</button>
 </form>
 {error&&<p role="alert" style={{color:'var(--danger)'}}>{error}</p>}
 <section><h2>Delivery records</h2><label><input type="checkbox" checked={showLinked} onChange={e=>setShowLinked(e.target.checked)}/> Include linked records</label>
 {!receipts.filter(r=>showLinked||!r.invoice_id).length&&<p>No deliveries waiting for an invoice.</p>}
 {receipts.filter(r=>showLinked||!r.invoice_id).map(r=><article key={r.id} style={{border:'1px solid var(--border)',borderRadius:12,padding:'1rem',marginTop:'1rem'}}>
 <h3>{r.supplier} · {r.delivery_reference}</h3><p>{r.description} · {r.pack_size} · {r.quantity} packs</p><p>Recorded {new Date(r.received_at).toLocaleString('en-GB')}{r.notes?` — ${r.notes}`:''}</p>
 {r.invoice_id?<p>Linked to <Link href={`/invoices/${r.invoice_id}`}>invoice</Link>. Review its line quantities separately.</p>:<form style={{display:'grid',gap:'0.75rem'}} onSubmit={async e=>{e.preventDefault();const data=new FormData(e.currentTarget);await submit({action:'link',id:r.id,invoice_id:data.get('invoice_id'),confirm:data.get('confirm')==='on'});}}>
 <label>Matching invoice<select name="invoice_id" required className="input" disabled={busy}><option value="">Choose an uploaded invoice</option>{invoices.filter(i=>i.pharmacy_id===r.pharmacy_id&&i.supplier.trim().toLowerCase()===r.supplier.trim().toLowerCase()).map(i=><option key={i.id} value={i.id}>{i.invoice_number}</option>)}</select></label>
 <label><input name="confirm" type="checkbox" required disabled={busy}/> I have checked the product, pack and delivery against this invoice. Linking adds evidence only; I will review invoice quantities without counting these goods again.</label>
 <button className="btn btn-secondary" disabled={busy}>Link invoice</button><Link href="/upload">Upload a missing invoice</Link></form>}
 </article>)}</section></div>;
}
