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

import { detect } from './detect.js';
import type { ParsedDocument, DetectionResult } from './types/index.js';
import { parseAahInvoice } from './parsers/aah-invoice.js';
import { parseAahStatement } from './parsers/aah-statement.js';
import { parseAverInvoice } from './parsers/aver-invoice.js';

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

  if (!text.trim()) {
    errors.push('PDF contained no extractable text — likely a scanned image. Vision OCR fallback not yet implemented.');
    return {
      detection: { supplier: 'unknown', kind: 'unknown', confidence: 0, signals: [] },
      rawText: '',
      document: null,
      errors,
    };
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
  } else {
    errors.push(
      `No parser yet for ${detection.supplier}/${detection.kind}. ` +
      `Confidence: ${(detection.confidence * 100).toFixed(0)}%`
    );
  }

  return { detection, rawText: text, document, errors };
}

// Re-export key types for consumers
export type * from './types/index.js';
export { detect } from './detect.js';
