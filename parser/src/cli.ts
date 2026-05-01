/**
 * CLI: parse a PDF file and print structured JSON.
 *
 * Usage:
 *   npm run parse -- path/to/file.pdf
 *   npm run parse -- path/to/file.pdf --raw    (also dump raw text)
 *   npm run parse -- path/to/file.pdf --pretty (human-readable output)
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parsePdf } from './index.js';
import type { ParsedInvoice, ParsedStatement } from './types/index.js';

function printUsage() {
  console.error('Usage: npm run parse -- <file.pdf> [--raw] [--pretty]');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) printUsage();

  const filePath = args.find(a => !a.startsWith('--'));
  if (!filePath) printUsage();

  const showRaw = args.includes('--raw');
  const pretty = args.includes('--pretty');

  const absPath = resolve(filePath!);
  const buffer = await readFile(absPath);

  const result = await parsePdf(buffer);

  if (pretty) {
    printPretty(result, showRaw);
  } else {
    // Default: structured JSON for piping into other tools
    const out = {
      detection: result.detection,
      document: result.document,
      errors: result.errors,
      ...(showRaw ? { rawText: result.rawText } : {}),
    };
    console.log(JSON.stringify(out, null, 2));
  }

  // Exit non-zero if there were any errors or totals don't match
  if (result.errors.length > 0) process.exit(2);
  if (result.document && 'totalsMatch' in result.document && !result.document.totalsMatch) {
    process.exit(3);
  }
}

function fmt(n: number): string {
  return `£${n.toFixed(2)}`;
}

function printPretty(result: Awaited<ReturnType<typeof parsePdf>>, showRaw: boolean) {
  const { detection, document, errors, rawText } = result;

  console.log('━'.repeat(72));
  console.log('  RECKON PARSER');
  console.log('━'.repeat(72));
  console.log(`  Supplier:    ${detection.supplier}`);
  console.log(`  Kind:        ${detection.kind}`);
  console.log(`  Confidence:  ${(detection.confidence * 100).toFixed(0)}%`);
  if (detection.signals.length) {
    console.log('  Signals:');
    detection.signals.forEach(s => console.log(`    · ${s}`));
  }

  if (errors.length > 0) {
    console.log('');
    console.log('  ERRORS:');
    errors.forEach(e => console.log(`    ! ${e}`));
  }

  if (document) {
    console.log('');
    console.log('━'.repeat(72));
    if (document.kind === 'invoice') {
      printInvoice(document);
    } else {
      printStatement(document);
    }
  }

  if (showRaw && rawText) {
    console.log('');
    console.log('━'.repeat(72));
    console.log('  RAW TEXT (first 1500 chars)');
    console.log('━'.repeat(72));
    console.log(rawText.slice(0, 1500));
  }

  console.log('━'.repeat(72));
}

function printInvoice(inv: ParsedInvoice) {
  console.log(`  INVOICE  ${inv.invoiceNumber}`);
  console.log('━'.repeat(72));
  console.log(`  Date:        ${inv.invoiceDate}`);
  if (inv.dueDate) console.log(`  Due:         ${inv.dueDate}`);
  if (inv.poNumber) console.log(`  PO:          ${inv.poNumber}`);
  if (inv.customerAccount) console.log(`  Account:     ${inv.customerAccount}`);
  if (inv.customerName) console.log(`  Customer:    ${inv.customerName}`);
  console.log('');
  console.log(`  Lines:       ${inv.lines.length}`);
  console.log(`  Net:         ${fmt(inv.netTotal)}`);
  console.log(`  VAT:         ${fmt(inv.vatTotal)}`);
  console.log(`  Gross:       ${fmt(inv.grossTotal)}`);
  console.log(`  Totals OK:   ${inv.totalsMatch ? '✓' : '✗ MISMATCH'}`);

  if (inv.warnings.length) {
    console.log('');
    console.log('  Warnings:');
    inv.warnings.forEach(w => console.log(`    ⚠ ${w}`));
  }

  console.log('');
  console.log('  ' + 'SKU'.padEnd(12) + 'Pack'.padEnd(8) + 'Description'.padEnd(38) + 'Qty'.padStart(4) + ' ' + 'Net'.padStart(8) + ' ' + 'Gross'.padStart(8));
  console.log('  ' + '─'.repeat(70));
  for (const l of inv.lines) {
    const desc = l.description.length > 36 ? l.description.slice(0, 35) + '…' : l.description;
    console.log(
      '  ' +
      l.supplierSku.padEnd(12) +
      l.packSize.padEnd(8) +
      desc.padEnd(38) +
      String(l.qty).padStart(4) + ' ' +
      l.net.toFixed(2).padStart(8) + ' ' +
      l.gross.toFixed(2).padStart(8)
    );
  }
}

function printStatement(stmt: ParsedStatement) {
  console.log(`  STATEMENT  ${stmt.statementDate}`);
  console.log('━'.repeat(72));
  if (stmt.customerAccount) console.log(`  Account:     ${stmt.customerAccount}`);
  if (stmt.customerName)    console.log(`  Customer:    ${stmt.customerName}`);
  console.log('');
  console.log(`  Rows:        ${stmt.rows.length}`);
  console.log(`  Net:         ${fmt(stmt.totals.net)}`);
  console.log(`  VAT:         ${fmt(stmt.totals.vat)}`);
  console.log(`  Total:       ${fmt(stmt.totals.total)}`);
  console.log(`  Totals OK:   ${stmt.totalsMatch ? '✓' : '✗ MISMATCH'}`);

  if (stmt.warnings.length) {
    console.log('');
    console.log('  Warnings:');
    stmt.warnings.forEach(w => console.log(`    ⚠ ${w}`));
  }

  console.log('');
  console.log('  ' + 'Date'.padEnd(12) + 'Document'.padEnd(14) + 'Type'.padEnd(6) + 'Ref'.padEnd(14) + 'Total'.padStart(10));
  console.log('  ' + '─'.repeat(60));
  for (const r of stmt.rows) {
    console.log(
      '  ' +
      r.date.padEnd(12) +
      r.documentNumber.padEnd(14) +
      r.documentType.padEnd(6) +
      (r.reference ?? '—').padEnd(14) +
      r.total.toFixed(2).padStart(10)
    );
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
