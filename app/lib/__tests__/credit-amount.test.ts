import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creditFraction,creditShare,creditValue,creditPence} from '../credit-amount';
test('short and returned claims request only the affected packs',()=>{
 const base={flags:['short'],qtyOrdered:10,qtyReceived:9,qtyReturned:null};
 assert.equal(creditValue(100,creditShare(base)),10);
 assert.equal(creditValue(120,creditShare({...base,flags:['returned'],qtyReturned:2})),24);
 assert.equal(creditValue(120,creditShare({...base,flags:['not_received']})),120);
 assert.throws(()=>creditFraction({...base,qtyReceived:null}));
 assert.throws(()=>creditFraction({...base,qtyReceived:11}));
 assert.throws(()=>creditFraction({...base,flags:['returned'],qtyReturned:null}));
});
test('partial credits round like Postgres numeric round(x, 2)',()=>{
 // Previously computed in floating point: 5.01 and 7.57, which the claim RPC rejected.
 assert.equal(creditValue(10.03,creditShare({flags:['short'],qtyOrdered:2,qtyReceived:1,qtyReturned:null})),5.02);
 assert.equal(creditValue(10.10,creditShare({flags:['short'],qtyOrdered:4,qtyReceived:1,qtyReturned:null})),7.58);
 // Exhaustive check against exact decimal arithmetic for small invoices.
 for (let pence=0;pence<=3000;pence+=7) for (let den=1;den<=12;den++) for (let num=1;num<=den;num++) {
  const exact=Math.floor((2*pence*num+den)/(2*den)); // half-up on integers, as numeric round does for x >= 0
  assert.equal(creditPence(pence/100,{num,den}),exact,`${pence}p x ${num}/${den}`);
 }
});
