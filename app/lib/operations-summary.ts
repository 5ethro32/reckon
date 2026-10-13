export type Invoice = { id: string; pharmacy_id: string; supplier: string; invoice_number: string; invoice_date: string; gross_total: number | string; created_at: string };
export type Line = { id: string; invoice_id: string; qty_ordered: number | string; qty_received: number | string | null; flags: string[] | null; credit_request_id: string | null };
export type Claim = { id: string; pharmacy_id: string; supplier: string; status: string; total_amount: number | string; sent_at: string | null };
export function lineState(line: Line): 'pending' | 'exception' | 'complete' {
  if (line.qty_received === null) return 'pending';
  return Number(line.qty_received) === Number(line.qty_ordered) && !line.flags?.length ? 'complete' : 'exception';
}
export function summarise(invoices: Invoice[], lines: Line[], claims: Claim[], now = Date.now()) {
  const byInvoice = new Map<string, Line[]>();
  for (const line of lines) {
    const group = byInvoice.get(line.invoice_id);
    if (group) group.push(line); else byInvoice.set(line.invoice_id, [line]);
  }
  const receipts = invoices.map(invoice => {
    const rows = byInvoice.get(invoice.id) ?? [];
    const pending = rows.filter(l => lineState(l) === 'pending').length;
    const exceptions = rows.filter(l => lineState(l) === 'exception' || !!l.flags?.length).length;
    return { ...invoice, lines: rows.length, fullCount: rows.filter(l => lineState(l) === 'complete').length, pending, exceptions, complete: rows.length > 0 && pending === 0 && exceptions === 0 };
  });
  const openClaims = claims.filter(c => ['draft', 'sent', 'overdue'].includes(c.status));
  const agedClaims = openClaims.filter(c => c.status === 'overdue' || (c.status === 'sent' && c.sent_at && now - Date.parse(c.sent_at) >= 14 * 86400000));
  const supplierMap = new Map<string, { pharmacy: string; supplier: string; invoices: number; invoiceGross: number; pending: number; exceptions: number; openClaims: number; claimTotal: number }>();
  function row(pharmacy: string, supplier: string) {
    const key = pharmacy + ':' + supplier;
    if (!supplierMap.has(key)) supplierMap.set(key, { pharmacy, supplier, invoices: 0, invoiceGross: 0, pending: 0, exceptions: 0, openClaims: 0, claimTotal: 0 });
    return supplierMap.get(key)!;
  }
  for (const receipt of receipts) {
    const r = row(receipt.pharmacy_id, receipt.supplier);
    r.invoices++; r.invoiceGross += Number(receipt.gross_total); r.pending += receipt.pending; r.exceptions += receipt.exceptions;
  }
  for (const claim of openClaims) {
    const r = row(claim.pharmacy_id, claim.supplier); r.openClaims++; r.claimTotal += Number(claim.total_amount);
  }
  return { receipts, openClaims, agedClaims, suppliers: [...supplierMap.values()].sort((a,b) => (b.pending+b.exceptions) - (a.pending+a.exceptions) || a.supplier.localeCompare(b.supplier)) };
}
export function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^(?:\s*[=+@\-]|[\t\r\n])/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function supplierCsv(rows: ReturnType<typeof summarise>['suppliers']): string {
  return [['Pharmacy ID','Supplier','Uploaded invoices','Invoice gross GBP','Unchecked lines','Exception lines','Open claims','Requested credits GBP'], ...rows.map(r => [r.pharmacy,r.supplier,r.invoices,r.invoiceGross.toFixed(2),r.pending,r.exceptions,r.openClaims,r.claimTotal.toFixed(2)])].map(r => r.map(csvCell).join(',')).join('\r\n');
}
