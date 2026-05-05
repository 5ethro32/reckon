/**
 * Aver Generics statement parser.
 *
 * Statement layout (after pdf-parse column-glue):
 *   Header: AllocationDateTypeReferenceVATDebitCreditNet
 *
 * Sample rows (concatenated, no spaces between columns):
 *   "2.4812.405401542Invoice02/02/2026Unallocated0.0014.88"
 *   "-5.59-27.93153996Credit Note04/02/2026Unallocated33.52"
 *
 * Parsed columns (left-to-right in the actual statement):
 *   VAT | Net | DocumentNumber | Type | Date | AllocationStatus | Debit | Credit
 *
 * Notes:
 *   - "Invoice" rows have all 8 columns; the last numeric is the Total/Debit.
 *   - "Credit Note" rows have negative VAT/Net at the start and only one
 *     trailing amount (the credit value).
 *   - Document numbers are 7-digit invoice numbers (e.g. 5401542) for Invoice
 *     rows or 6-digit credit-note numbers (e.g. 153996) for Credit Note rows.
 *   - The footer block has "Current Grand Total <amount>" plus an ageing
 *     bucket grid. We match against "Current Grand Total" for the headline.
 *
 * Anchors used (left-to-right in the regex):
 *   1. ^[-]?\d+\.\d{2}                 — VAT (signed, 2dp)
 *   2. [-]?[\d,]+\.\d{2}               — Net (signed, 2dp)
 *   3. \d{6,7}                         — Document number
 *   4. Invoice|Credit Note             — Type token
 *   5. \d{2}/\d{2}/\d{4}               — Date (DD/MM/YYYY)
 *   6. Allocated|Unallocated|...       — Allocation status
 *   7+ — trailing amounts (1 for credit, 2 for invoice)
 */

import type { ParsedStatement, StatementRow } from '../types/index';

function toIsoDate(input: string): string {
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

/** Parse a single Aver statement row.
 *
 * The trailing amounts differ by row type:
 *   Invoice:    "...Unallocated0.0014.88"     (Debit=0.00, Credit=14.88)
 *   Credit Note:"...Unallocated33.52"         (single credit total)
 *
 * Returns null if the line doesn't look like a row (e.g. header / footer).
 */
function parseRow(line: string): StatementRow | null {
  // Match the structural anchors first
  const m = line.match(
    /^(-?\d+\.\d{2})(-?[\d,]+\.\d{2})(\d{6,7})(Invoice|Credit Note)(\d{2}\/\d{2}\/\d{4})(Allocated|Unallocated|Part\s?Allocated)(.+)$/
  );
  if (!m) return null;

  const [, vatStr, netStr, docNo, typeToken, dateStr, , trailingStr] = m;
  if (!vatStr || !netStr || !docNo || !typeToken || !dateStr || trailingStr === undefined) return null;

  const vat = toNum(vatStr);
  const net = toNum(netStr);

  // Trailing parse: pull all signed decimals
  const trailingAmounts = (trailingStr.match(/-?[\d,]+\.\d{2}/g) ?? []).map(toNum);

  const documentType: StatementRow['documentType'] =
    typeToken === 'Invoice'      ? 'INV' :
    typeToken === 'Credit Note'  ? 'CRED' : 'OTHER';

  let total: number;
  if (documentType === 'INV') {
    // Invoice: debit, credit (we want the credit / row total which is the gross owed)
    if (trailingAmounts.length < 2) return null;
    // Aver invoice rows: first trailing = Debit (always 0.00 on outstanding rows),
    // second trailing = Credit (the gross amount due). Use the larger of the two.
    total = Math.max(...trailingAmounts);
  } else if (documentType === 'CRED') {
    // Credit Note: single trailing amount = credit value (positive on statement, but
    // economically negative against the customer's ledger).
    if (trailingAmounts.length < 1) return null;
    total = -Math.abs(trailingAmounts[0]!);
  } else {
    return null;
  }

  return {
    date: toIsoDate(dateStr),
    documentNumber: docNo,
    documentType,
    reference: undefined,           // Aver statements don't carry our PO reference
    dueDate: toIsoDate(dateStr),    // Aver doesn't print a separate due date column
    net: documentType === 'CRED' ? -Math.abs(net) : net,
    vat: documentType === 'CRED' ? -Math.abs(vat) : vat,
    total,
  };
}

/**
 * Aver statement footer:
 *   "Current Grand Total<amount>"        — current period total
 *   "Outstanding<amount>"                — total outstanding across all periods
 *   "1 month 2 months 3 months 4 months" — ageing bucket header
 *
 * We pull the "Current Grand Total" as the headline statement total. If absent,
 * fall back to "Outstanding".
 */
function extractAverStatementTotals(text: string): { net: number; vat: number; total: number } {
  const grandTotalMatch = text.match(/Current Grand Total\s*([\d,]+\.\d{2})/i);
  const outstandingMatch = text.match(/Outstanding\s*([\d,]+\.\d{2})/i);

  const total = grandTotalMatch?.[1]
    ? toNum(grandTotalMatch[1])
    : outstandingMatch?.[1]
    ? toNum(outstandingMatch[1])
    : 0;

  // Aver statements don't print a clean net/VAT for the grand total in a
  // parseable way; we'll compute net/VAT by summing the rows (handled by
  // the caller after parsing).
  return { net: 0, vat: 0, total };
}

export function parseAverStatement(text: string): ParsedStatement {
  const warnings: string[] = [];

  const statementDateMatch = text.match(/Statement Date\s*(\d{2}\/\d{2}\/\d{4})/i);
  // Prefer the explicit account ref markers (TO004, etc.) over the postcode.
  // Aver statements include ##VAR1 TOXXX## and ##ACCOUNTREF TOXXX## hidden tags.
  const accountMatch = text.match(/##VAR1\s+([A-Z0-9]+)##/i)
    ?? text.match(/##ACCOUNTREF\s+([A-Z0-9]+)##/i)
    ?? text.match(/Account No\.?\s*\n\s*([A-Z]{2}\d+)/i);

  if (!statementDateMatch?.[1]) warnings.push('Statement Date not found');

  // Walk lines and parse each candidate.
  const allLines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const rows: StatementRow[] = [];

  for (const raw of allLines) {
    // Quick reject: must start with a signed decimal followed by another decimal.
    if (!/^-?\d+\.\d{2}-?\d/.test(raw)) continue;
    // Skip the header row
    if (/AllocationDateTypeReference/i.test(raw)) continue;

    const parsed = parseRow(raw);
    if (parsed) rows.push(parsed);
  }

  if (rows.length === 0) warnings.push('No rows extracted');

  const printedTotals = extractAverStatementTotals(text);

  // For Aver statements the "Current Grand Total" is the open-ledger balance
  // (sum of unallocated invoices minus unallocated credits). We compute the
  // same from rows for verification.
  const sumNet = +rows.reduce((s, r) => s + r.net, 0).toFixed(2);
  const sumVat = +rows.reduce((s, r) => s + r.vat, 0).toFixed(2);
  const sumTotal = +rows.reduce((s, r) => s + r.total, 0).toFixed(2);

  // Aver statements span multiple months (current + 1m + 2m + 3m+). The "Current
  // Grand Total" is just THIS month's open balance, not the sum of all rows.
  // So we don't strictly compare here — flag if rows sum is much larger and let
  // the user investigate.
  const tolerance = 0.05;
  const totalsMatch =
    printedTotals.total > 0 &&
    Math.abs(sumTotal - printedTotals.total) <= tolerance;

  if (!totalsMatch && printedTotals.total > 0) {
    warnings.push(
      `Statement covers multiple periods: rows sum £${sumTotal.toFixed(2)}, ` +
      `Current Grand Total £${printedTotals.total.toFixed(2)} (only current period)`
    );
  }

  return {
    kind: 'statement',
    supplier: 'aver',
    statementDate: statementDateMatch?.[1] ? toIsoDate(statementDateMatch[1]) : '',
    customerAccount: accountMatch?.[1],
    customerName: undefined,
    rows,
    totals: {
      net: printedTotals.net || sumNet,
      vat: printedTotals.vat || sumVat,
      total: printedTotals.total || sumTotal,
    },
    totalsMatch,
    warnings,
  };
}
