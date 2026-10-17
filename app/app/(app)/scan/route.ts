/**
 * The phone tab bar's Scan: go straight to the delivery that needs checking.
 *
 * One invoice still to check: open it. Several: the deliveries list filtered
 * to the ones still to check, newest first. None: the full list.
 * "Still to check" matches the Home overview: lines not yet recorded, or an
 * invoice with no lines read from it.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  const db = await createClient();
  const { data, error } = await db
    .from('invoice_receipt_summary')
    .select('id')
    .or('pending_count.gt.0,line_count.eq.0')
    .order('invoice_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(2);
  if (error || !data?.length) return to('/invoices');
  if (data.length === 1) return to(`/invoices/${data[0]!.id}`);
  return to('/invoices?status=open');
}
