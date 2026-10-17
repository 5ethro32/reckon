import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSignedInUser } from '@/lib/supabase/user';
import { parsePackBarcode } from '@/lib/receiving';

export async function POST(request: NextRequest) {
  const db = await createClient();
  if (!(await getSignedInUser(db))) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const body = await request.json();
    const pack = parsePackBarcode(body.gtin ?? '');
    const gtin = pack.gtin;
    // The raw scan is the evidence. Batch, expiry and serial read from it cannot be replaced by
    // typed values; typed values only fill fields the barcode does not carry (linear barcodes).
    const scan = typeof body.scan === 'string' && body.scan ? parsePackBarcode(body.scan) : null;
    if (scan && scan.gtin !== gtin) throw Error('The scanned barcode does not match this pack. Rescan the pack.');
    for (const field of ['batch', 'expiry', 'serial'] as const) {
      if (scan?.[field] && body[field] && body[field] !== scan[field]) throw Error(`The ${field} was read from the barcode and cannot be changed. Rescan the pack.`);
    }
    const from = (field: 'batch' | 'expiry' | 'serial') => scan?.[field] || pack[field] || body[field] || null;
    if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 100000) throw Error('Enter a whole number of packs between 1 and 100,000.');
    const { data, error } = await db.rpc('record_pack_receipt', {
      p_line_id: body.lineId, p_gtin: gtin, p_quantity: body.quantity,
      p_event_id: body.eventId, p_confirm_mapping: body.confirmMapping === true,
      p_batch: from('batch'), p_expiry: from('expiry'), p_serial: from('serial'),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, receipt: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid receipt' }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const db=await createClient();
  if(!(await getSignedInUser(db)))return NextResponse.json({error:'Not signed in'},{status:401});
  const lineId=request.nextUrl.searchParams.get('lineId');
  if(!lineId)return NextResponse.json({error:'Choose an invoice product'},{status:400});
  const {data,error}=await db.from('receipt_events').select('id,gtin,quantity,batch,expiry,serial,recorded_at,recorded_by').eq('invoice_line_id',lineId).order('recorded_at',{ascending:false}).limit(100);
  if(error)return NextResponse.json({error:'Could not load receipt history'},{status:400});
  return NextResponse.json({events:data});
}
