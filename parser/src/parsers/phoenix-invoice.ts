/**
 * Phoenix Healthcare Distribution invoice parser.
 *
 * Each page has a returns stub (bin location, pick qty, pack, description, PIP) followed by the
 * invoice itself. Only the invoice section is read. An invoice line, after text extraction:
 *
 *   "A    4  ADCAL D3 CHEW TABS FRUIT       HP     56    2289-197*    0.00    5.120  1        20.48  8830"
 *    ORD QTY DESCRIPTION [flag]            PACK  PIP CODE    SRP     TRADE VAT [DT]   TOTAL  LINE REF
 *
 * followed by "** GTIN - 04032129107427". Totals come from the VAT summary:
 *   "1 20.00 142.14 28.43 Goods Total: 142.14" / "VAT Total: 28.43" / "Invoice Total: 170.57"
 * The supplier name is an image on invoices, so detection relies on the registered details.
 */
import type { ParsedInvoice, InvoiceLine } from '../types/index';

const PIP = /^\d{4}-\d{3}\*?$/;
const money = (s: string) => Number(s.replace(/,/g, ''));

/** Read one invoice-section line from its right-hand end, where the columns are fixed. */
export function parsePhoenixLine(raw: string): (InvoiceLine & { vatCode: string }) | null {
  const t = raw.trim().split(/\s+/);
  if (t.length < 9 || !/^[A-Z]{1,2}$/.test(t[0]!)) return null;
  // The order key may carry an order-type word ("A NUT") before the quantity.
  const q = /^\d+$/.test(t[1]!) ? 1 : /^[A-Z]{2,4}$/.test(t[1]!) && /^\d+$/.test(t[2]!) ? 2 : 0;
  if (!q) return null;
  let i = t.length - 1;
  // The line ref column is sometimes blank, so the last token is either the ref or the total.
  if (/^\d+$/.test(t[i]!)) i--;
  const total = t[i]!; if (!/^-?[\d,]+\.\d{2}$/.test(total)) return null;
  i--;
  // Optional DT (discount type) column between the VAT code and the total.
  if (!/^\d$/.test(t[i]!) && /^\d$/.test(t[i - 1] ?? '')) i--;
  const vatCode = t[i]!; if (!/^\d$/.test(vatCode)) return null;
  const trade = t[--i]!; if (!/^\d+\.\d{2,3}$/.test(trade)) return null;
  const srp = t[--i]!; if (!/^\d+\.\d{2}$/.test(srp)) return null;
  const pip = t[--i]!; if (!PIP.test(pip)) return null;
  const pack = t[--i]!;
  const description = t.slice(q + 1, i).join(' ');
  if (!description || !pack) return null;
  const qty = Number(t[q]);
  const net = money(total);
  return {
    supplierSku: pip.replace('*', ''),
    description: `${description} ${pack}`,
    packSize: pack,
    qty,
    unitPrice: Number(trade),
    net,
    vatRate: 0,
    vatAmount: 0,
    gross: net,
    vatCode,
  };
}

function header(text: string): { invoiceNumber: string; invoiceDate: string; account: string } {
  // Values are printed as a block before their labels: TYPE, INV NO, A/C NO, INV TYPE, DATE.
  const m = text.match(/^\s*(?:INVOICE|CREDIT)\s*\n\s*(\d{6,10})\s*\n\s*(\d{3,8})\s*\n\s*[A-Z][A-Z ]*\n\s*(\d{2})\/(\d{2})\/(\d{2,4})\s*$/m);
  if (!m) return { invoiceNumber: '', invoiceDate: '', account: '' };
  const yyyy = m[5]!.length === 2 ? `20${m[5]}` : m[5]!;
  return { invoiceNumber: m[1]!, account: m[2]!, invoiceDate: `${yyyy}-${m[4]}-${m[3]}` };
}

export function parsePhoenixInvoice(text: string): ParsedInvoice {
  const warnings: string[] = [];
  const h = header(text);
  if (!h.invoiceNumber) warnings.push('Invoice number not found');
  // VAT summary rows: "<code> <rate> <goods> <vat>"
  const rates = new Map<string, { rate: number; vat: number }>();
  for (const m of text.matchAll(/^\s*(\d)\s+(\d+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\b/gm)) {
    rates.set(m[1]!, { rate: Number(m[2]), vat: money(m[4]!) });
  }
  const goods = money(text.match(/Goods\s+Total:\s*(-?[\d,]+\.\d{2})/)?.[1] ?? '0');
  const vatTotal = money(text.match(/VAT\s+Total:\s*(-?[\d,]+\.\d{2})/)?.[1] ?? '0');
  const grossTotal = money(text.match(/Invoice\s+Total:\s*(-?[\d,]+\.\d{2})/)?.[1] ?? '0');

  const rows = text.split('\n');
  const lines: (InvoiceLine & { vatCode: string })[] = [];
  let inInvoice = false;
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k]!;
    if (/^\s*ORD\s+QTY\s+PRODUCT DESCRIPTION/.test(row)) { inInvoice = true; continue; }
    if (/^\s*BIN LOCATION\s+PICK/.test(row)) { inInvoice = false; continue; }
    if (!inInvoice) continue;
    const line = parsePhoenixLine(row);
    if (line) {
      // The GTIN follows within the next few rows (blank rows may sit in between).
      for (let j = k + 1; j <= k + 3 && j < rows.length; j++) {
        const g = rows[j]!.match(/\*\*\s*GTIN\s*-\s*(\d{8,14})/);
        if (g) { line.gtin = g[1]!.padStart(14, '0'); break; }
        if (parsePhoenixLine(rows[j]!)) break;
      }
      lines.push(line);
    } else if (/^\s*[A-Z]{1,2}\s+(?:[A-Z]{2,4}\s+)?\d+\s+\S/.test(row) && /\d{4}-\d{3}/.test(row)) {
      warnings.push(`Failed to parse line: "${row.trim()}"`);
    }
  }
  if (lines.length === 0) warnings.push('No line items extracted');

  // Line VAT from the code's rate; any rounding difference to the printed VAT for that code is put
  // on the largest line so the lines add up to the invoice.
  for (const [code, { rate, vat }] of rates) {
    const coded = lines.filter((l) => l.vatCode === code);
    for (const l of coded) { l.vatRate = rate; l.vatAmount = Math.round(l.net * rate) / 100; }
    const diff = Math.round((vat - coded.reduce((s, l) => s + l.vatAmount, 0)) * 100) / 100;
    if (diff && coded.length && Math.abs(diff) <= 0.01 * coded.length) {
      const big = coded.reduce((a, b) => (Math.abs(b.net) > Math.abs(a.net) ? b : a));
      big.vatAmount = Math.round((big.vatAmount + diff) * 100) / 100;
    }
  }
  for (const l of lines) l.gross = Math.round((l.net + l.vatAmount) * 100) / 100;

  const sumNet = Math.round(lines.reduce((s, l) => s + l.net, 0) * 100) / 100;
  const sumGross = Math.round(lines.reduce((s, l) => s + l.gross, 0) * 100) / 100;
  const totalsMatch = Math.abs(sumNet - goods) <= 0.01 && Math.abs(sumGross - grossTotal) <= 0.01;
  if (!totalsMatch) warnings.push(`Totals mismatch: lines sum net=£${sumNet.toFixed(2)}, printed goods=£${goods.toFixed(2)}; lines sum gross=£${sumGross.toFixed(2)}, printed total=£${grossTotal.toFixed(2)}`);

  const customer = text.match(/COMPANY REG No:[^\n]*\n([^\n]+)\n\s*([^\n]*\))/);
  return {
    kind: 'invoice',
    supplier: 'phoenix',
    invoiceNumber: h.invoiceNumber,
    invoiceDate: h.invoiceDate,
    poNumber: undefined,
    customerAccount: h.account || undefined,
    customerName: customer ? `${customer[1]!.trim()} ${customer[2]!.trim()}`.replace(/\s+/g, ' ') : undefined,
    lines: lines.map(({ vatCode: _code, ...l }) => l),
    netTotal: goods,
    vatTotal,
    grossTotal,
    totalsMatch,
    warnings,
  };
}

/**
 * Phoenix often emails several invoices in one PDF. Every page ends with the remittance line and
 * carries its own invoice number, so pages are grouped by invoice number and parsed separately.
 */
export function parsePhoenixInvoices(text: string): ParsedInvoice[] {
  const pages = text.split(/(?<=^Please Remit To:[^\n]*\n)/m).filter((p) => p.trim());
  const groups: { number: string; text: string }[] = [];
  for (const page of pages) {
    const number = header(page).invoiceNumber;
    const last = groups[groups.length - 1];
    if (last && (number === last.number || !number)) last.text += page;
    else groups.push({ number, text: page });
  }
  return groups.map((g) => parsePhoenixInvoice(g.text));
}
