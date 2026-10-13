import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseCatalogCsv } from '@/lib/barcode-catalog';
export async function POST(request: NextRequest) {
 const db=await createClient();
 if(!(await db.auth.getUser()).data.user)return NextResponse.json({error:'Not signed in'},{status:401});
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
