const {test}=require('node:test');
const assert=require('node:assert/strict');
const {initialize}=require('../js/simulator-startup.js');
test('included data is seeded before storage finishes opening',async()=>{
 const events=[];let release;
 const opening=new Promise(r=>release=r);
 const done=initialize({seed:()=>events.push('seed'),open:()=>opening,latest:async()=>null,restore:()=>{},save:()=>events.push('save'),revision:()=>0,onError:()=>{}});
 assert.deepEqual(events,['seed']);release();await done;assert.deepEqual(events,['seed','save']);
});
test('existing saved study takes precedence after storage opens',async()=>{
 const events=[];await initialize({seed:()=>events.push('seed'),open:async()=>{},latest:async()=>({id:'saved'}),restore:s=>events.push(s.id),save:()=>events.push('save'),revision:()=>0,onError:()=>{}});assert.deepEqual(events,['seed','saved']);
});
test('late restore does not overwrite edits made while storage opens',async()=>{
 let revision=0,release,restored=false;const opening=new Promise(r=>release=r);
 const done=initialize({seed:()=>{},open:()=>opening,latest:async()=>({}),restore:()=>restored=true,save:()=>{},revision:()=>revision,onError:()=>{}});
 revision++;release();await done;assert.equal(restored,false);
});
test('storage failure preserves the seeded dataset and reports the problem',async()=>{
 let seeded=false,error='';await initialize({seed:()=>seeded=true,open:async()=>{throw Error('blocked');},latest:async()=>null,restore:()=>{},save:()=>{},revision:()=>0,onError:e=>error=e.message});assert.equal(seeded,true);assert.equal(error,'blocked');
});
