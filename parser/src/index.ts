/**
 * Public entry point for @reckon/parser.
 *
 * `parsePdf(buffer)` is the high-level call that:
 *   1. Extracts text from a PDF buffer
 *   2. Detects supplier + document kind from the text
 *   3. Routes to the right specialised parser
 *   4. Returns a normalised ParsedDocument
 */

// pdf-parse is a CommonJS module. Default-import then call as a function.
import pdf from 'pdf-parse';

import { detect } from './detect';
import { extractTextWithOcr } from './ocr';
import type { ParsedDocument, DetectionResult } from './types/index';
import { parseAahInvoice } from './parsers/aah-invoice';
import { parseAahStatement } from './parsers/aah-statement';
import { parseAverInvoice } from './parsers/aver-invoice';
import { parseAverStatement } from './parsers/aver-statement';

/** Threshold below which we assume pdf-parse failed to find an embedded
 * text layer (i.e. PDF is image-only) and fall back to OCR. 50 chars is
 * generous — even a near-blank PDF with just a logo and page number tends
 * to have less than this. */
const OCR_FALLBACK_CHAR_THRESHOLD = 50;

export interface ParseResult {
  detection: DetectionResult;
  /** Raw extracted text — useful for debugging. Truncated to first 2000 chars in CLI output. */
  rawText: string;
  /** The parsed structured document, or null if parsing failed. */
  document: ParsedDocument | null;
  /** Top-level errors (PDF couldn't be read, no parser available, etc.). */
  errors: string[];
}

export async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  const errors: string[] = [];

  // Step 1: Extract raw text
  let text = '';
  try {
    const result = await pdf(buffer);
    text = result.text;
  } catch (err) {
    errors.push(`PDF text extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return {
      detection: { supplier: 'unknown', kind: 'unknown', confidence: 0, signals: [] },
      rawText: '',
      document: null,
      errors,
    };
  }

  // Tier 2: if pdf-parse returned (almost) nothing, the PDF is likely a
  // scan with no embedded text layer. Fall back to OCR.
  if (text.trim().length < OCR_FALLBACK_CHAR_THRESHOLD) {
    try {
      text = await extractTextWithOcr(buffer);
    } catch (err) {
      errors.push(
        `OCR fallback failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return {
        detection: { supplier: 'unknown', kind: 'unknown', confidence: 0, signals: [] },
        rawText: '',
        document: null,
        errors,
      };
    }

    if (!text.trim()) {
      errors.push('Both pdf-parse and OCR returned empty text — PDF may be blank or unreadable.');
      return {
        detection: { supplier: 'unknown', kind: 'unknown', confidence: 0, signals: [] },
        rawText: '',
        document: null,
        errors,
      };
    }
  }

  // Step 2: Detect supplier + kind
  const detection = detect(text);

  // Step 3: Route to the right parser
  let document: ParsedDocument | null = null;

  if (detection.supplier === 'aah' && detection.kind === 'invoice') {
    document = parseAahInvoice(text);
  } else if (detection.supplier === 'aah' && detection.kind === 'statement') {
    document = parseAahStatement(text);
  } else if (detection.supplier === 'aver' && detection.kind === 'invoice') {
    document = parseAverInvoice(text);
  } else if (detection.supplier === 'aver' && detection.kind === 'statement') {
    document = parseAverStatement(text);
  } else {
    errors.push(
      `No parser yet for ${detection.supplier}/${detection.kind}. ` +
      `Confidence: ${(detection.confidence * 100).toFixed(0)}%`
    );
  }

  return { detection, rawText: text, document, errors };
}

// Re-export key types for consumers
export type * from './types/index';
export { detect } from './detect';
