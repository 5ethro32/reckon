/**
 * Aver Generics invoice parser.
 *
 * Two layouts are supported: the current one (see parseCurrentLine) and the earlier
 *   Bin | Qty | Description | Unit Price | Net | Tax
 *
 * Sample line after PDF text extraction:
 *   "C-0816 2 Azathioprine Tabs 50mg / 56 £0.58 £1.16 £0.23"
 *
 * Layout: BIN QTY DESCRIPTION £UNIT_PRICE £NET £TAX
 *
 * The first token is the bin code (e.g. "C-0816", "L29-02", "X01-06").
 * The second token is qty (integer). Description follows up to the £ prices.
 * No VAT% column — VAT is always 20% on Aver (reflected in the totals block).
 */

import type { ParsedInvoice, InvoiceLine } from '../types/index';

function toIsoDate(input: string): string {
  // Aver uses YYYY-MM-DD already.
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  // Defensive: handle DD/MM/YYYY just in case.
  const ddmmyyyy = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  return input;
}

function toNum(s: string): number {
  const cleaned = s.replace(/[£,\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Parse a single Aver line.
 *
 * Aver bin codes follow these formats:
 *   C-0816, B-0311, D-0708       (Letter-Digits)
 *   L29-02, X01-06, A06-01       (Letter+2digits-2digits)
 *   H-0811                       (Letter-Digits)
 *
 * The pdf-parse output joins columns without spaces, so a line looks like:
 *   "C-311640Citalopram Tabs 10mg / 28£0.29£11.60£2.32"
 *
 * Layout (joined): <BIN><QTY><DESCRIPTION>£<UNIT>£<NET>£<TAX>
 *
 * Strategy:
 *   1. Anchor on the trailing three £-prefixed amounts.
 *   2. Match the leading bin code with a strict regex that captures the
 *      qty as the first contiguous run of digits AFTER the bin.
 *   3. Description = everything between qty and the first £.
 */
function parseLine(line: string): InvoiceLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Bin code variants:
  //   Letter-DDDD     e.g. C-0816, B-0311, G-0103
  //   LetterDD-DD     e.g. L29-02, X01-06, A06-01
  // The two patterns are non-overlapping in length, so we match either explicitly.
  const m = trimmed.match(
    /^([A-Z]-\d{4}|[A-Z]\d{2}-\d{2})\s*(\d+)([A-Za-z].+?)£(\d+(?:\.\d+)?)£(\d+(?:\.\d+)?)£(\d+(?:\.\d+)?)$/
  );
  if (!m) return null;

  const [, bin, qtyStr, description, unitStr, netStr, taxStr] = m;
  if (!bin || !qtyStr || !description || !unitStr || !netStr || !taxStr) return null;

  const qty = parseInt(qtyStr, 10);
  if (isNaN(qty)) return null;

  const desc = description.trim();
  if (!desc) return null;

  // Pack size lives after the last "/" in the description.
  const packMatch = desc.match(/\/\s*(\S+)\s*$/);
  const packSize = packMatch?.[1] ?? '';

  const unitPrice = toNum(unitStr);
  const net = toNum(netStr);
  const vatAmount = toNum(taxStr);
  const gross = +(net + vatAmount).toFixed(2);
  const vatRate = net > 0 ? Math.round((vatAmount / net) * 100) : 0;

  return {
    supplierSku: bin,
    description: desc,
    packSize,
    qty,
    unitPrice,
    net,
    vatRate,
    vatAmount,
    gross,
  };
}

/**
 * Current Aver invoice line (2026 layout, from Carlos):
 *   Bin | Description / Pack | Qty | Unit Price | Net | VAT Rate | Tax
 * After text extraction the pack size and quantity are glued together, and a controlled drug
 * schedule marker may sit between them:
 *   "C-1409Alfacalcidol Caps 0.5mcg / 306£1.52£9.1220.0%£1.82"     pack 30, qty 6
 *   "X06-01Co-Codamol Tabs 8/500mg / 100   CD51£2.32£2.3220.0%£0.46" pack 100, CD5, qty 1
 *   "C-1419Methocarbamol Tabs 750mg 100s1£2.70£2.7020.0%£0.54"      pack 100s, qty 1 (no slash)
 *   "X04-05Pregabalin Caps 25mg 56s ( CD3 )1£0.66£0.6620.0%£0.13"   pack 56s, CD3, qty 1
 * Quantity is recovered from net / unit price and must be a suffix of the glued digits.
 */
function parseCurrentLine(line: string): InvoiceLine | null {
  const m = line.trim().match(
    /^([A-Z]-\d{4}|[A-Z]\d{2}-\d{2})([A-Za-z].*?)£(\d+\.\d{2})£(\d+\.\d{2})(\d+(?:\.\d+)?)%£(\d+\.\d{2})$/
  );
  if (!m) return null;
  const [, bin, body, unitStr, netStr, rateStr, taxStr] = m;
  const unitPrice = toNum(unitStr!), net = toNum(netStr!), vatAmount = toNum(taxStr!);
  // The quantity is glued to the end of the description; net / unit price says how many digits.
  if (unitPrice <= 0) return null;
  const qty = Math.round(net / unitPrice);
  if (qty < 1 || Math.abs(qty * unitPrice - net) > 0.011) return null;
  let rest = body!.replace(/\s+$/, '');
  if (!rest.endsWith(String(qty))) return null;
  rest = rest.slice(0, -String(qty).length).replace(/\s+$/, '');
  // Controlled drug schedule marker: "CD5" or "( CD3 )" just before the quantity.
  let cd: string | undefined;
  const cdMatch = rest.match(/\s*\(?\s*CD([1-5])\s*\)?$/);
  if (cdMatch) { cd = `CD${cdMatch[1]}`; rest = rest.slice(0, cdMatch.index).replace(/\s+$/, ''); }
  // Pack size: after the last " / " when present ("Tabs 5mg / 28"), else the last word ("28s", "140dse").
  let name: string, pack: string;
  const slash = rest.lastIndexOf(' / ');
  if (slash >= 0) { name = rest.slice(0, slash).trim(); pack = rest.slice(slash + 3).trim(); }
  else { const w = rest.match(/^(.*\S)\s+(\S+)$/); if (!w) return null; name = w[1]!.trim(); pack = w[2]!; }
  if (!name || !pack) return null;
  return {
    supplierSku: bin!,
    description: `${name} / ${pack}${cd ? ` ${cd}` : ''}`,
    packSize: pack,
    qty,
    unitPrice,
    net,
    vatRate: Number(rateStr),
    vatAmount,
    gross: +(net + vatAmount).toFixed(2),
  };
}

/**
 * Aver headers are rendered as side-by-side columns but pdf-parse reads them
 * top-to-bottom, producing all labels first then all values. We match a known
 * label sequence and then collect the next N non-blank lines as values.
 */
function extractAverHeaderBlock(text: string): {
  invoiceNumber: string;
  invoiceDate: string;
  accountNumber: string;
} {
  // The label trio always appears in this exact order on Aver invoices.
  // The 2026 layout adds a "Payment Due" label (and value) after Account No.
  const labelBlock = text.match(/Invoice No\.\s*\n\s*Invoice\/Tax Date\s*\n\s*Account No\.\s*\n(?:\s*Payment Due\s*\n)?([\s\S]+?)(?=\n[A-Z][a-z]|\nBin)/);
  const empty = { invoiceNumber: '', invoiceDate: '', accountNumber: '' };
  if (!labelBlock?.[1]) return empty;

  const valueLines = labelBlock[1].split(/\n/).map(l => l.trim()).filter(Boolean);
  return {
    invoiceNumber: valueLines[0] ?? '',
    invoiceDate: valueLines[1] ?? '',
    accountNumber: valueLines[2] ?? '',
  };
}

/**
 * Aver totals block: labels stack, then values stack (Carriage Net is blank
 * so only 3 values for 4 labels — total is always last value).
 */
function extractAverTotals(text: string): {
  netTotal: number;
  vatTotal: number;
  grossTotal: number;
} {
  const block = text.match(
    /Total Items Net\s*\n\s*Carriage Net\s*\n\s*Total VAT Amount\s*\n\s*Total Amount\s*\n([\s\S]+?)(?=Picked by|UNTIL THE GOODS|$)/i
  );
  const empty = { netTotal: 0, vatTotal: 0, grossTotal: 0 };
  if (!block?.[1]) return empty;

  // Pull all £-prefixed amounts in order. Order is: net, [carriage], vat, gross.
  const nums = (block[1].match(/£([\d.,]+)/g) ?? []).map(s => parseFloat(s.replace(/[£,]/g, '')));
  if (nums.length === 3) {
    return { netTotal: nums[0]!, vatTotal: nums[1]!, grossTotal: nums[2]! };
  }
  if (nums.length === 4) {
    // Net, carriage, vat, gross
    return { netTotal: nums[0]!, vatTotal: nums[2]!, grossTotal: nums[3]! };
  }
  return empty;
}

export function parseAverInvoice(text: string): ParsedInvoice {
  const warnings: string[] = [];

  const header = extractAverHeaderBlock(text);
  // Customer name is the line right under the address block heading
  const customerNameMatch = text.match(/Email:\s*info@avergenerics\.co\.uk\s*\n+([^\n]+)/i);

  if (!header.invoiceNumber) warnings.push('Invoice No not found');
  if (!header.invoiceDate) warnings.push('Invoice/Tax Date not found');

  const { netTotal, vatTotal, grossTotal } = extractAverTotals(text);

  // Extract line items. Aver lines start with a bin code and contain £ amounts.
  const allLines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const lines: InvoiceLine[] = [];

  const BIN = /^([A-Z]-\d{4}|[A-Z]\d{2}-\d{2})/;
  const AMOUNTS = /£\d+(?:\.\d+)?£\d+(?:\.\d+)?(?:\d+(?:\.\d+)?%)?£\d+(?:\.\d+)?$/;
  for (let i = 0; i < allLines.length; i++) {
    let raw = allLines[i]!;
    // Filter: starts with an Aver-style bin code AND contains the trio of £ amounts.
    if (!BIN.test(raw)) continue;
    // A long description can wrap: "…/ 100", "CD5", "4£4.29£17.16…". Join up to three continuation lines.
    if (!AMOUNTS.test(raw)) {
      let joined = raw;
      for (let j = 1; j <= 3 && i + j < allLines.length && !BIN.test(allLines[i + j]!); j++) {
        joined = `${joined} ${allLines[i + j]}`;
        if (AMOUNTS.test(joined)) { raw = joined; i += j; break; }
      }
    }
    const current = /£\d+\.\d{2}£\d+\.\d{2}\d+(?:\.\d+)?%£\d+\.\d{2}$/.test(raw);
    if (!current && !/£\d+(?:\.\d+)?£\d+(?:\.\d+)?£\d+(?:\.\d+)?$/.test(raw)) continue;
    const parsed = current ? parseCurrentLine(raw) : parseLine(raw);
    if (parsed) {
      lines.push(parsed);
    } else {
      warnings.push(`Failed to parse line: "${raw}"`);
    }
  }

  if (lines.length === 0) warnings.push('No line items extracted');

  const sumNet = +lines.reduce((s, l) => s + l.net, 0).toFixed(2);
  const sumGross = +lines.reduce((s, l) => s + l.gross, 0).toFixed(2);
  const tolerance = 0.02;
  const totalsMatch =
    Math.abs(sumNet - netTotal) <= tolerance &&
    Math.abs(sumGross - grossTotal) <= tolerance;

  if (!totalsMatch) {
    warnings.push(
      `Totals mismatch: lines sum net=£${sumNet.toFixed(2)}, printed net=£${netTotal.toFixed(2)}; ` +
      `lines sum gross=£${sumGross.toFixed(2)}, printed gross=£${grossTotal.toFixed(2)}`
    );
  }

  return {
    kind: 'invoice',
    supplier: 'aver',
    invoiceNumber: header.invoiceNumber,
    invoiceDate: header.invoiceDate ? toIsoDate(header.invoiceDate) : '',
    poNumber: undefined, // Aver doesn't include PO on invoice
    customerAccount: header.accountNumber || undefined,
    customerName: customerNameMatch?.[1]?.trim(),
    lines,
    netTotal,
    vatTotal,
    grossTotal,
    totalsMatch,
    warnings,
  };
}
