/** Whole-line values are prorated only for explicit shortage/return quantities. */
export function creditFraction(line: { flags: string[]; qtyOrdered: number; qtyReceived: number | null; qtyReturned: number | null }): number {
 const { flags, qtyOrdered, qtyReceived, qtyReturned } = line;
 if (!Number.isSafeInteger(qtyOrdered) || qtyOrdered <= 0) throw Error('A positive invoice quantity is required for a credit');
 if (flags.includes('not_received') || flags.includes('damaged')) return 1;
 if (flags.includes('short')) {
  if (qtyReceived === null || !Number.isSafeInteger(qtyReceived) || qtyReceived < 0 || qtyReceived >= qtyOrdered) throw Error('Confirm the quantity received before requesting a shortage credit');
  return (qtyOrdered - qtyReceived) / qtyOrdered;
 }
 if (flags.includes('returned')) {
  if (qtyReturned === null || !Number.isSafeInteger(qtyReturned) || qtyReturned <= 0 || qtyReturned > qtyOrdered) throw Error('Confirm the quantity returned before requesting a credit');
  return qtyReturned / qtyOrdered;
 }
 throw Error('Choose a supported credit reason');
}
export function creditValue(value: number, fraction: number): number {
 if (!Number.isFinite(value) || value < 0) throw Error('Invalid invoice value');
 return Math.round((value * fraction + Number.EPSILON) * 100) / 100;
}
