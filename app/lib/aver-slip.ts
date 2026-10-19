/** An Aver invoice as the slip lookup returns it (revabyaver.co.uk /api/partner/slip). */
export type SlipInvoice = {
  invoiceNo: string;
  account: string;
  invoicedAt: string;
  paymentDue: string | null;
  net: number;
  vat: number;
  gross: number;
  lines: { code: string; description: string; pip: string | null; qty: number; unitPrice: number; unitVat: number; net: number }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The picking-list id in an Aver slip QR ("AVERPL:<uuid>"); null for anything else, CD sheets included. */
export function averSlipId(raw: string): string | null {
  const m = /^AVERPL:([0-9a-f-]{36})$/i.exec(raw.trim());
  return m && UUID.test(m[1]!) ? m[1]!.toLowerCase() : null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Reckon's invoice and line rows for one slip invoice, as the Aver PDF parser would give them. */
export function slipInvoiceRows(inv: SlipInvoice) {
  const day = new Date(inv.invoicedAt).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const header = {
    invoice_number: inv.invoiceNo,
    invoice_date: day,
    due_date: inv.paymentDue,
    customer_account: inv.account,
    net_total: r2(inv.net),
    vat_total: r2(inv.vat),
    gross_total: r2(inv.gross),
    totals_match: Math.abs(r2(inv.lines.reduce((s, l) => s + l.net, 0)) - r2(inv.net)) < 0.02,
    warnings: [] as string[],
  };
  const lines = inv.lines.map((l, i) => {
    // Pack size after the last " / " ("Ramipril Caps 2.5mg / 28"), with any CD marker after it dropped.
    const slash = l.description.lastIndexOf(' / ');
    const pack = slash >= 0 ? l.description.slice(slash + 3).replace(/\s+CD[\d.]+$/i, '').trim() : null;
    const vat = r2(l.unitVat * l.qty);
    return {
      line_number: i + 1,
      supplier_sku: l.code,
      description: l.description,
      pack_size: pack || null,
      qty_ordered: l.qty,
      unit_price: l.unitPrice,
      net: r2(l.net),
      vat_rate: l.net > 0 ? Math.round((vat / l.net) * 100) : 0,
      vat_amount: vat,
      gross: r2(l.net + vat),
    };
  });
  return { header, lines };
}
