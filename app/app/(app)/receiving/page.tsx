import { createClient } from '@/lib/supabase/server';
import { readAll } from '@/lib/paginated-read';
import Receiving from './receiving';
export default async function Page(){
 const db=await createClient();
 let content;
 try {
  const [receipts,pharmacies,invoices]=await Promise.all([
   readAll(after=>{let q=db.from('uninvoiced_receipts').select('*').order('id').limit(500);if(after)q=q.gt('id',after);return q;}),
   readAll(after=>{let q=db.from('pharmacies').select('id,name').order('id').limit(500);if(after)q=q.gt('id',after);return q;}),
   readAll(after=>{let q=db.from('invoices').select('id,pharmacy_id,supplier,invoice_number').is('deleted_at',null).order('id').limit(500);if(after)q=q.gt('id',after);return q;})
  ]);
  receipts.sort((a,b)=>new Date(b.received_at).getTime()-new Date(a.received_at).getTime());
  content=<Receiving receipts={receipts} pharmacies={pharmacies} invoices={invoices}/>;
 }catch{
  content=<p role="alert">Receiving is unavailable. Check the database migrations and your access.</p>;
 }
 return <div><div className="page-header"><div><h1 className="page-header-title">Receive before the invoice</h1><p className="page-header-subtitle">Keep a record of goods on site while the paperwork catches up.</p></div></div>{content}</div>;
}
