import type { SupabaseClient } from '@supabase/supabase-js';
import { slipInvoiceRows, type SlipInvoice } from './aver-slip';

/**
 * Saves Aver invoices (from the slip lookup or the invoices feed) for one pharmacy. An invoice
 * already in Reckon is left exactly as it is, so lines already checked are never touched.
 * Returns each invoice's Reckon id, in the order given, and how many were new.
 */
export async function saveAverInvoices(db: SupabaseClient, pharmacyId: string, invoices: SlipInvoice[]): Promise<{ ids: string[]; added: number }> {
  const ids: string[] = [];
  let added = 0;
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
    added++;
  }
  return { ids, added };
}

/** Where Aver answers from (the REVA portal's partner API) and its shared secret. */
export function averApi(): { base: string; secret: string } | null {
  const secret = process.env.AVER_SLIP_SECRET;
  if (!secret) return null;
  return { base: (process.env.AVER_API_URL ?? 'https://revabyaver.co.uk/api/partner').replace(/\/$/, ''), secret };
}
