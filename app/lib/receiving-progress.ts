/**
 * Where checking a delivery has got to, from its invoice lines.
 *
 * qty_ordered is the quantity on the invoice (supplied and charged); the
 * screens call it "invoiced". A line is:
 *   pending   nothing recorded yet (qty_received is null, no problem flag)
 *   partial   some packs scanned, fewer than invoiced, no problem flag
 *   full      every invoiced pack received, no problem flag
 *   short / damaged / returned / none   a problem recorded on the line
 *
 * The same rules as the Home overview and invoice_receipt_summary: a delivery
 * is still to check while any line is pending.
 */

export type LineState = 'pending' | 'partial' | 'full' | 'short' | 'damaged' | 'returned' | 'none';

export type ProgressLine = {
  id: string;
  qty_ordered: number;
  qty_received: number | null;
  flags: string[];
  gross?: number | string;
  credit_request_id?: string | null;
  credited_via_statement_line_id?: string | null;
};

export function lineState(line: Pick<ProgressLine, 'qty_ordered' | 'qty_received' | 'flags'>): LineState {
  if (line.flags.includes('not_received')) return 'none';
  if (line.flags.includes('returned')) return 'returned';
  if (line.flags.includes('damaged')) return 'damaged';
  if (line.flags.includes('short')) return 'short';
  if (line.qty_received === null) return 'pending';
  if (line.qty_received !== line.qty_ordered) return 'partial';
  return 'full';
}

/**
 * checking  lines still to check (or none read)
 * complete  every line received in full
 * short     every line checked, some short, damaged, returned or part received
 */
export type Stage = 'empty' | 'checking' | 'complete' | 'short';

export type Progress = {
  stage: Stage;
  lines: number;
  /** Lines with something recorded: received in full or a problem. Part-scanned lines are still being checked. */
  checked: number;
  pending: number;
  partial: number;
  full: number;
  problems: number;
  packs: number;
  packsReceived: number;
  /** Lines a claim would cover: problems and part-received lines, less any already credited on a statement. */
  claimLineIds: string[];
  /** Part-received lines to record as short before a claim. */
  partialLineIds: string[];
  claimValue: number;
  /** Every line to claim is already on a claim. */
  claimRaised: boolean;
  /** Short counts: short, part received and not received lines. */
  shortLines: number;
};

export function receivingProgress(lines: ProgressLine[]): Progress {
  let pending = 0, partial = 0, full = 0, problems = 0, shortLines = 0, packs = 0, packsReceived = 0, claimValue = 0;
  const claimLineIds: string[] = [];
  const partialLineIds: string[] = [];
  let claimRaised = true;
  for (const line of lines) {
    const state = lineState(line);
    packs += line.qty_ordered;
    packsReceived += Math.min(line.qty_ordered, line.qty_received ?? 0);
    if (state === 'pending') { pending++; continue; }
    if (state === 'full') { full++; continue; }
    if (state === 'partial') { partial++; partialLineIds.push(line.id); } else problems++;
    if (state === 'partial' || state === 'short' || state === 'none') shortLines++;
    if (line.credited_via_statement_line_id) continue;
    claimLineIds.push(line.id);
    claimValue += Number(line.gross ?? 0);
    if (state === 'partial' || !line.credit_request_id) claimRaised = false;
  }
  const stage: Stage = lines.length === 0 ? 'empty'
    : pending > 0 ? 'checking'
    : partial === 0 && problems === 0 ? 'complete'
    : 'short';
  return {
    stage, lines: lines.length, checked: full + problems, pending, partial, full, problems,
    packs, packsReceived, claimLineIds, partialLineIds,
    claimValue: Math.round(claimValue * 100) / 100,
    claimRaised: claimLineIds.length > 0 && claimRaised,
    shortLines,
  };
}

/** Lines "Tick all received" marks in full: everything not yet checked, part-scanned lines included. Problems are left alone. */
export function linesToTick(lines: ProgressLine[]): string[] {
  return lines.filter(l => { const s = lineState(l); return s === 'pending' || s === 'partial'; }).map(l => l.id);
}

/** "19 Oct · 42 lines · 91 packs": what a delivery is, in one line. */
export function deliveryFacts(date: string, lines: number, packs: number): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date + 'T12:00:00Z' : date)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).replace('Sept', 'Sep');
  return `${d} · ${lines} ${lines === 1 ? 'line' : 'lines'} · ${packs} ${packs === 1 ? 'pack' : 'packs'}`;
}
