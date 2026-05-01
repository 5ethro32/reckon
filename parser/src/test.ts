/**
 * Smoke test: run every PDF in test-pdfs/ through the parser and report.
 *
 * Pass criteria per file:
 *   1. Supplier detected with confidence >= 0.4
 *   2. Document kind detected
 *   3. Parser produced a structured document
 *   4. document.totalsMatch === true (line totals reconcile to printed totals)
 *
 * Failures are loud and the process exits non-zero so this can run in CI.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePdf } from './index.js';
import type { ParsedInvoice, ParsedStatement } from './types/index.js';

const TEST_DIR = join(process.cwd(), 'test-pdfs');

interface TestResult {
  file: string;
  ok: boolean;
  reasons: string[];
  details: {
    supplier: string;
    kind: string;
    confidence: string;
    invoiceNumber?: string;
    statementDate?: string;
    lineCount?: number;
    rowCount?: number;
    grossTotal?: string;
    statementTotal?: string;
    totalsMatch?: boolean;
  };
}

async function runOne(filePath: string): Promise<TestResult> {
  const buffer = await readFile(filePath);
  const result = await parsePdf(buffer);
  const reasons: string[] = [];

  if (result.detection.supplier === 'unknown') reasons.push('supplier not detected');
  if (result.detection.kind === 'unknown') reasons.push('kind not detected');
  if (result.detection.confidence < 0.4) reasons.push(`confidence ${result.detection.confidence.toFixed(2)} below floor`);
  if (result.errors.length > 0) reasons.push(`errors: ${result.errors.join('; ')}`);
  if (!result.document) reasons.push('no document produced');

  const details: TestResult['details'] = {
    supplier: result.detection.supplier,
    kind: result.detection.kind,
    confidence: result.detection.confidence.toFixed(2),
  };

  if (result.document?.kind === 'invoice') {
    const inv = result.document as ParsedInvoice;
    details.invoiceNumber = inv.invoiceNumber || '(missing)';
    details.lineCount = inv.lines.length;
    details.grossTotal = `£${inv.grossTotal.toFixed(2)}`;
    details.totalsMatch = inv.totalsMatch;
    if (!inv.totalsMatch) reasons.push('totals mismatch');
    if (inv.lines.length === 0) reasons.push('zero line items');
    if (!inv.invoiceNumber) reasons.push('invoice number missing');
  } else if (result.document?.kind === 'statement') {
    const stmt = result.document as ParsedStatement;
    details.statementDate = stmt.statementDate || '(missing)';
    details.rowCount = stmt.rows.length;
    details.statementTotal = `£${stmt.totals.total.toFixed(2)}`;
    details.totalsMatch = stmt.totalsMatch;
    if (!stmt.totalsMatch) reasons.push('totals mismatch');
    if (stmt.rows.length === 0) reasons.push('zero rows');
  }

  return {
    file: filePath.split(/[\\/]/).pop() ?? filePath,
    ok: reasons.length === 0,
    reasons,
    details,
  };
}

async function main() {
  let entries: string[];
  try {
    entries = await readdir(TEST_DIR);
  } catch {
    console.error(`Could not read test-pdfs/ directory at ${TEST_DIR}`);
    process.exit(1);
  }

  const pdfFiles = entries.filter(f => f.toLowerCase().endsWith('.pdf')).sort();
  if (pdfFiles.length === 0) {
    console.error('No PDFs found in test-pdfs/');
    process.exit(1);
  }

  console.log('━'.repeat(78));
  console.log(`  RECKON PARSER — smoke test (${pdfFiles.length} files)`);
  console.log('━'.repeat(78));

  const results: TestResult[] = [];
  for (const file of pdfFiles) {
    const r = await runOne(join(TEST_DIR, file));
    results.push(r);

    const status = r.ok ? '✓ PASS' : '✗ FAIL';
    console.log('');
    console.log(`  ${status}  ${r.file}`);
    console.log(`         supplier=${r.details.supplier} kind=${r.details.kind} confidence=${r.details.confidence}`);
    if (r.details.invoiceNumber !== undefined) {
      console.log(`         invoice=${r.details.invoiceNumber} lines=${r.details.lineCount} gross=${r.details.grossTotal} totalsMatch=${r.details.totalsMatch}`);
    }
    if (r.details.statementDate !== undefined) {
      console.log(`         statement=${r.details.statementDate} rows=${r.details.rowCount} total=${r.details.statementTotal} totalsMatch=${r.details.totalsMatch}`);
    }
    if (!r.ok) {
      r.reasons.forEach(reason => console.log(`         ⚠ ${reason}`));
    }
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log('');
  console.log('━'.repeat(78));
  console.log(`  ${passed} passed, ${failed} failed of ${results.length}`);
  console.log('━'.repeat(78));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
