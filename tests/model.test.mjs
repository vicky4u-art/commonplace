import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,clone,normalize,equal,merge,importInto} from '../src/model.mjs';
const task=(id,title=id)=>({id,title,done:false,subtasks:[],noteIds:[]});
test('stable ID migration is additive and idempotent; different existing IDs require consent',()=>{
 const data=empty();data.tasks=[task('old')];const cloud=empty();cloud.tasks=[task('cloud')];
 const imported=importInto(cloud,data);assert.equal(imported.state.tasks.length,2);
 assert.equal(importInto(imported.state,data).conflicts.length,0);
 data.tasks[0].title='changed';const retry=importInto(imported.state,data);assert.equal(retry.conflicts.length,1);assert.equal(retry.state.tasks.find(x=>x.id==='old').title,'old');
 assert.equal(importInto(imported.state,data,true).state.tasks.find(x=>x.id==='old').title,'changed');
});
test('disjoint concurrent edits merge, same item and delete/edit conflict',()=>{
 const base=normalize({...empty(),tasks:[task('a'),task('b')]});const local=clone(base),remote=clone(base);
 local.tasks[0].title='local';remote.tasks[1].title='remote';let result=merge(base,local,remote);assert.equal(result.conflicts.length,0);assert.deepEqual(result.state.tasks.map(x=>x.title),['local','remote']);
 remote.tasks[0].title='cloud';assert.equal(merge(base,local,remote).conflicts.length,1);
 local.tasks=[];assert.equal(merge(base,local,remote).conflicts.length,2);
});
test('project deletion vs concurrent child creation is a relationship conflict',()=>{
 const base={...empty(),projects:[{id:'p'}]};const local=empty();const remote=clone(base);remote.tasks=[{...task('a'),projectId:'p'}];
 assert.equal(merge(base,local,remote).conflicts[0].collection,'relationships');
});
test('rich text, completion, order, old IDs and timestamps survive normalization',()=>{
 const s={...empty(),projects:[{id:'legacy-p',name:'Learn'}],notes:[{id:'n',content:'<h2>Notes</h2><ul class="checklist"><li data-done="true">Done</li></ul>',projectId:'legacy-p'}],tasks:[{...task('legacy-t'),noteIds:['n'],projectId:'legacy-p',subtasks:[{id:'s2',done:true,text:'Two'},{id:'s1',done:false,text:'One'}],createdAt:'2025-01-01'}]};
 assert.ok(equal(normalize(s),s));assert.throws(()=>normalize({...s,tasks:[task('a'),task('a')]}),/duplicate/);
});
