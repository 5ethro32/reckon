import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creditFraction,creditValue} from '../credit-amount';
test('short and returned claims request only the affected packs',()=>{
 const base={flags:['short'],qtyOrdered:10,qtyReceived:9,qtyReturned:null};
 assert.equal(creditValue(100,creditFraction(base)),10);
 assert.equal(creditValue(120,creditFraction({...base,flags:['returned'],qtyReturned:2})),24);
 assert.equal(creditValue(120,creditFraction({...base,flags:['not_received']})),120);
 assert.throws(()=>creditFraction({...base,qtyReceived:null}));
 assert.throws(()=>creditFraction({...base,qtyReceived:11}));
 assert.throws(()=>creditFraction({...base,flags:['returned'],qtyReturned:null}));
});
