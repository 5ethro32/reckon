/**
 * Aver Generics invoice parser.
 *
 * Aver invoices use this column layout:
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

import type { ParsedInvoice, InvoiceLine } from '../types/index.js';

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
  const labelBlock = text.match(/Invoice No\.\s*\n\s*Invoice\/Tax Date\s*\n\s*Account No\.\s*\n([\s\S]+?)(?=\n[A-Z][a-z]|\nBin\b)/);
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

  for (const raw of allLines) {
    // Filter: starts with an Aver-style bin code AND contains the trio of £ amounts.
    if (!/^([A-Z]-\d{4}|[A-Z]\d{2}-\d{2})/.test(raw)) continue;
    if (!/£\d+(?:\.\d+)?£\d+(?:\.\d+)?£\d+(?:\.\d+)?$/.test(raw)) continue;
    const parsed = parseLine(raw);
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
