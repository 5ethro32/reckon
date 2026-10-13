import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
// Execute the actual handler with only HTTP/database boundaries substituted.
const source=readFileSync('app/app/api/credits/[id]/route.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let signedIn=true;
let existing:Record<string,unknown>={id:'claim',status:'draft',external_credit_note_number:null};
let updates:Record<string,unknown>[]=[];
const db={auth:{getUser:async()=>({data:{user:signedIn?{id:'user'}:null}})},from:()=>{
 const chain:Record<string,unknown>={};
 chain.select=()=>chain;chain.eq=()=>chain;chain.maybeSingle=async()=>({data:existing,error:null});
 chain.update=(value:Record<string,unknown>)=>{updates.push(value);return {eq:async()=>({error:null})};};
 return chain;
}};
const exported:{exports:Record<string,any>}={exports:{}};
const requireMock=(name:string)=>{
 if(name==='next/server')return{NextResponse:{json:(body:unknown,init?:{status?:number})=>new Response(JSON.stringify(body),{status:init?.status??200})}};
 if(name==='@/lib/supabase/server')return{createClient:async()=>db};
 throw Error(`Unexpected import ${name}`);
};
new Function('require','module','exports',js)(requireMock,exported,exported.exports);
async function patch(body:unknown){updates=[];return exported.exports.PATCH({json:async()=>body},{params:Promise.resolve({id:'claim'})}) as Promise<Response>;}
signedIn=false;assert.equal((await patch({status:'sent'})).status,401);assert.equal(updates.length,0);signedIn=true;
assert.equal((await patch({status:'resolved',external_credit_note_number:'  '})).status,400);assert.equal(updates.length,0);
assert.equal((await patch({status:'sent'})).status,200);assert.equal(updates[0].sent_by,'user');assert.ok(updates[0].sent_at);
assert.equal((await patch({status:'resolved',external_credit_note_number:' CN-1 '})).status,200);assert.equal(updates[0].external_credit_note_number,'CN-1');
existing={id:'claim',status:'resolved',external_credit_note_number:'CN-1'};
assert.equal((await patch({external_credit_note_number:null})).status,409);assert.equal(updates.length,0);
assert.equal((await patch({external_credit_note_number:'CN-2'})).status,409);assert.equal(updates.length,0);
assert.equal((await patch({status:'sent'})).status,409);assert.equal(updates.length,0);
assert.equal((await patch({notes:'Supplier confirmed receipt'})).status,200);
console.log('PASS: actual credit PATCH handler rejects unauthenticated requests, requires resolution evidence, records sent confirmation and preserves resolved evidence/status.');
