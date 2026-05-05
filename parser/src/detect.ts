/**
 * Supplier + document kind auto-detection.
 *
 * Each supplier has stable header markers in their PDFs. We score each
 * supplier against the raw text and return the highest-scoring match.
 * If no signal scores above the confidence floor we return 'unknown'
 * and the caller falls back to asking the human.
 */

import type { DetectionResult, SupplierKey, DocumentKind } from './types/index';

interface Signal {
  /** Pattern to match in the document text. */
  pattern: RegExp;
  /** Score boost on match (0..1). Markers more unique to a supplier score higher. */
  weight: number;
  /** Human label for debugging. */
  label: string;
}

interface SupplierFingerprint {
  supplier: SupplierKey;
  signals: Signal[];
}

const FINGERPRINTS: SupplierFingerprint[] = [
  {
    supplier: 'aah',
    signals: [
      { pattern: /AAH Pharmaceuticals Ltd/i,           weight: 0.5, label: 'AAH legal name' },
      { pattern: /Haywood Road,?\s*Warwick/i,          weight: 0.3, label: 'AAH address' },
      { pattern: /AAH VAT registration/i,              weight: 0.3, label: 'AAH VAT line' },
      { pattern: /aah\.co\.uk/i,                       weight: 0.2, label: 'AAH domain' },
      { pattern: /AAHReceivables@aah\.co\.uk/i,        weight: 0.3, label: 'AAH receivables email' },
    ],
  },
  {
    supplier: 'aver',
    signals: [
      { pattern: /Aver Generics Ltd/i,                 weight: 0.5, label: 'Aver legal name' },
      { pattern: /20 Singer Road/i,                    weight: 0.3, label: 'Aver address' },
      { pattern: /VAT Reg No:?\s*156\s*0846\s*04/i,    weight: 0.4, label: 'Aver VAT number' },
      { pattern: /avergenerics\.co\.uk/i,              weight: 0.3, label: 'Aver domain' },
      { pattern: /SC\s*441171/i,                       weight: 0.2, label: 'Aver company number' },
    ],
  },
  {
    supplier: 'phoenix',
    signals: [
      { pattern: /Phoenix Healthcare/i,                weight: 0.5, label: 'Phoenix legal name' },
      { pattern: /phoenixuk\.com/i,                    weight: 0.3, label: 'Phoenix domain' },
    ],
  },
  {
    supplier: 'alliance',
    signals: [
      { pattern: /Alliance Healthcare/i,               weight: 0.5, label: 'Alliance legal name' },
      { pattern: /alliance[-\s]?healthcare\.co\.uk/i,  weight: 0.3, label: 'Alliance domain' },
    ],
  },
  {
    supplier: 'ethigen',
    signals: [
      { pattern: /Ethigen/i,                           weight: 0.5, label: 'Ethigen name' },
      { pattern: /ethigen\.com/i,                      weight: 0.3, label: 'Ethigen domain' },
    ],
  },
];

/** Detect document kind based on textual signals. */
function detectKind(text: string): { kind: DocumentKind; signals: string[] } {
  const signals: string[] = [];
  let invoiceScore = 0;
  let statementScore = 0;
  let creditScore = 0;

  // Statement signals — multiple supplier formats
  if (/Statement of Account/i.test(text))         { statementScore += 0.6; signals.push('"Statement of Account" header'); }
  if (/Statement Date[:\s\n]/i.test(text))        { statementScore += 0.5; signals.push('Statement Date label'); }
  if (/REMITTANCE DETAILS/i.test(text))           { statementScore += 0.2; signals.push('Remittance section'); }
  if (/Due For Payment:/i.test(text))             { statementScore += 0.2; signals.push('Due For Payment header'); }
  // Aver statement: column header + ageing buckets
  if (/AllocationDateTypeReference/i.test(text))  { statementScore += 0.5; signals.push('Aver statement column header'); }
  if (/1 month\s*2 months\s*3 months/i.test(text)) { statementScore += 0.4; signals.push('ageing buckets (1/2/3 months)'); }
  if (/Current Grand Total/i.test(text))          { statementScore += 0.3; signals.push('Current Grand Total label'); }
  // Many "Credit Note" or "CRED" rows = statement, not a single credit note doc
  const credMentions = (text.match(/Credit Note|CRED\b/gi) ?? []).length;
  if (credMentions >= 3)                          { statementScore += 0.3; signals.push(`${credMentions} credit-note row mentions`); }

  // Invoice signals
  if (/^INVOICE\s*$/im.test(text))                { invoiceScore += 0.4; signals.push('"INVOICE" page title'); }
  if (/Invoice Ref:/i.test(text))                 { invoiceScore += 0.3; signals.push('Invoice Ref label (AAH)'); }
  if (/Invoice No\.?[\s\n]/i.test(text))          { invoiceScore += 0.3; signals.push('Invoice No label (Aver)'); }
  if (/Invoice\/Tax Date/i.test(text))            { invoiceScore += 0.3; signals.push('Invoice/Tax Date label'); }
  if (/Total amt due/i.test(text))                { invoiceScore += 0.2; signals.push('Total amt due label'); }

  // Credit note signals — STANDALONE credit note documents only.
  // "CREDIT NOTE" must appear as a TITLE (alone on a line, all caps, not embedded in a row).
  // If we see lots of "Credit Note" mentions, that's a statement listing them, not a credit note doc.
  if (/^\s*CREDIT NOTE\s*$/im.test(text) && credMentions <= 2) {
    creditScore += 0.7;
    signals.push('"CREDIT NOTE" standalone title');
  }

  // Pick highest
  const max = Math.max(invoiceScore, statementScore, creditScore);
  if (max < 0.3) return { kind: 'unknown', signals };
  if (statementScore === max) return { kind: 'statement', signals };
  if (creditScore === max)    return { kind: 'credit_note', signals };
  return { kind: 'invoice', signals };
}

/** Score a single supplier fingerprint against the document text. */
function scoreSupplier(fp: SupplierFingerprint, text: string): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  for (const sig of fp.signals) {
    if (sig.pattern.test(text)) {
      score += sig.weight;
      matched.push(sig.label);
    }
  }
  return { score: Math.min(1, score), matched };
}

/**
 * Identify supplier and document kind from raw PDF text.
 * Returns 'unknown' supplier when no fingerprint matches confidently.
 */
export function detect(text: string): DetectionResult {
  const kindResult = detectKind(text);

  let bestSupplier: SupplierKey | 'unknown' = 'unknown';
  let bestScore = 0;
  let bestMatched: string[] = [];

  for (const fp of FINGERPRINTS) {
    const { score, matched } = scoreSupplier(fp, text);
    if (score > bestScore) {
      bestScore = score;
      bestSupplier = fp.supplier;
      bestMatched = matched;
    }
  }

  // Confidence floor — below this we admit we don't know.
  const supplier = bestScore >= 0.4 ? bestSupplier : 'unknown';

  return {
    supplier,
    kind: kindResult.kind,
    confidence: bestScore,
    signals: [
      ...bestMatched.map(m => `supplier: ${m}`),
      ...kindResult.signals.map(s => `kind: ${s}`),
    ],
  };
}
