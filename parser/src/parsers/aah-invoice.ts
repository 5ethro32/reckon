/**
 * AAH invoice parser.
 *
 * AAH invoices are clean digital PDFs with a stable column layout:
 *   Product | Pack Size | Description | Unit QTY | Price | Net Price | VAT% | Total | LGD
 *
 * The PDF text extraction collapses these into one line per row but with
 * inconsistent whitespace, so we anchor on the numeric columns at the end
 * (price/net/vat%/total) which always appear in the same relative order.
 *
 * Header fields (Invoice Ref, Date, PO etc.) live above the table and
 * are extracted with field-anchored regexes.
 */

import type { ParsedInvoice, InvoiceLine } from '../types/index';

/** Convert various date formats to ISO YYYY-MM-DD. */
function toIsoDate(input: string): string {
  // AAH uses DD/MM/YYYY
  const ddmmyyyy = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  return input;
}

/** Strip currency symbols, commas, and whitespace; parse as float. */
function toNum(s: string): number {
  const cleaned = s.replace(/[£,\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Parse a single AAH invoice line.
 *
 * pdf-parse output joins columns without spaces, so a line looks like:
 *   "RIB0172C30E-B2 RIBOFLAVIN 100MG CAPS189.2089.2020%107.04SCM"
 *
 * Layout (joined): <SKU><PACK><DESC><QTY><UNIT><NET><VAT%>%<TOTAL>[<FLAGS>]
 *
 * AAH SKU format: 3 uppercase letters + 4 digits + 1 letter. E.g. AER0081X, RIB0172C.
 * Pack size: digits, optionally followed by units like ML/G/DOSE.
 * VAT rate is always followed by literal "%" — the unique anchor on the line.
 *
 * Strategy:
 *   1. Match SKU (fixed 8-char prefix structure).
 *   2. Anchor on "<vat>%" — split into head + tail at that point.
 *   3. Tail = total + optional flags.
 *   4. Head = pack-size + description + qty + unit + net (all glued together).
 *      Walk backwards from the end of head: net is decimal-pointed, then unit
 *      (decimal-pointed), then qty (integer with no decimal point).
 */
function parseLine(line: string): InvoiceLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // SKU: AAH SKUs are typically 3 letters + 4 digits + 1 letter. Match strictly.
  const skuMatch = trimmed.match(/^([A-Z]{3}\d{4}[A-Z])(.*)$/);
  if (!skuMatch) return null;
  const sku = skuMatch[1]!;
  const rest = skuMatch[2] ?? '';

  // Anchor on the VAT rate. AAH rates are 0, 5, or 20 — match literally so
  // we don't accidentally swallow the trailing digits of a glued-on price.
  const vatAnchor = rest.match(/^(.+?)(0|5|20)%([\d.,]+)([A-Z*]*)$/);
  if (!vatAnchor) return null;

  const [, beforeVat, vatRateStr, grossStr, flagsRaw] = vatAnchor;
  if (!beforeVat || !vatRateStr || !grossStr) return null;

  // beforeVat is "<PACK><DESC><QTY><UNIT><NET>" with no separators.
  // We extract every "<digits>.<2-digits>" termination and walk through valid
  // (unit, net) candidates, validating against qty × unit ≈ net.
  //
  // Strategy:
  //   1. Find all positions where "<digits>.<2-digits>" matches with its
  //      number-of-leading-digits = 1, 2, 3, 4, or 5.
  //   2. The rightmost match is "net". Try each prefix-extension as a candidate.
  //   3. Just before net is "unit", another decimal. Try each candidate.
  //   4. The digits immediately before unit are qty (right-truncated until
  //      qty × unit ≈ net).
  let qty = 0;
  let unitPrice = 0;
  let net = 0;
  let head = '';
  let foundValid = false;

  const lastTwo = beforeVat.slice(-2);
  if (!/^\d{2}$/.test(lastTwo)) return null;
  const beforeDot = beforeVat.slice(0, -3); // strip ".XX"

  // Find the dot position by walking back to it.
  if (beforeVat.charAt(beforeVat.length - 3) !== '.') return null;

  // Extract ALL leading-digit-count candidates for "net".
  // beforeDot ends with some run of digits. The whole digit-run is the maximum
  // possible "net integer part"; any suffix of it is a valid candidate.
  const trailingDigitsBeforeDot = beforeDot.match(/(\d+)$/);
  if (!trailingDigitsBeforeDot?.[1]) return null;
  const netIntCandidates = trailingDigitsBeforeDot[1];
  const beforeNetDigits = beforeDot.slice(0, beforeDot.length - netIntCandidates.length);

  for (let netIntLen = netIntCandidates.length; netIntLen >= 1; netIntLen--) {
    const netIntPart = netIntCandidates.slice(netIntCandidates.length - netIntLen);
    const candidateNet = toNum(`${netIntPart}.${lastTwo}`);
    const beforeCandidateNet = beforeNetDigits + netIntCandidates.slice(0, netIntCandidates.length - netIntLen);

    // Now look for a unit price in beforeCandidateNet — must end with "<digits>.<2-digits>".
    if (beforeCandidateNet.length < 4) continue;
    const unitLastTwo = beforeCandidateNet.slice(-2);
    if (!/^\d{2}$/.test(unitLastTwo)) continue;
    if (beforeCandidateNet.charAt(beforeCandidateNet.length - 3) !== '.') continue;
    const beforeUnitDot = beforeCandidateNet.slice(0, -3);
    const trailingDigitsBeforeUnitDot = beforeUnitDot.match(/(\d+)$/);
    if (!trailingDigitsBeforeUnitDot?.[1]) continue;
    const unitIntCandidates = trailingDigitsBeforeUnitDot[1];
    const beforeUnitDigits = beforeUnitDot.slice(0, beforeUnitDot.length - unitIntCandidates.length);

    for (let unitIntLen = unitIntCandidates.length; unitIntLen >= 1; unitIntLen--) {
      const unitIntPart = unitIntCandidates.slice(unitIntCandidates.length - unitIntLen);
      const candidateUnit = toNum(`${unitIntPart}.${unitLastTwo}`);
      const beforeUnit = beforeUnitDigits + unitIntCandidates.slice(0, unitIntCandidates.length - unitIntLen);

      // Trailing digits before unit = qty digits (glued into description).
      const qtyTrailing = beforeUnit.match(/(\d+)$/);
      if (!qtyTrailing?.[1]) continue;
      const qtyDigits = qtyTrailing[1];
      const beforeQty = beforeUnit.slice(0, beforeUnit.length - qtyDigits.length);

      for (let take = 1; take <= qtyDigits.length; take++) {
        const candidateQty = parseInt(qtyDigits.slice(qtyDigits.length - take), 10);
        if (isNaN(candidateQty) || candidateQty === 0) continue;
        const expectedNet = +(candidateQty * candidateUnit).toFixed(2);
        if (Math.abs(expectedNet - candidateNet) <= 0.02) {
          qty = candidateQty;
          unitPrice = candidateUnit;
          net = candidateNet;
          head = beforeQty + qtyDigits.slice(0, qtyDigits.length - take);
          foundValid = true;
          break;
        }
      }
      if (foundValid) break;
    }
    if (foundValid) break;
  }

  if (!foundValid) return null;

  // Now `head` is <PACK><DESC>. AAH pack sizes are typically all-digits
  // (28, 56, 100) or digits + unit (10ML, 60DOSE, 250G).
  // Description always starts with a letter or symbol, so the boundary is
  // where the leading digit/unit run ends.
  const packMatch = head.match(/^(\d+(?:ML|G|MCG|MG|DOSE|MM|CM|L)?)([A-Z\[\(].*)$/i);
  let packSize = '';
  let description = head;
  if (packMatch && packMatch[1] && packMatch[2]) {
    packSize = packMatch[1];
    description = packMatch[2].trim();
  } else {
    // Fall back: just strip leading digits.
    const fallback = head.match(/^(\d+)(.+)$/);
    if (fallback && fallback[1] && fallback[2]) {
      packSize = fallback[1];
      description = fallback[2].trim();
    }
  }
  if (!description) return null;

  const vatRate = parseInt(vatRateStr, 10);
  const gross = toNum(grossStr);
  const vatAmount = +(gross - net).toFixed(2);

  return {
    supplierSku: sku,
    description,
    packSize,
    qty,
    unitPrice,
    net,
    vatRate,
    vatAmount,
    gross,
    flags: flagsRaw && flagsRaw.length > 0 ? flagsRaw : undefined,
  };
}

export function parseAahInvoice(text: string): ParsedInvoice {
  const warnings: string[] = [];

  // Header fields
  const invoiceRefMatch = text.match(/Invoice Ref:\s*(\S+)/i);
  const invoiceDateMatch = text.match(/Invoice Date:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const dueDateMatch = text.match(/Due Date:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const poMatch = text.match(/Your PO Number:\s*(\S+)/i);
  const customerAccountMatch = text.match(/Customer Account:\s*(\S+)/i);

  // Customer name sits between "Customer VAT reg:" line and the address block.
  // Look for the line that starts with "POSSIL" / customer trading name on AAH layout.
  const customerNameMatch = text.match(/Customer VAT reg:[\s\S]*?\n([A-Z][A-Z0-9 &/'\-]+(?:LTD|PHCY|PHARMACY|LIMITED)?)/i);

  if (!invoiceRefMatch?.[1]) warnings.push('Invoice Ref not found');
  if (!invoiceDateMatch?.[1]) warnings.push('Invoice Date not found');

  // Totals: AAH stacks labels then values:
  //   Net Subtotal:
  //   Total VAT:
  //   Total amt due (GBP):
  //   115.95
  //   23.19
  //   139.14
  const totalsBlock = text.match(
    /Net Subtotal:\s*\n\s*Total VAT:\s*\n\s*Total amt due[^\n]*\n([\s\S]+?)(?=\nProduct|\nPlease|\nBank|\nAAH)/i
  );
  let netTotal = 0, vatTotal = 0, grossTotal = 0;
  if (totalsBlock?.[1]) {
    const nums = (totalsBlock[1].match(/[\d.,]+/g) ?? []).map(toNum).filter(n => n > 0);
    if (nums.length >= 3) {
      netTotal = nums[0]!;
      vatTotal = nums[1]!;
      grossTotal = nums[2]!;
    }
  }

  // Line items: AAH SKUs are 3 letters + 4 digits + 1 letter, and every line
  // item ends with a "<digits>%<decimal>[<flags>]" tail. We just scan all lines
  // and pick the ones that match both anchors.
  const allLines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const lines: InvoiceLine[] = [];

  for (const raw of allLines) {
    if (!/^[A-Z]{3}\d{4}[A-Z]/.test(raw)) continue;
    if (!/\d+%[\d.,]+[A-Z*]*$/.test(raw)) continue;
    const parsed = parseLine(raw);
    if (parsed) {
      lines.push(parsed);
    } else {
      warnings.push(`Failed to parse line: "${raw}"`);
    }
  }

  if (lines.length === 0) warnings.push('No line items extracted');

  // Sanity check: do extracted line nets sum to the printed net subtotal?
  const sumNet = +lines.reduce((s, l) => s + l.net, 0).toFixed(2);
  const sumGross = +lines.reduce((s, l) => s + l.gross, 0).toFixed(2);
  const tolerance = 0.02; // pence-level rounding
  const totalsMatch =
    Math.abs(sumNet - netTotal) <= tolerance &&
    Math.abs(sumGross - grossTotal) <= tolerance;

  if (!totalsMatch) {
    warnings.push(
      `Totals mismatch: lines sum net=£${sumNet.toFixed(2)}, ` +
      `printed net=£${netTotal.toFixed(2)}; ` +
      `lines sum gross=£${sumGross.toFixed(2)}, printed gross=£${grossTotal.toFixed(2)}`
    );
  }

  return {
    kind: 'invoice',
    supplier: 'aah',
    invoiceNumber: invoiceRefMatch?.[1] ?? '',
    invoiceDate: invoiceDateMatch?.[1] ? toIsoDate(invoiceDateMatch[1]) : '',
    dueDate: dueDateMatch?.[1] ? toIsoDate(dueDateMatch[1]) : undefined,
    poNumber: poMatch?.[1],
    customerAccount: customerAccountMatch?.[1],
    customerName: customerNameMatch?.[1]?.trim(),
    lines,
    netTotal,
    vatTotal,
    grossTotal,
    totalsMatch,
    warnings,
  };
}
