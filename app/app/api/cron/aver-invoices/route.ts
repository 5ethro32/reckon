import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { averApi, saveAverInvoices } from '@/lib/aver-import';
import type { SlipInvoice } from '@/lib/aver-slip';

/**
 * Every 15 minutes (vercel.json): each pharmacy with Aver account numbers gets its new Aver
 * invoices, lines and all, as soon as Aver invoices them, so the delivery is waiting in Reckon
 * before the van arrives (Jethro, 19 Oct 2026). Reads the last two days each time; invoices
 * already in Reckon are skipped. ?days=N reads further back once.
 */
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const api = averApi();
  if (!api) return NextResponse.json({ skipped: 'AVER_SLIP_SECRET not set' });
  const days = Math.min(31, Math.max(1, Number(request.nextUrl.searchParams.get('days') ?? 2) || 2));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const db = createAdminClient();
  const { data: pharmacies, error } = await db.from('pharmacies').select('id, aver_accounts').neq('aver_accounts', '{}');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const out: { pharmacy: string; read?: number; added?: number; error?: string }[] = [];
  for (const p of pharmacies ?? []) {
    try {
      const res = await fetch(`${api.base}/invoices?accounts=${encodeURIComponent((p.aver_accounts as string[]).join(','))}&since=${encodeURIComponent(since)}`, {
        headers: { Authorization: `Bearer ${api.secret}` },
        cache: 'no-store',
      });
      if (!res.ok) throw Error(`Aver answered ${res.status}`);
      const { invoices } = (await res.json()) as { invoices: SlipInvoice[] };
      const { added } = await saveAverInvoices(db, p.id, invoices);
      out.push({ pharmacy: p.id, read: invoices.length, added });
    } catch (e) {
      out.push({ pharmacy: p.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  console.log('[aver-invoices]', JSON.stringify(out));
  return NextResponse.json({ since, pharmacies: out }, { status: out.some((o) => o.error) ? 500 : 200 });
}
