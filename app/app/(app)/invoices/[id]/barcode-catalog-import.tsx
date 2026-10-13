'use client';
import { useRef, useState } from 'react';
export default function CatalogImport({lineId}:{lineId:string}) {
 const fileVersion=useRef(0);
 const [csv,setCsv]=useState('');const [authorised,setAuthorised]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
 async function upload(){
  setBusy(true);setMessage('');
  try{const response=await fetch('/api/barcode-catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lineId,csv,authorised})});const data=await response.json();if(!response.ok)throw Error(data.error);setMessage(`${data.imported} new mappings saved. Existing matching mappings were kept.`);}
  catch(e){setMessage(e instanceof Error?e.message:'Import failed');}finally{setBusy(false);}
 }
 return <details style={{marginTop:'1rem'}}><summary>Import your barcode catalog</summary>
  <p>Use product and pack mappings you are authorised to use. No supplier or NHS catalog is bundled. An optional dm+d AMPP ID identifies an actual medicinal product pack; it does not replace the supplier product code or GTIN.</p>
  <p>CSV headers: supplier, supplier_sku, gtin, description, pack_size, ampp_id (optional). Match supplier names, product descriptions and pack sizes to your invoices. A supplier code may be a bin location rather than a permanent product identifier; description and pack must match too. Conflicting mappings stop the whole import.</p>
  <label>Catalog CSV<input className="input" disabled={busy} type="file" accept=".csv,text/csv" onChange={async e=>{const version=++fileVersion.current;setMessage('');setAuthorised(false);const file=e.target.files?.[0];setCsv('');if(!file)return;if(file.size>500000){setMessage('Use a CSV smaller than 500 KB.');return;}try{const text=await file.text();if(fileVersion.current===version)setCsv(text);}catch{if(fileVersion.current===version)setMessage('Could not read this file. Choose it again.');}}}/></label>
  <label style={{display:'block'}}><input type="checkbox" disabled={busy} checked={authorised} onChange={e=>setAuthorised(e.target.checked)}/> I have permission to use this catalog and have verified the product and pack mappings.</label>
  <button style={{minHeight:44}} className="btn btn-secondary" type="button" disabled={busy||!csv||!authorised||!lineId} onClick={upload}>{busy?'Importing…':'Import mappings'}</button><p role="status">{message}</p>
 </details>;
}
