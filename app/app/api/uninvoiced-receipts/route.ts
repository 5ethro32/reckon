import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: Request) {
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user) return NextResponse.json({error:'Sign in first'},{status:401});
 let body;
 try {body=await request.json();} catch {return NextResponse.json({error:'Invalid request'},{status:400});}
 if(!body || typeof body!=='object' || typeof body.id!=='string' || !uuid.test(body.id)) return NextResponse.json({error:'Valid receipt reference required'},{status:400});
 if(body.action==='link') {
  if(typeof body.invoice_id!=='string'||!uuid.test(body.invoice_id)||body.confirm!==true) return NextResponse.json({error:'Confirm the invoice and physical receipt before linking'},{status:400});
  const {error}=await db.rpc('link_uninvoiced_receipt',{p_receipt_id:body.id,p_invoice_id:body.invoice_id});
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({ok:true});
 }
 const limits: Record<string,number>={supplier:150,delivery_reference:150,description:500,pack_size:100};
 for(const [key,max]of Object.entries(limits))if(typeof body[key]!=='string'||!body[key].trim()||body[key].length>max)return NextResponse.json({error:`Check ${key.replaceAll('_',' ')}`},{status:400});
 if(typeof body.pharmacy_id!=='string'||!uuid.test(body.pharmacy_id)||!Number.isInteger(body.quantity)||body.quantity<1||body.quantity>100000||typeof body.notes!=='string'||body.notes.length>2000)return NextResponse.json({error:'Check pharmacy, quantity and notes'},{status:400});
 const row={id:body.id,pharmacy_id:body.pharmacy_id,supplier:body.supplier.trim(),delivery_reference:body.delivery_reference.trim(),description:body.description.trim(),pack_size:body.pack_size.trim(),quantity:body.quantity,notes:body.notes,recorded_by:user.id};
 const {error}=await db.from('uninvoiced_receipts').insert(row);
 if(error){
  if(error.code==='23505'){
   const {data:existing}=await db.from('uninvoiced_receipts').select('*').eq('id',body.id).single();
   if(existing&&Object.entries(row).every(([key,value])=>existing[key]===value))return NextResponse.json({ok:true,replayed:true});
  }
  return NextResponse.json({error:'Could not save the receipt. Check access and try again.'},{status:400});
 }
 return NextResponse.json({ok:true});
}
