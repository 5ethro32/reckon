/**
 * Reckon parser — canonical types
 *
 * These shapes are the contract between the parsers and the rest of the system
 * (database, API, UI). Every supplier parser MUST output these exact shapes
 * regardless of the source format.
 */

/** Suppliers we currently support. Add new ones here as they're onboarded. */
export type SupplierKey = 'aah' | 'aver' | 'phoenix' | 'alliance' | 'ethigen';

/** Document type — same parser can output either kind from a given PDF. */
export type DocumentKind = 'invoice' | 'statement' | 'credit_note' | 'unknown';

/** A single line item on an invoice. */
export interface InvoiceLine {
  /** Supplier's product code as printed on the invoice. */
  supplierSku: string;
  /** Free-text description from the invoice. */
  description: string;
  /** Pack size as printed (e.g. "28", "100ml", "60DOSE"). May be empty. */
  packSize: string;
  /** Number of packs invoiced. */
  qty: number;
  /** Unit price in pounds (excluding VAT). */
  unitPrice: number;
  /** Net line total in pounds (excluding VAT). qty * unitPrice. */
  net: number;
  /** VAT rate as a percentage (e.g. 20 for 20%). 0 for zero-rated. */
  vatRate: number;
  /** VAT amount in pounds. */
  vatAmount: number;
  /** Gross line total including VAT. */
  gross: number;
  /** Free-text notes the supplier put against the line (e.g. "SCM", "*"). */
  flags?: string;
  /** Pack GTIN (14 digits) when the supplier prints it on the invoice (Phoenix does). */
  gtin?: string;
}

/** A parsed invoice, normalised across all suppliers. */
export interface ParsedInvoice {
  kind: 'invoice';
  supplier: SupplierKey;
  /** The supplier's invoice number — primary join key with statements. */
  invoiceNumber: string;
  /** ISO date string (YYYY-MM-DD). */
  invoiceDate: string;
  /** ISO date string. May be undefined for some suppliers. */
  dueDate?: string;
  /** Customer's PO number, if shown on the invoice. */
  poNumber?: string;
  /** The customer account ID as the supplier sees it. */
  customerAccount?: string;
  /** Customer name as shown on the invoice (helps tenant-route on ingest). */
  customerName?: string;
  /** All line items in order. */
  lines: InvoiceLine[];
  /** Sum of net line totals (subtotal before VAT). */
  netTotal: number;
  /** Total VAT charged. */
  vatTotal: number;
  /** Grand total — what the supplier is asking us to pay. */
  grossTotal: number;
  /** Validation: does net + vat = gross? Sum of lines = net total? */
  totalsMatch: boolean;
  /** Any warnings raised during extraction (e.g. "1 line failed regex parse"). */
  warnings: string[];
}

/** A single row on a statement (one invoice or one credit note). */
export interface StatementRow {
  /** Date as printed on the statement (YYYY-MM-DD). */
  date: string;
  /** Supplier's invoice/credit number. The join key. */
  documentNumber: string;
  /** INV / CRED / etc. */
  documentType: 'INV' | 'CRED' | 'OTHER';
  /** Reference field — often a PO number, sometimes blank. */
  reference?: string;
  /** Due date if shown. */
  dueDate?: string;
  /** Net amount (goods value before VAT). */
  net: number;
  /** VAT charged. */
  vat: number;
  /** Total — net + vat (negative for credits). */
  total: number;
}

/** A parsed monthly statement. */
export interface ParsedStatement {
  kind: 'statement';
  supplier: SupplierKey;
  /** The statement issue date (YYYY-MM-DD). */
  statementDate: string;
  customerAccount?: string;
  customerName?: string;
  /** Every invoice/credit listed on the statement. */
  rows: StatementRow[];
  /** Statement totals as printed (separate from sum-of-rows for sanity check). */
  totals: {
    net: number;
    vat: number;
    total: number;
  };
  /** Validation: do row totals sum to printed totals? */
  totalsMatch: boolean;
  warnings: string[];
}

/** Either a parsed invoice or a parsed statement. */
export type ParsedDocument = ParsedInvoice | ParsedStatement;

/** Result of supplier auto-detection. */
export interface DetectionResult {
  supplier: SupplierKey | 'unknown';
  kind: DocumentKind;
  /** 0..1 confidence that we identified the supplier+kind correctly. */
  confidence: number;
  /** Why we made this guess (for debugging). */
  signals: string[];
}

// ---------------------------------------------------------------------------
// Dispensing system (PMR) exports
// ---------------------------------------------------------------------------

/** PMR reports we read. Positive Solutions (PSL) Pharmacy Manager is the first source system. */
export type PmrReport = 'product_usage' | 'stock_value' | 'items_processed';

/** Packs dispensed of one product in one calendar month at one site. */
export interface PmrDispensingRow {
  /** Product description as the PMR prints it (dm+d style, manufacturer included). */
  description: string;
  /** Units per pack, from the report's Pack Size column or the description. */
  packSize: number | null;
  /** YYYY-MM. */
  month: string;
  /** Whole or part packs dispensed. */
  packs: number;
  /** Units dispensed (tablets, ml, ...), when known. */
  units: number | null;
  /** Value at tariff, as the report prints it. */
  value: number | null;
  /** Branch name for multi-site exports ("Spoke" in PSL); empty for a single site. */
  site: string;
}

/** Stock held of one product at one location when the report was run. */
export interface PmrStockRow {
  description: string;
  packSize: number | null;
  /** Location heading the row sat under (e.g. "BDRowa", "Manual", "On Order"). */
  location: string;
  /** Packs at that location. "On Order" rows are on order, not on hand. */
  quantity: number;
  /** Tariff price per pack. */
  tariff: number | null;
  value: number | null;
  status: string;
}

/** A PIP code the PMR used for a product description. */
export interface PmrPipRow {
  description: string;
  /** Seven digits, without the "P" prefix PSL prints. */
  pip: string;
}

export interface ParsedPmr {
  kind: 'pmr';
  system: 'psl';
  report: PmrReport;
  /** First and last day covered, for usage and items reports (YYYY-MM-DD). */
  periodStart: string | null;
  periodEnd: string | null;
  /** When a stock report was run (YYYY-MM-DD), from the export file name when present. */
  snapshotDate: string | null;
  /** Sites named in the export. */
  sites: string[];
  /** How the source states dispensed quantities before conversion to packs. */
  quantityBasis: 'packs' | 'units' | null;
  dispensing: PmrDispensingRow[];
  stock: PmrStockRow[];
  pips: PmrPipRow[];
  /** Source rows read as product rows. */
  sourceRows: number;
  /** Headings, totals and blank rows that were skipped. */
  skippedRows: number;
  /** Columns present in the export that Reckon does not read or store. */
  ignoredColumns: string[];
  warnings: string[];
}
