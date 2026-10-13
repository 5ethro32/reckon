/**
 * Phoenix Healthcare Distribution statement of account parser.
 *
 * Rows: DATE  TRANSACTION TYPE  [YOUR REF]  OUR INVOICE No  DEBIT|CREDIT  BALANCE
 *   "01/11/24  INVOICE PHD   95288666   44.40   44.40"
 *   "29/11/24  CREDITS PHD  RW  7143647   11.08   27792.91"
 *   "30/11/24  DIRECT DEBIT   862197   27570.80   0.00"
 * Only one of debit/credit is printed, so the sign comes from the transaction type. Negative
 * balances print with a trailing minus ("5.02-"). Phoenix statements show gross amounts only,
 * so net is the gross amount and VAT is not split out.
 */
import type { ParsedStatement, StatementRow } from '../types/index';

const amount = (s: string) => (s.endsWith('-') ? -1 : 1) * Number(s.replace(/[-,]/g, ''));
const iso = (d: string) => { const [dd, mm, yy] = d.split('/'); return `${yy!.length === 2 ? `20${yy}` : yy}-${mm}-${dd}`; };

export function parsePhoenixStatement(text: string): ParsedStatement {
  const warnings: string[] = [];
  const head = text.match(/\n\s*(\d{3,8})\s*\n\s*([A-Z]{3}-\d{2})\s*\n\s*(\d{2}\/\d{2}\/\d{4})\s*\n/);
  if (!head) warnings.push('Statement account and date not found');
  const rows: StatementRow[] = [];
  let opening = 0;
  const re = /^\s*(\d{2}\/\d{2}\/\d{2})\s+(INVOICE PHD|CREDITS PHD|DIRECT DEBIT|DD DISCOUNT|BALANCE FORWARD|PAYMENT|CHEQUE|ADJUSTMENT)\b\s*(.*?)\s+(\d{3,10})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2}-?)\s*$/gm;
  for (const m of text.matchAll(re)) {
    const [, date, type, ref, number, value] = m;
    const v = amount(value!);
    if (type === 'BALANCE FORWARD') { opening += v; continue; }
    const kind: StatementRow['documentType'] = type === 'INVOICE PHD' ? 'INV' : type === 'CREDITS PHD' ? 'CRED' : 'OTHER';
    const total = kind === 'INV' ? v : -v;
    rows.push({ date: iso(date!), documentNumber: number!, documentType: kind, reference: ref?.trim() || undefined, net: total, vat: 0, total });
  }
  if (rows.length === 0) warnings.push('No statement rows extracted');
  const outstanding = text.match(/TOTAL OUTSTANDING\s+([\d,]+\.\d{2}-?)/);
  const closing = outstanding ? amount(outstanding[1]!) : NaN;
  const sum = Math.round((opening + rows.reduce((s, r) => s + r.total, 0)) * 100) / 100;
  const totalsMatch = Number.isFinite(closing) && Math.abs(sum - closing) <= 0.01;
  if (!totalsMatch) warnings.push(`Totals mismatch: brought forward plus rows = £${sum.toFixed(2)}, total outstanding = ${Number.isFinite(closing) ? `£${closing.toFixed(2)}` : 'not found'}`);
  const invTotal = Math.round(rows.filter((r) => r.documentType !== 'OTHER').reduce((s, r) => s + r.total, 0) * 100) / 100;
  return {
    kind: 'statement',
    supplier: 'phoenix',
    statementDate: head ? iso(head[3]!) : '',
    customerAccount: head?.[1],
    customerName: text.match(/Page No:\s*\n([^\n]+)\n\s*([^\n]*\))/)?.slice(1, 3).map((x) => x.trim()).join(' ').replace(/\s+/g, ' '),
    rows,
    totals: { net: invTotal, vat: 0, total: invTotal },
    totalsMatch,
    warnings,
  };
}
