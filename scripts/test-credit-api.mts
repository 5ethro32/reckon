import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as creditStatus from '../app/lib/credit-status.ts';
import * as userLib from '../app/lib/supabase/user.ts';
// Execute the actual handler with only HTTP/database boundaries substituted.
const source=readFileSync('app/app/api/credits/[id]/route.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let signedIn=true;
let existing:Record<string,unknown>={id:'claim',status:'draft',external_credit_note_number:null};
let updates:Record<string,unknown>[]=[];
let changedRows:unknown[]=[{id:'claim'}];
const db={auth:{getClaims:async()=>({data:signedIn?{claims:{sub:'user'}}:null,error:null})},from:()=>{
 const chain:Record<string,unknown>={};
 chain.select=()=>chain;chain.eq=()=>chain;chain.maybeSingle=async()=>({data:existing,error:null});
 chain.update=(value:Record<string,unknown>)=>{updates.push(value);const filter:Record<string,unknown>={eq:()=>filter,select:()=>filter,then:(resolve:(v:unknown)=>unknown)=>resolve({data:changedRows,error:null})};return filter;};
 return chain;
}};
const exported:{exports:Record<string,any>}={exports:{}};
const requireMock=(name:string)=>{
 if(name==='next/server')return{NextResponse:{json:(body:unknown,init?:{status?:number})=>new Response(JSON.stringify(body),{status:init?.status??200})}};
 if(name==='@/lib/supabase/server')return{createClient:async()=>db};
 if(name==='@/lib/supabase/user')return (userLib as {default?:unknown}).default ?? userLib;
 if(name==='@/lib/credit-status')return (creditStatus as {default?:unknown}).default ?? creditStatus;
 throw Error(`Unexpected import ${name}`);
};
new Function('require','module','exports',js)(requireMock,exported,exported.exports);
async function patch(body:unknown){updates=[];return exported.exports.PATCH({json:async()=>body},{params:Promise.resolve({id:'claim'})}) as Promise<Response>;}
signedIn=false;assert.equal((await patch({status:'sent'})).status,401);assert.equal(updates.length,0);signedIn=true;
assert.equal((await patch(null)).status,400);assert.equal(updates.length,0);
assert.equal((await patch({status:'resolved',external_credit_note_number:'  '})).status,400);assert.equal(updates.length,0);
assert.equal((await patch({status:'sent'})).status,200);assert.equal(updates[0].sent_by,'user');assert.ok(updates[0].sent_at);
assert.equal((await patch({status:'resolved',external_credit_note_number:' CN-1 '})).status,200);assert.equal(updates[0].external_credit_note_number,'CN-1');
existing={id:'claim',status:'draft',external_credit_note_number:'   '};
assert.equal((await patch({status:'resolved'})).status,400);assert.equal(updates.length,0);
existing={id:'claim',status:'resolved',external_credit_note_number:'CN-1'};
assert.equal((await patch({external_credit_note_number:null})).status,409);assert.equal(updates.length,0);
assert.equal((await patch({external_credit_note_number:'CN-2'})).status,409);assert.equal(updates.length,0);
assert.equal((await patch({status:'sent'})).status,409);assert.equal(updates.length,0);
assert.equal((await patch({notes:'Supplier confirmed receipt'})).status,200);
existing={id:'claim',status:'cancelled',external_credit_note_number:null};
assert.equal((await patch({status:'sent'})).status,409);assert.equal(updates.length,0);
existing={id:'claim',status:'sent',external_credit_note_number:null};
assert.equal((await patch({status:'draft'})).status,409);assert.equal(updates.length,0);
// A claim that moved on after it was read is not cancelled and its lines are not unlinked.
existing={id:'claim',status:'sent',external_credit_note_number:null};changedRows=[];
assert.equal((await patch({status:'cancelled'})).status,409);assert.equal(updates.length,1);changedRows=[{id:'claim'}];
console.log('PASS: actual credit PATCH handler rejects unauthenticated requests, requires resolution evidence, records sent confirmation and preserves resolved evidence/status and blocks reopening cancelled claims.');
