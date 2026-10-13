import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parsePackBarcode } from '@/lib/receiving';
import { matchScan } from '@/lib/scan-match';

/** Suggest the invoice line for a scanned pack: the invoice's own GTIN, this pharmacy's mapping, then NHS dm+d. */
export async function POST(request: NextRequest) {
  const db = await createClient();
  if (!(await db.auth.getUser()).data.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const body = await request.json();
    if (typeof body?.invoiceId !== 'string') throw Error('invoiceId is required.');
    const { gtin } = parsePackBarcode(body.gtin ?? '');
    const { data: invoice, error: invoiceError } = await db.from('invoices').select('id, supplier').eq('id', body.invoiceId).is('deleted_at', null).maybeSingle();
    if (invoiceError || !invoice) throw Error('Invoice not found.');
    const [lines, mappings, dmd] = await Promise.all([
      db.from('invoice_lines').select('id, description, pack_size, supplier_sku, gtin').eq('invoice_id', invoice.id).limit(500),
      db.from('product_barcodes').select('supplier_sku').eq('supplier', invoice.supplier).eq('gtin', gtin),
      db.from('dmd_packs').select('name, generic_name, pack_qty, gtin_end').eq('gtin', gtin).limit(20),
    ]);
    if (lines.error) throw Error(lines.error.message);
    // dm+d is optional reference data; a missing table or release must not block receiving.
    const packs = dmd.error ? [] : (dmd.data ?? []);
    const current = packs.filter((p) => !p.gtin_end);
    const hints = (current.length ? current : packs).map((p) => ({ name: p.name, generic_name: p.generic_name, pack_qty: p.pack_qty === null ? null : Number(p.pack_qty) }));
    const match = matchScan(lines.data ?? [], (mappings.data ?? []).map((m) => m.supplier_sku), hints, gtin);
    return NextResponse.json({ ...match, gtin, dmdName: hints[0]?.name ?? null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Lookup failed' }, { status: 400 });
  }
}
