import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSignedInUser } from '@/lib/supabase/user';
import { averSlipId, slipInvoiceRows, type SlipInvoice } from '@/lib/aver-slip';

/**
 * Scan the QR on an Aver picking slip (AVERPL:<id>) and bring in its invoices, lines and all,
 * with no PDF to upload. Aver answers only for the pharmacy's own Aver accounts (Settings).
 * An invoice already in Reckon is left as it is. Returns the invoices to check.
 */
export async function POST(request: NextRequest) {
  const db = await createClient();
  const user = await getSignedInUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const id = averSlipId(String(body?.code ?? ''));
    if (!id) return NextResponse.json({ error: 'That is not an Aver delivery slip. Scan the square code on the Aver slip.' }, { status: 400 });

    const { data: memberships } = await db.from('pharmacy_memberships').select('pharmacy_id').eq('user_id', user.id).limit(1);
    const pharmacyId = memberships?.[0]?.pharmacy_id;
    if (!pharmacyId) return NextResponse.json({ error: 'No pharmacy on this login.' }, { status: 403 });
    const { data: pharmacy } = await db.from('pharmacies').select('aver_accounts').eq('id', pharmacyId).maybeSingle();
    const accounts: string[] = pharmacy?.aver_accounts ?? [];
    if (!accounts.length) return NextResponse.json({ error: 'Add your Aver account number in Settings to scan Aver slips.' }, { status: 409 });

    const base = process.env.AVER_SLIP_URL ?? 'https://revabyaver.co.uk/api/partner/slip';
    const secret = process.env.AVER_SLIP_SECRET;
    if (!secret) return NextResponse.json({ error: 'Aver slips are not set up on this server.' }, { status: 503 });
    const res = await fetch(`${base}?code=AVERPL:${id}&accounts=${encodeURIComponent(accounts.join(','))}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    });
    if (res.status === 404) return NextResponse.json({ error: 'Aver has no invoice for this slip on your account yet. Try again shortly, or upload the invoice.' }, { status: 404 });
    if (!res.ok) return NextResponse.json({ error: 'Aver could not be reached. Try again.' }, { status: 502 });
    const { invoices } = (await res.json()) as { invoices: SlipInvoice[] };

    const ids: string[] = [];
    for (const inv of invoices) {
      const { data: existing } = await db.from('invoices').select('id').eq('pharmacy_id', pharmacyId).eq('supplier', 'aver').eq('invoice_number', inv.invoiceNo).is('deleted_at', null).maybeSingle();
      if (existing) { ids.push(existing.id); continue; }
      const { header, lines } = slipInvoiceRows(inv);
      const { data: row, error } = await db.from('invoices').insert({ pharmacy_id: pharmacyId, supplier: 'aver', ...header }).select('id').single();
      if (error || !row) throw Error(`Could not save invoice ${inv.invoiceNo}: ${error?.message ?? 'unknown'}`);
      const { error: linesError } = await db.from('invoice_lines').insert(lines.map((l) => ({ ...l, invoice_id: row.id, pharmacy_id: pharmacyId })));
      if (linesError) {
        await db.from('invoices').delete().eq('id', row.id);
        throw Error(`Could not save the lines of invoice ${inv.invoiceNo}: ${linesError.message}`);
      }
      ids.push(row.id);
    }
    return NextResponse.json({ ok: true, invoiceIds: ids, invoices: invoices.map((i) => i.invoiceNo) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read the slip' }, { status: 500 });
  }
}
