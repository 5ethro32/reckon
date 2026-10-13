import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canChangeCreditStatus } from '../credit-status';
test('cancelled and resolved claims cannot be reopened',()=>{
 for (const to of ['draft','sent','overdue','resolved'] as const) assert.equal(canChangeCreditStatus('cancelled',to),false);
 for (const to of ['draft','sent','overdue','cancelled'] as const) assert.equal(canChangeCreditStatus('resolved',to),false);
 assert.equal(canChangeCreditStatus('sent','draft'),false);
 assert.equal(canChangeCreditStatus('draft','sent'),true);
 assert.equal(canChangeCreditStatus('overdue','sent'),true);
 assert.equal(canChangeCreditStatus('sent','sent'),true);
});
