/**
 * Compose subject + body for a credit chase email.
 *
 * Tone: family-business, warm, professional. No legalese, no regulation
 * citations, no "Dear Sir/Madam". 4-8 lines body max where possible.
 *
 * Pure function — no DB, no IO. Caller passes in already-resolved data.
 */

const supplierLabels: Record<string, string> = {
  aah: 'AAH',
  aver: 'Aver',
  phoenix: 'Phoenix',
  alliance: 'Alliance',
  ethigen: 'Ethigen',
  numark: 'Numark',
};

export type DamageDisposition = 'returning' | 'disposed' | 'awaiting' | null;

export type CreditEmailLine = {
  /** Invoice number this line came from. */
  invoiceNumber: string;
  /** ISO invoice date (YYYY-MM-DD) — formatted DD/MM/YYYY in body. */
  invoiceDate: string;
  supplierSku: string;
  description: string;
  packSize: string | null;
  qtyOrdered: number;
  qtyReceived: number | null;
  /** flags array from invoice_lines.flags. */
  flags: string[];
  /** Net amount (excluding VAT) for this line. */
  net?: number;
  /** VAT amount for this line. */
  vatAmount?: number;
  /** Gross amount of this single line (net + VAT — what supplier actually owes back). */
  gross: number;
  /** Pharmacist's freeform note on the line. Newlines stripped on render. */
  notes?: string | null;
  /** Only meaningful when flags includes 'damaged'. */
  damageDisposition?: DamageDisposition;
};

export type CreditEmailInput = {
  supplier: string;          // 'aah', 'aver', etc.
  contactName?: string | null;
  pharmacyName?: string | null;
  accountNumber?: string | null;
  signature?: string | null;     // multiline signature block
  fallbackSignerName?: string | null;  // fallback if signature is empty (e.g. user.email)
  /** Gross total to chase (net + VAT). The figure rendered as "raise a credit for £X". */
  totalAmount: number;
  /** Optional net subtotal — when present, we render "(net £X + VAT £Y)" alongside the gross.
   *  If omitted, we sum line.net values where available. */
  netTotal?: number;
  /** Optional VAT subtotal. If omitted, we sum line.vatAmount values where available. */
  vatTotal?: number;
  lines: CreditEmailLine[];
  /** Set true if no supplier_contacts row was found and we're using a default email. */
  usingFallbackEmail?: boolean;
  /** Optional caller-supplied warnings, surfaced as a small note at the foot of the email. */
  warnings?: string[];
};

export type CreditEmailOutput = {
  subject: string;
  body: string;
};

function formatDate(iso: string): string {
  // Expecting YYYY-MM-DD; render DD/MM/YYYY without locale dependency.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  // Fallback for non-standard inputs
  const d = new Date(iso);
  if (!isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    return `${dd}/${mm}/${yy}`;
  }
  return iso;
}

/** Strip newlines and collapse whitespace so notes stay on a single line. */
function cleanNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const cleaned = note.replace(/[\r\n]+/g, '; ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Render the per-line bullet text, varying by exception type.
 *
 * Format keys (per spec):
 *   short            : "<desc> (<sku>): received N of M — short K packs"
 *   damaged-returning: "<desc> (<sku>): N packs damaged on arrival — returning via your next driver"
 *   damaged-disposed : "<desc> (<sku>): N packs damaged on arrival — disposed per policy"
 *   damaged-awaiting : "<desc> (<sku>): N packs damaged on arrival — awaiting your guidance on next steps"
 *   not_received     : "<desc> (<sku>): not received"
 */
function lineDescriptor(line: CreditEmailLine): string {
  const pack = line.packSize ? ` / ${line.packSize}` : '';
  const head = `${line.description}${pack} (${line.supplierSku})`;
  const note = cleanNote(line.notes);
  // Per-line gross amount in parentheses so the supplier can verify against
  // their copy of the invoice. This is the credit owed for THIS line specifically.
  const amount = ` (£${line.gross.toFixed(2)})`;

  // not_received takes precedence — it's the strongest signal.
  if (line.flags.includes('not_received')) {
    let body = `not received${amount}`;
    if (note) body += ` — Note: ${note}`;
    return `- ${head}: ${body}`;
  }

  if (line.flags.includes('damaged')) {
    // For damaged we lean on qty_received as the count of damaged packs if
    // qty_received is set and < qty_ordered (likely some were fine, some damaged);
    // otherwise we fall back to qty_ordered as the damaged count.
    const damagedQty =
      line.qtyReceived !== null && line.qtyReceived < line.qtyOrdered
        ? Math.max(1, line.qtyOrdered - line.qtyReceived)
        : line.qtyOrdered;
    const packWord = damagedQty === 1 ? 'pack' : 'packs';
    const head2 = `${damagedQty} ${packWord} damaged on arrival`;
    let tail = '';
    switch (line.damageDisposition ?? null) {
      case 'returning':
        tail = ' — returning via your next driver';
        break;
      case 'disposed':
        tail = ' — disposed per policy';
        if (note) tail += ' (notes available on request)';
        break;
      case 'awaiting':
        tail = ' — awaiting your guidance on next steps';
        break;
      default:
        tail = '';
    }
    let line2 = `- ${head}: ${head2}${tail}${amount}`;
    // For non-disposed dispositions, append the note inline for context.
    if (note && line.damageDisposition !== 'disposed') {
      line2 += ` — Note: ${note}`;
    }
    return line2;
  }

  if (line.flags.includes('short')) {
    const received = line.qtyReceived ?? 0;
    const shortBy = Math.max(0, line.qtyOrdered - received);
    const packWord = shortBy === 1 ? 'pack' : 'packs';
    let body = `received ${received} of ${line.qtyOrdered} — short ${shortBy} ${packWord}${amount}`;
    if (note) body += ` — Note: ${note}`;
    return `- ${head}: ${body}`;
  }

  // Generic fallback when flags don't match a known descriptor.
  let body = line.flags.length > 0 ? line.flags.join(', ') : 'discrepancy';
  body += amount;
  if (note) body += ` — Note: ${note}`;
  return `- ${head}: ${body}`;
}

/**
 * Group lines by their source invoice (invoiceNumber) so the email lists each
 * invoice's discrepancies together. Order preserved by first appearance.
 */
function groupByInvoice(
  lines: CreditEmailLine[]
): Array<{ invoiceNumber: string; invoiceDate: string; lines: CreditEmailLine[] }> {
  const order: string[] = [];
  const byInv = new Map<
    string,
    { invoiceNumber: string; invoiceDate: string; lines: CreditEmailLine[] }
  >();
  for (const l of lines) {
    if (!byInv.has(l.invoiceNumber)) {
      order.push(l.invoiceNumber);
      byInv.set(l.invoiceNumber, {
        invoiceNumber: l.invoiceNumber,
        invoiceDate: l.invoiceDate,
        lines: [],
      });
    }
    byInv.get(l.invoiceNumber)!.lines.push(l);
  }
  return order.map(n => byInv.get(n)!);
}

/**
 * Render the opening sentence describing which invoice(s) were received.
 *
 *   single  : "We received delivery for <Supplier> invoice 123 on 01/05/2026 and noticed the following:"
 *   single+1: "We received delivery for <Supplier> invoice 123 on 01/05/2026 and noticed a discrepancy:"
 *   multi   : "We received deliveries for <Supplier> invoices 123, 456 and noticed the following:"
 *   long    : "We received deliveries for <Supplier> invoices 123, 456, 789 and 4 others and noticed the following:"
 */
function buildOpeningSentence(
  supplierLabel: string,
  groups: ReturnType<typeof groupByInvoice>,
  totalLineCount: number
): string {
  if (groups.length === 1) {
    const g = groups[0]!;
    const tail = totalLineCount === 1 ? 'noticed a discrepancy:' : 'noticed the following:';
    return `We received delivery for ${supplierLabel} invoice ${g.invoiceNumber} on ${formatDate(
      g.invoiceDate
    )} and ${tail}`;
  }

  // Multiple invoices — list invoice numbers, truncate if more than 3.
  const numbers = groups.map(g => g.invoiceNumber);
  let invoiceList: string;
  if (numbers.length <= 3) {
    invoiceList = numbers.join(', ');
  } else {
    const head = numbers.slice(0, 3).join(', ');
    const others = numbers.length - 3;
    invoiceList = `${head} and ${others} other${others === 1 ? '' : 's'}`;
  }
  return `We received deliveries for ${supplierLabel} invoices ${invoiceList} and noticed the following:`;
}

export function buildCreditEmail(input: CreditEmailInput): CreditEmailOutput {
  const supplierLabel = supplierLabels[input.supplier] ?? input.supplier;

  // Defensive: caller shouldn't normally invoke this with an empty line list.
  if (input.lines.length === 0) {
    return {
      subject: 'Credit request',
      body: 'No exceptions to report.',
    };
  }

  const greetName = input.contactName?.trim() || 'team';
  const groups = groupByInvoice(input.lines);
  const isMulti = groups.length > 1;

  // Subject — single invoice variant is friendlier; multi-invoice is summary.
  const pharmTag = input.pharmacyName ? ` (${input.pharmacyName})` : '';
  const subject = isMulti
    ? `Credit request — ${supplierLabel} (${groups.length} invoices)${pharmTag}`
    : `Credit request — ${supplierLabel} invoice ${groups[0]!.invoiceNumber}${pharmTag}`;

  const out: string[] = [];
  out.push(`Hi ${greetName},`);
  out.push('');
  out.push(buildOpeningSentence(supplierLabel, groups, input.lines.length));
  out.push('');

  for (const group of groups) {
    if (isMulti) {
      out.push(`Invoice ${group.invoiceNumber} (${formatDate(group.invoiceDate)}):`);
    }
    for (const l of group.lines) {
      out.push(lineDescriptor(l));
    }
    if (isMulti) out.push('');
  }

  if (!isMulti) out.push('');

  // Net/VAT breakdown — prefer caller-supplied totals; fall back to summing
  // line.net / line.vatAmount where available; if neither is supplied, just
  // print the gross.
  const summedNet = input.lines.reduce(
    (s, l) => s + (typeof l.net === 'number' ? l.net : 0),
    0
  );
  const summedVat = input.lines.reduce(
    (s, l) => s + (typeof l.vatAmount === 'number' ? l.vatAmount : 0),
    0
  );
  const netTotal =
    typeof input.netTotal === 'number'
      ? input.netTotal
      : summedNet > 0
      ? summedNet
      : null;
  const vatTotal =
    typeof input.vatTotal === 'number'
      ? input.vatTotal
      : summedVat > 0
      ? summedVat
      : null;

  let askLine: string;
  if (netTotal !== null && vatTotal !== null) {
    askLine = `Please could you raise a credit for £${input.totalAmount.toFixed(
      2
    )} (net £${netTotal.toFixed(2)} + VAT £${vatTotal.toFixed(2)})?`;
  } else {
    askLine = `Please could you raise a credit for £${input.totalAmount.toFixed(
      2
    )} (gross, including VAT)?`;
  }
  out.push(askLine);
  out.push('');

  // Signature block. Prefer supplier_contacts.signature (custom per-supplier),
  // fall back to "Thanks,\n<email or name>".
  const signature =
    input.signature?.trim() ||
    `Thanks,\n${input.fallbackSignerName ?? ''}`.trim();
  out.push(signature);

  if (input.pharmacyName) out.push(input.pharmacyName);
  if (input.accountNumber) out.push(`Account: ${input.accountNumber}`);

  if (input.usingFallbackEmail) {
    out.push('');
    out.push(
      '(Note: please confirm this is the right address for credit requests — happy to update our records.)'
    );
  }

  if (input.warnings && input.warnings.length > 0) {
    out.push('');
    for (const w of input.warnings) out.push(`(${w})`);
  }

  return {
    subject,
    body: out.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Inline self-test — run with `npx tsx lib/email/credit-template.ts`
// Prints sample emails for visual inspection. No assertions.
// ---------------------------------------------------------------------------
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('credit-template.ts')) {
  const base = {
    supplier: 'aver',
    contactName: 'Sarah',
    pharmacyName: 'Bannermans Pharmacy',
    accountNumber: 'BAN-0142',
    signature: null,
    fallbackSignerName: 'pharmacist@example.com',
    totalAmount: 0,
  };
  const sku1 = {
    invoiceNumber: '5403511',
    invoiceDate: '2026-04-29',
    supplierSku: 'C-3116',
    description: 'Citalopram Tabs 10mg',
    packSize: '28',
    qtyOrdered: 28,
    qtyReceived: 12,
    gross: 14.32,
  };
  const sku2 = {
    invoiceNumber: '5403511',
    invoiceDate: '2026-04-29',
    supplierSku: 'D-1921',
    description: 'Quetiapine Tabs 150mg',
    packSize: '60',
    qtyOrdered: 5,
    qtyReceived: 2,
    gross: 87.5,
  };
  const sku3 = {
    invoiceNumber: '5403511',
    invoiceDate: '2026-04-29',
    supplierSku: 'D-3306',
    description: 'Diazepam Tabs 5mg',
    packSize: '28',
    qtyOrdered: 4,
    qtyReceived: 0,
    gross: 9.6,
  };

  const samples: Array<[string, CreditEmailInput]> = [
    ['SHORT', { ...base, totalAmount: 14.32, lines: [{ ...sku1, flags: ['short'] }] }],
    [
      'DAMAGED — returning',
      {
        ...base,
        totalAmount: 87.5,
        lines: [{ ...sku2, flags: ['damaged'], damageDisposition: 'returning' }],
      },
    ],
    [
      'DAMAGED — disposed (with note)',
      {
        ...base,
        totalAmount: 87.5,
        lines: [
          {
            ...sku2,
            flags: ['damaged'],
            damageDisposition: 'disposed',
            notes: 'wet packaging on bottom 3',
          },
        ],
      },
    ],
    ['NOT RECEIVED', { ...base, totalAmount: 9.6, lines: [{ ...sku3, flags: ['not_received'] }] }],
    [
      'BATCHED multi-invoice mixed types',
      {
        ...base,
        totalAmount: 111.42,
        lines: [
          { ...sku1, flags: ['short'], notes: 'third box light' },
          { ...sku2, flags: ['damaged'], damageDisposition: 'awaiting', invoiceNumber: '5403512' },
          { ...sku3, flags: ['not_received'], invoiceNumber: '5403513' },
        ],
      },
    ],
    [
      'SHORT with note',
      {
        ...base,
        totalAmount: 14.32,
        lines: [{ ...sku1, flags: ['short'], notes: 'expired Mar 26\nsecond box wet' }],
      },
    ],
  ];

  for (const [label, input] of samples) {
    const { subject, body } = buildCreditEmail(input);
    console.log(`\n========== ${label} ==========`);
    console.log(`Subject: ${subject}`);
    console.log('---');
    console.log(body);
  }
}
