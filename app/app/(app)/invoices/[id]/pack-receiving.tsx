'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parsePackBarcode } from '@/lib/receiving';
import CatalogImport from './barcode-catalog-import';
type Line = { id: string; description: string; pack_size: string | null; qty_ordered: number; qty_received: number | null };
type Receipt = { id:string; quantity:number; gtin:string; batch:string|null; expiry:string|null; serial:string|null; recorded_at:string; recorded_by:string };
export default function PackReceiving({ lines }: { lines: Line[] }) {
 const router=useRouter();
 const [lineId,setLineId]=useState(lines[0]?.id??'');
 const [barcode,setBarcode]=useState(''); const [quantity,setQuantity]=useState(1);
 const [batch,setBatch]=useState('');const [expiry,setExpiry]=useState(''); const [serial,setSerial]=useState('');
 const [confirmed,setConfirmed]=useState(false);const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);const [camera,setCamera]=useState(false);
 const [history,setHistory]=useState<{key:string;events:Receipt[];error:string}>({key:'',events:[],error:''});const [historyVersion,setHistoryVersion]=useState(0);
 const historyLoading=history.key!==`${lineId}:${historyVersion}`;const events=history.events;const historyError=history.error;
 const video=useRef<HTMLVideoElement>(null);const barcodeInput=useRef<HTMLInputElement>(null);
 const retry=useRef<{key:string;id:string}|null>(null);const pending=useRef(false);
 function capture(raw:string) {
  const pack=parsePackBarcode(raw);setBarcode(pack.gtin);setBatch(pack.batch??'');setExpiry(pack.expiry??'');setSerial(pack.serial??'');setConfirmed(false);if(pack.serial)setQuantity(1);
  setMessage('Barcode read. Check the selected product, pack size and quantity before recording.');
 }
 useEffect(()=>{
  if(!camera)return;
  let cancelled=false;let controls:{stop():void}|undefined;
  async function start(){
   try {
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access needs HTTPS and a supported browser. Use a handheld scanner or type the barcode.');
    const [{BrowserMultiFormatReader,BarcodeFormat},{DecodeHintType}]=await Promise.all([import('@zxing/browser'),import('@zxing/library')]);
    if(cancelled || !video.current)return;
    // ASSUME_GS1 keeps FNC1 separators in GS1-128 codes; TRY_HARDER helps small pack DataMatrix codes.
    const hints=new Map<unknown,unknown>([[DecodeHintType.ASSUME_GS1,true],[DecodeHintType.TRY_HARDER,true]]);
    const reader=new BrowserMultiFormatReader(hints as Map<never,unknown>);
    reader.possibleFormats=[BarcodeFormat.EAN_13,BarcodeFormat.EAN_8,BarcodeFormat.UPC_A,BarcodeFormat.DATA_MATRIX,BarcodeFormat.CODE_128,BarcodeFormat.QR_CODE];
    controls=await reader.decodeFromConstraints({video:{facingMode:{ideal:'environment'}}},video.current,(result)=>{
     if(cancelled || !result || pending.current)return;
     try{capture(result.getText());setCamera(false);}catch(e){setMessage(e instanceof Error?e.message:'Could not read this barcode');}
    });
    if(cancelled)controls.stop();
   }catch(e){if(!cancelled){setMessage(e instanceof Error?e.message:'Camera unavailable. Use a handheld scanner or enter the barcode.');setCamera(false);}}
  }
  void start();return()=>{cancelled=true;controls?.stop();};
 },[camera]);
 useEffect(()=>{
  if(!lineId)return;const controller=new AbortController();const key=`${lineId}:${historyVersion}`;
  fetch(`/api/receiving?lineId=${encodeURIComponent(lineId)}`,{signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);if(!controller.signal.aborted)setHistory({key,events:data.events,error:''});}).catch(e=>{if(!controller.signal.aborted)setHistory({key,events:[],error:e instanceof Error?e.message:'History unavailable'});});
  return()=>controller.abort();
 },[lineId,historyVersion]);
 async function save(event:React.FormEvent){
  event.preventDefault();if(pending.current)return;pending.current=true;setCamera(false);setBusy(true);setMessage('');
  try{
   const pack=parsePackBarcode(barcode);
   const payload={lineId,gtin:pack.gtin,quantity,batch:batch||pack.batch,expiry:expiry||pack.expiry,serial:serial||pack.serial,confirmMapping:confirmed};
   const key=JSON.stringify(payload);
   if(retry.current?.key!==key){
    let previous:{key:string;id:string}|null=null;
    try{previous=JSON.parse(sessionStorage.getItem(`reckon-receipt:${lineId}`)??'null');}catch{/* Storage may be unavailable in private browsing. */}
    retry.current=previous?.key===key&&typeof previous.id==='string'?previous:{key,id:crypto.randomUUID()};
   }
   try{sessionStorage.setItem(`reckon-receipt:${lineId}`,JSON.stringify(retry.current));}catch{/* In-memory retry remains available. */}
   const response=await fetch('/api/receiving',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,eventId:retry.current.id})});
   const data=await response.json();if(!response.ok)throw Error(data.error??'Could not record receipt');
   try{sessionStorage.removeItem(`reckon-receipt:${lineId}`);}catch{/* No persistent storage. */}
   retry.current=null;setBarcode('');setConfirmed(false);setQuantity(1);setBatch('');setExpiry('');setSerial('');
   setMessage(`Saved. ${data.receipt.quantity} ${data.receipt.quantity===1?'pack':'packs'} received on this line.`);setHistoryVersion(v=>v+1);router.refresh();barcodeInput.current?.focus();
  }catch(e){setMessage(e instanceof Error?e.message:'Could not record receipt. Retry the same entry to confirm.');}
  finally{pending.current=false;setBusy(false);}
 }
 async function removeMapping(){
  if(pending.current)return;pending.current=true;setBusy(true);
  try{
   const gtin=parsePackBarcode(barcode).gtin;
   const response=await fetch('/api/barcode-catalog',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({lineId,gtin})});
   const data=await response.json();if(!response.ok)throw Error(data.error??'Could not remove mapping');
   setConfirmed(false);
   setMessage(data.removed?'Old mapping removed. Check the product and pack, tick the confirmation and record again.':'No mapping was stored for this barcode and supplier.');
  }catch(e){setMessage(e instanceof Error?e.message:'Could not remove mapping');}
  finally{pending.current=false;setBusy(false);}
 }
 const selected=lines.find(l=>l.id===lineId);
 return <section className="card" style={{padding:'1.5rem',marginBottom:'1.5rem'}}>
  <h2>Receive packs</h2>
  <p>Choose the invoice product, scan its pack and record what arrived. A barcode identifies the pack; it does not count it or check its condition.</p>
  <form onSubmit={save} style={{display:'grid',gap:'0.8rem',maxWidth:640}}>
   <label>Invoice product<select className="input" disabled={busy} value={lineId} onChange={e=>{setLineId(e.target.value);setConfirmed(false);}} style={{display:'block',width:'100%',minHeight:44}}>{lines.map(l=><option key={l.id} value={l.id}>{l.description} · {l.pack_size??'pack unspecified'} · {l.qty_received===null?'not checked':`${l.qty_received}/${l.qty_ordered} received`}</option>)}</select></label>
   <label>Pack barcode<input className="input" ref={barcodeInput} required disabled={busy} value={barcode} autoComplete="off" onChange={e=>{setBarcode(e.target.value);setConfirmed(false);setSerial('');setBatch('');setExpiry('');}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();try{capture(barcode);}catch(err){setMessage(err instanceof Error?err.message:'Invalid barcode');}}}} placeholder="Scan with a handheld reader or enter GTIN" style={{display:'block',width:'100%',minHeight:44}} /></label>
   <small>Handheld scanners can type here and press Enter. Review the quantity, then select Record received packs. Each entry adds to the receipt.</small>
   <button style={{minHeight:44}} className="btn btn-secondary" disabled={busy} type="button" onClick={()=>setCamera(!camera)}>{camera?'Stop camera':'Scan with camera'}</button>
   {camera&&<video ref={video} muted playsInline style={{width:'100%',maxHeight:250}}/>}
   <label>Packs received now<input className="input" style={{minHeight:44}} disabled={busy||!!serial} type="number" min={1} max={100000} step={1} required value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label>
   {serial&&<p>Serialised pack {serial} · one pack per scan</p>}
   {barcode&&!serial&&!batch&&!expiry&&/^\d{8,14}$/.test(barcode.trim())&&<small>This is a plain (linear) barcode: it identifies the product and pack size only. Enter the batch and expiry from the pack if you need them.</small>}
   <label>Batch (optional)<input className="input" style={{minHeight:44}} disabled={busy} maxLength={100} value={batch} onChange={e=>setBatch(e.target.value)}/></label>
   <label>Expiry (optional)<input className="input" style={{minHeight:44}} disabled={busy} type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
   <label><input disabled={busy} type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I checked the exact product and pack size against the physical pack. Save this barcode mapping if it is new.</label>
   {!selected?.pack_size&&<p>A verified invoice pack size is needed before receiving by barcode.</p>}
   <button style={{minHeight:44}} className="btn btn-primary" disabled={busy||!lineId||!selected?.pack_size} type="submit">{busy?'Saving…':'Record received packs'}</button>
  </form>
  <p role="status" aria-live="polite">{message}</p>
  {/different product or pack/.test(message)&&<button style={{minHeight:44}} className="btn btn-secondary" disabled={busy} type="button" onClick={removeMapping}>Remove the old barcode mapping (owner or admin)</button>}
  <details><summary>Receipt history</summary><p>Latest 100 recorded scans for this product. Manual quantity changes are not scan events.</p>{historyLoading?<p role="status">Loading receipt history…</p>:historyError?<p role="alert">{historyError}</p>:events.length?<ul>{events.map(e=><li key={e.id}>{new Date(e.recorded_at).toLocaleString('en-GB')} · {e.quantity} pack{e.quantity===1?'':'s'} · GTIN {e.gtin}{e.batch?` · batch ${e.batch}`:''}{e.expiry?` · expiry ${e.expiry}`:''}{e.serial?` · serial ${e.serial}`:''}<small style={{display:'block'}}>Recorded by {e.recorded_by} · receipt {e.id}</small></li>)}</ul>:<p>No scan events recorded.</p>}</details>
  <CatalogImport lineId={lineId}/>
 </section>;
}
