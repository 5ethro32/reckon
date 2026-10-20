import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSignedInUser } from '@/lib/supabase/user';
import { averSlipId, type SlipInvoice } from '@/lib/aver-slip';
import { averApi, saveAverInvoices } from '@/lib/aver-import';

/**
 * Scan the QR on an Aver picking slip (AVERPL:<id>) and bring in its invoices, lines and all,
 * with no PDF to upload. Aver answers only for the pharmacy's own Aver accounts (Settings).
 * An invoice already in Reckon is left as it is. Returns the invoices to check, with what each
 * holds (date, lines, packs, lines already checked) for the confirmation on the slip screen.
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

    const api = averApi();
    if (!api) return NextResponse.json({ error: 'Aver slips are not set up on this server.' }, { status: 503 });
    const res = await fetch(`${api.base}/slip?code=AVERPL:${id}&accounts=${encodeURIComponent(accounts.join(','))}`, {
      headers: { Authorization: `Bearer ${api.secret}` },
      cache: 'no-store',
    });
    if (res.status === 404) return NextResponse.json({ error: 'Aver has no invoice for this slip on your account yet. Try again shortly, or upload the invoice.' }, { status: 404 });
    if (!res.ok) return NextResponse.json({ error: 'Aver could not be reached. Try again.' }, { status: 502 });
    const { invoices } = (await res.json()) as { invoices: SlipInvoice[] };
    const { ids } = await saveAverInvoices(db, pharmacyId, invoices);
    // What was opened, as Reckon holds it (an invoice already here keeps its own lines and progress),
    // so the slip screen can confirm it before checking starts.
    const [heads, lines] = await Promise.all([
      db.from('invoices').select('id,supplier,invoice_number,invoice_date,gross_total').in('id', ids),
      db.from('invoice_lines').select('invoice_id,qty_ordered,qty_received,flags').in('invoice_id', ids).limit(5000),
    ]);
    // If either read fails the screen opens the invoices without the summary.
    const deliveries = heads.error || lines.error ? [] : ids.flatMap((id) => {
      const head = heads.data?.find((h) => h.id === id);
      if (!head) return [];
      const own = (lines.data ?? []).filter((l) => l.invoice_id === id);
      return [{
        id, supplier: head.supplier, invoiceNumber: head.invoice_number, invoiceDate: head.invoice_date, gross: Number(head.gross_total),
        lines: own.length,
        packs: own.reduce((s, l) => s + Number(l.qty_ordered), 0),
        checked: own.filter((l) => l.qty_received !== null || (Array.isArray(l.flags) && l.flags.length > 0)).length,
      }];
    });
    return NextResponse.json({ ok: true, invoiceIds: ids, invoices: invoices.map((i) => i.invoiceNo), deliveries });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read the slip' }, { status: 500 });
  }
}
