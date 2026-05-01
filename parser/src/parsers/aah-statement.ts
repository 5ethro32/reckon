/**
 * AAH statement parser.
 *
 * Statement layout (per row):
 *   Date | Document | Type | Reference | Due Date | GOODS | VAT | Total
 *
 * Sample rows after PDF text extraction:
 *   "02/03/2026 41444719S INV. 17762 30/04/2026 491.54 98.31 589.85"
 *   "09/03/2026 95571705E INV. 30/04/2026 30.00 6.00 36.00"   ← no reference column
 *   "09/03/2026 01129409N CRED 17828 30/04/2026 -320.00 -64.00 -384.00"
 *
 * The Reference column is sometimes blank. Anchor on the trailing 4 numbers
 * (due date + 3 amounts) and walk backwards.
 */

import type { ParsedStatement, StatementRow } from '../types/index.js';

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

/** Parse a single statement row.
 *
 * pdf-parse joins columns without spaces. A row looks like:
 *   "09/03/202601129409NCRED1782830/04/2026-320.00-64.00-384.00"
 *
 * Pattern (concatenated):
 *   DD/MM/YYYY                                — date
 *   <document>                                 — alphanumeric, ends in a letter (typically 9 chars)
 *   <type>                                     — INV. (with dot) or CRED
 *   <reference>?                               — digits, optional
 *   DD/MM/YYYY                                 — due date
 *   <net> <vat> <total>                        — signed decimals
 *
 * Document numbers on AAH statements end with a letter (95571705E, 41444719S, etc.).
 * Type token is "INV." or "CRED" — both detectable.
 *
 * Anchors used (left-to-right):
 *   1. Date prefix DD/MM/YYYY (10 chars exactly, format-checked)
 *   2. Document terminates immediately before "INV." or "CRED"
 *   3. Reference (if present) is digits between the type and the due-date prefix
 *   4. Due date is another DD/MM/YYYY
 *   5. Three trailing signed decimals = net, vat, total
 */
function parseRow(line: string): StatementRow | null {
  // Reference column can be: empty, digits (PO numbers), or words ("Autocharge",
  // "SUPPTRAN1102"). Match as "any non-greedy chars before the due-date prefix".
  const m = line.match(
    /^(\d{2}\/\d{2}\/\d{4})(.+?)(INV\.|CRED)(.*?)(\d{2}\/\d{2}\/\d{4})(-?[\d,]+\.\d{2})(-?[\d,]+\.\d{2})(-?[\d,]+\.\d{2})$/
  );
  if (!m) return null;

  const [, date, docNo, typeToken, reference, dueDate, netStr, vatStr, totalStr] = m;
  if (!date || !docNo || !typeToken || !dueDate || !netStr || !vatStr || !totalStr) return null;

  const documentType: StatementRow['documentType'] =
    typeToken === 'INV.' ? 'INV' :
    typeToken === 'CRED' ? 'CRED' : 'OTHER';

  const refTrimmed = reference?.trim();

  return {
    date: toIsoDate(date),
    documentNumber: docNo.trim(),
    documentType,
    reference: refTrimmed && refTrimmed.length > 0 ? refTrimmed : undefined,
    dueDate: toIsoDate(dueDate),
    net: toNum(netStr),
    vat: toNum(vatStr),
    total: toNum(totalStr),
  };
}

export function parseAahStatement(text: string): ParsedStatement {
  const warnings: string[] = [];

  const statementDateMatch = text.match(/Statement Date:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const accountMatch = text.match(/Customer Account:\s*(\S+)/i);
  // Customer name appears before the address block, after the page header
  const customerNameMatch = text.match(/G22 5JL[\s\S]{0,1}|^([A-Z][A-Z &]+LTD)/m)
    ?? text.match(/(A G BANNERMAN LTD)/i);

  if (!statementDateMatch?.[1]) warnings.push('Statement Date not found');

  // Walk lines and parse each one that looks like a row.
  const allLines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const rows: StatementRow[] = [];

  for (const raw of allLines) {
    // Skip header rows / summary rows quickly
    if (/^Date\s+Document\s+Type/i.test(raw)) continue;
    if (/^TOTALS/i.test(raw)) continue;
    if (/^Statement of Account/i.test(raw)) continue;
    if (/^Pages?:/i.test(raw)) continue;
    // Must start with a DD/MM/YYYY date to be a candidate row
    if (!/^\d{2}\/\d{2}\/\d{4}/.test(raw)) continue;

    const parsed = parseRow(raw);
    if (parsed) {
      rows.push(parsed);
    }
    // Don't warn on every miss — the statement has many lines that aren't rows
    // (page headers repeat, address blocks, etc.).
  }

  if (rows.length === 0) warnings.push('No rows extracted');

  // Statement totals from the TOTALS line + REMITTANCE block.
  // pdf-parse glues columns: "TOTALS18,587.483,680.3822,267.86"
  const totalsRowMatch = text.match(/TOTALS\s*([\d,]+\.\d{2})([\d,]+\.\d{2})([\d,]+\.\d{2})/);
  // Due On format: "Due On 30/04/202622,267.86"
  const dueOnMatch = text.match(/Due On\s*\d{2}\/\d{2}\/\d{4}([\d,]+\.\d{2})/);

  const printedNet = totalsRowMatch?.[1] ? toNum(totalsRowMatch[1]) : 0;
  const printedVat = totalsRowMatch?.[2] ? toNum(totalsRowMatch[2]) : 0;
  const printedTotal = totalsRowMatch?.[3] ? toNum(totalsRowMatch[3]) : (dueOnMatch?.[1] ? toNum(dueOnMatch[1]) : 0);

  const sumNet = +rows.reduce((s, r) => s + r.net, 0).toFixed(2);
  const sumVat = +rows.reduce((s, r) => s + r.vat, 0).toFixed(2);
  const sumTotal = +rows.reduce((s, r) => s + r.total, 0).toFixed(2);
  const tolerance = 0.05;
  const totalsMatch =
    Math.abs(sumNet - printedNet) <= tolerance &&
    Math.abs(sumTotal - printedTotal) <= tolerance;

  if (!totalsMatch) {
    warnings.push(
      `Totals mismatch: rows sum net=£${sumNet.toFixed(2)} (printed £${printedNet.toFixed(2)}), ` +
      `rows sum total=£${sumTotal.toFixed(2)} (printed £${printedTotal.toFixed(2)})`
    );
  }

  return {
    kind: 'statement',
    supplier: 'aah',
    statementDate: statementDateMatch?.[1] ? toIsoDate(statementDateMatch[1]) : '',
    customerAccount: accountMatch?.[1],
    customerName: customerNameMatch?.[1]?.trim(),
    rows,
    totals: {
      net: printedNet,
      vat: printedVat,
      total: printedTotal,
    },
    totalsMatch,
    warnings,
  };
}
