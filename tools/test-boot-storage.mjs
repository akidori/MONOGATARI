import assert from 'node:assert/strict';
import {readBootJSON,bootRecord,bootIndex,bootProject} from '../src/boot-storage.js';
let assertions=0;
const ok=(x)=>{assert.ok(x);assertions++};
const result=(value)=>({get:async()=>({value})});
for(const value of ['null','{}','[null]','[{"id":""}]','[{"id":"a"},{"id":"a"}]','{']) {
 await assert.rejects(()=>readBootJSON(result(value),'index',bootIndex,true));assertions++;
}
assert.deepEqual(await readBootJSON(result('[]'),'index',bootIndex,true),[]);assertions++;
const absent={get:async()=>{throw Error('nf')}};
assert.equal(await readBootJSON(absent,'index',bootIndex,true),null);assertions++;
await assert.rejects(()=>readBootJSON(absent,'project',bootProject));assertions++;
for(const code of [401,403,404,503]) {
 const failure=Object.assign(Error('network'),{code});
 await assert.rejects(()=>readBootJSON({get:async()=>{throw failure}},'index',bootIndex,true),e=>e===failure);assertions++;
}
for(const value of [null,{},[],false,'oops']) {await assert.rejects(()=>readBootJSON({get:async()=>value},'index',bootIndex,true));assertions++;}
ok(bootProject({id:'old',customLegacyField:{anything:true}}));
ok(!bootProject({rows:{}}));ok(!bootProject({plans:null}));ok(!bootRecord([]));
const old={rows:[],customLegacyField:{anything:true}};
assert.deepEqual(await readBootJSON(result(JSON.stringify(old)),'legacy',bootProject),old);assertions++;
console.log(`PASS ${assertions} boot storage assertions`);
