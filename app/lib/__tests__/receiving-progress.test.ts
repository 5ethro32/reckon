import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryFacts, lineState, linesToTick, receivingProgress, type ProgressLine } from '../receiving-progress';

const line = (id: string, qty_ordered: number, qty_received: number | null, flags: string[] = [], extra: Partial<ProgressLine> = {}): ProgressLine =>
  ({ id, qty_ordered, qty_received, flags, gross: 10, ...extra });

test('line states follow the invoiced quantity and problem flags', () => {
  assert.equal(lineState(line('a', 3, null)), 'pending');
  assert.equal(lineState(line('a', 3, 2)), 'partial');
  assert.equal(lineState(line('a', 3, 3)), 'full');
  assert.equal(lineState(line('a', 3, 1, ['short'])), 'short');
  assert.equal(lineState(line('a', 3, 3, ['damaged'])), 'damaged');
  assert.equal(lineState(line('a', 3, 0, ['not_received'])), 'none');
});

test('a delivery with lines still to check is checking, whatever else is recorded', () => {
  const p = receivingProgress([line('a', 2, 2), line('b', 3, null), line('c', 1, 0, ['not_received'])]);
  assert.equal(p.stage, 'checking');
  assert.equal(p.checked, 2);
  assert.equal(p.pending, 1);
  assert.equal(p.packs, 6);
  assert.equal(p.packsReceived, 2);
});

test('every line in full is complete, with nothing to claim', () => {
  const p = receivingProgress([line('a', 2, 2), line('b', 3, 3)]);
  assert.equal(p.stage, 'complete');
  assert.deepEqual(p.claimLineIds, []);
  assert.equal(p.claimRaised, false);
});

test('part-received lines make the delivery short and are claimed as short', () => {
  const p = receivingProgress([line('a', 2, 2), line('b', 3, 1), line('c', 4, 4, ['damaged'])]);
  assert.equal(p.stage, 'short');
  assert.deepEqual(p.claimLineIds, ['b', 'c']);
  assert.deepEqual(p.partialLineIds, ['b']);
  assert.equal(p.shortLines, 1);
  assert.equal(p.claimValue, 20);
  assert.equal(p.claimRaised, false);
});

test('lines already credited on a statement are not claimed again', () => {
  const p = receivingProgress([line('a', 2, 1, ['short'], { credited_via_statement_line_id: 's1' }), line('b', 1, 0, ['short'], { credit_request_id: 'c1' })]);
  assert.deepEqual(p.claimLineIds, ['b']);
  assert.equal(p.claimRaised, true);
});

test('tick all received covers unchecked and part-scanned lines, never problems', () => {
  assert.deepEqual(linesToTick([line('a', 2, null), line('b', 3, 1), line('c', 1, 1), line('d', 2, 0, ['short'])]), ['a', 'b']);
});

test('delivery facts read as one line', () => {
  assert.equal(deliveryFacts('2026-10-19', 42, 91), '19 Oct · 42 lines · 91 packs');
  assert.equal(deliveryFacts('2026-09-01', 1, 1), '1 Sep · 1 line · 1 pack');
});
