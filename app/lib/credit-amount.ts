export interface CreditLine { flags: string[]; qtyOrdered: number; qtyReceived: number | null; qtyReturned: number | null }
/** The affected share of a line as an exact ratio (affected units / ordered units). */
export interface CreditShare { num: number; den: number }

/** Whole-line values are prorated only for explicit shortage/return quantities. */
export function creditShare(line: CreditLine): CreditShare {
 const { flags, qtyOrdered, qtyReceived, qtyReturned } = line;
 if (!Number.isSafeInteger(qtyOrdered) || qtyOrdered <= 0) throw Error('A positive invoice quantity is required for a credit');
 if (flags.includes('not_received') || flags.includes('damaged')) return { num: 1, den: 1 };
 if (flags.includes('short')) {
  if (qtyReceived === null || !Number.isSafeInteger(qtyReceived) || qtyReceived < 0 || qtyReceived >= qtyOrdered) throw Error('Confirm the quantity received before requesting a shortage credit');
  return { num: qtyOrdered - qtyReceived, den: qtyOrdered };
 }
 if (flags.includes('returned')) {
  if (qtyReturned === null || !Number.isSafeInteger(qtyReturned) || qtyReturned <= 0 || qtyReturned > qtyOrdered) throw Error('Confirm the quantity returned before requesting a credit');
  return { num: qtyReturned, den: qtyOrdered };
 }
 throw Error('Choose a supported credit reason');
}
export function creditFraction(line: CreditLine): number {
 const { num, den } = creditShare(line);
 return num / den;
}
/**
 * Credit amount in whole pence, rounded half up. This must equal Postgres
 * round(gross * num / den, 2) in expected_credit_gross (migration 0010):
 * claim creation (0012) rejects any total that differs by a penny, so the
 * calculation is done on integers rather than floating-point pounds.
 */
export function creditPence(value: number, share: CreditShare): number {
 if (!Number.isFinite(value) || value < 0) throw Error('Invalid invoice value');
 const { num, den } = share;
 if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num < 0 || den <= 0) throw Error('Invalid credit share');
 const pence = Math.round(value * 100);
 const numerator = 2 * pence * num + den, denominator = 2 * den;
 if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) throw Error('Credit value is too large');
 // Exact integer floor division: % and - are exact for safe integers, so the quotient is too.
 return (numerator - (numerator % denominator)) / denominator;
}
export function creditValue(value: number, share: CreditShare): number {
 return creditPence(value, share) / 100;
}
