import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSignedInUser } from '@/lib/supabase/user';
import { parseCatalogCsv } from '@/lib/barcode-catalog';
import { normalizeGtin } from '@/lib/receiving';
export async function POST(request: NextRequest) {
 const db=await createClient();
 if(!(await getSignedInUser(db)))return NextResponse.json({error:'Not signed in'},{status:401});
 try {
  const text=await request.text();if(text.length>600000)throw Error('Catalog is too large.');
  const body=JSON.parse(text);
  if(body.authorised!==true)throw Error('Confirm permission to use this catalog and verify its product and pack mappings.');
  if(typeof body.csv!=='string')throw Error('CSV is required.');
  const rows=parseCatalogCsv(body.csv);
  const {data,error}=await db.rpc('import_barcode_catalog',{p_line_id:body.lineId,p_rows:rows});
  if(error)throw Error(error.message);
  return NextResponse.json({imported:data,reviewed:rows.length});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid catalog'},{status:400});}
}
/** Owners and admins remove a wrong verified mapping; the next scan must be confirmed again. */
export async function DELETE(request: NextRequest) {
 const db=await createClient();
 if(!(await getSignedInUser(db)))return NextResponse.json({error:'Not signed in'},{status:401});
 try {
  const body=await request.json();
  if(typeof body?.lineId!=='string'||typeof body?.gtin!=='string')throw Error('lineId and gtin are required.');
  const {data,error}=await db.rpc('remove_barcode_mapping',{p_line_id:body.lineId,p_gtin:normalizeGtin(body.gtin)});
  if(error)throw Error(error.message);
  return NextResponse.json({removed:data===true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Could not remove mapping'},{status:400});}
}
