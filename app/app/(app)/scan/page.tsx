/**
 * The phone tab bar's Scan: go straight to the delivery that needs checking.
 *
 * One invoice still to check: open it with the camera on. Several: the
 * deliveries list filtered to the ones still to check, newest first. None:
 * the full list. "Still to check" matches the Home overview: lines not yet
 * recorded, or an invoice with no lines read from it.
 *
 * This is a page that calls redirect(), not a route handler that answers
 * with an HTTP redirect. The tab is a <Link>, so a tap is a client-side
 * navigation: the router fetches /scan as a React Server Components payload.
 * With a route handler, the browser had to follow a 303 inside that fetch,
 * carrying the router's headers across it, and the router then fetched the
 * target a second time; on an iPhone the tap was reported to do nothing.
 * A redirect() from a page comes back inside the payload in one request and
 * the router moves to the target itself.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function ScanPage() {
  const db = await createClient();
  const { data, error } = await db
    .from('invoice_receipt_summary')
    .select('id')
    .or('pending_count.gt.0,line_count.eq.0')
    .order('invoice_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(2);
  if (error || !data?.length) redirect('/invoices');
  if (data.length === 1) redirect(`/invoices/${data[0]!.id}?scan=1`);
  redirect('/invoices?status=open');
}
