import { createClient } from '@/lib/supabase/server';
import { summarise, type Invoice, type Line, type Claim } from './operations-summary';
import { readAll } from './paginated-read';
export async function loadOperations() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error('Sign in to view your pharmacy records.');
  const [invoices, lines, claims] = await Promise.all([
    readAll<Invoice>(after => { let q = db.from('invoices').select('id,pharmacy_id,supplier,invoice_number,invoice_date,gross_total,created_at').is('deleted_at',null).order('id').limit(500); if(after) q=q.gt('id',after); return q; }),
    readAll<Line>(after => { let q = db.from('invoice_lines').select('id,invoice_id,qty_ordered,qty_received,flags,credit_request_id').order('id').limit(500); if(after) q=q.gt('id',after); return q; }),
    readAll<Claim>(after => { let q = db.from('credit_requests').select('id,pharmacy_id,supplier,status,total_amount,sent_at').in('status',['draft','sent','overdue']).order('id').limit(500); if(after) q=q.gt('id',after); return q; }),
  ]);
  return summarise(invoices,lines,claims);
}
