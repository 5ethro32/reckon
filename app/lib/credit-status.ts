export const CREDIT_STATUSES = ['draft', 'sent', 'resolved', 'overdue', 'cancelled'] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];
/**
 * Allowed claim status changes. Cancelling unlinks the claim's invoice lines so they can be
 * chased again, so a cancelled claim must never come back to life; resolved claims are final.
 */
const NEXT: Record<CreditStatus, readonly CreditStatus[]> = {
  draft: ['sent', 'resolved', 'cancelled'],
  sent: ['overdue', 'resolved', 'cancelled'],
  overdue: ['sent', 'resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
};
export function canChangeCreditStatus(from: CreditStatus, to: CreditStatus): boolean {
  return from === to || NEXT[from].includes(to);
}
