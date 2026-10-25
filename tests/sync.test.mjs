import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SyncEngine} from '../src/sync.mjs';
import {empty,clone,equal} from '../src/model.mjs';
class Memory {constructor(){this.map=new Map()}getItem(k){return this.map.get(k)||null}setItem(k,v){this.map.set(k,v)}}
const task=(id,title=id)=>({id,title,done:false,subtasks:[],noteIds:[]});
function harness(storage=new Memory()) {
 let remote={revision:0,state:empty()},offline=false,afterCommit=null;
 const client={auth:{signOut:async()=>({})},rpc:async(name,args)=>{
   if(offline)throw Error('offline');
   if(name==='cp_read')return {data:clone(remote)};
   if(args.expected_revision!==remote.revision)return {data:{conflict:true}};
   remote={revision:remote.revision+1,state:clone(args.document)};
   if(afterCommit){const cb=afterCommit;afterCommit=null;await cb()}
   return {data:clone(remote)};
 }};
 const engine=new SyncEngine({client,storage,lock:false,readAudio:async()=>null,writeAudio:async()=>{},onState:()=>{},onStatus:()=>{}});
 return {engine,storage,get remote(){return remote},set remote(s){remote=s},set offline(v){offline=v},set afterCommit(v){afterCommit=v}};
}
test('offline changes survive reload and sync; in-flight edits are not lost',async()=>{
 const h=harness();await h.engine.session({user:{id:'a'}});h.offline=true;
 h.engine.save({...empty(),tasks:[task('t')]});await h.engine.sync();assert.match(h.engine.status,/attention/);
 const cached=JSON.parse(h.storage.getItem('commonplace.cloud.v1.a'));assert.equal(cached.state.tasks[0].id,'t');
 const reload=harness(h.storage);await reload.engine.session({user:{id:'a'}});assert.equal(reload.remote.state.tasks[0].id,'t');
 reload.afterCommit=async()=>{const newer=clone(reload.engine.state);newer.tasks[0].title='typed during request';reload.engine.save(newer)};
 const change=clone(reload.engine.state);change.tasks[0].done=true;reload.engine.save(change);await reload.engine.sync();assert.equal(reload.engine.state.tasks[0].title,'typed during request');await reload.engine.sync();assert.equal(reload.remote.state.tasks[0].title,'typed during request');
 h.engine.dispose();reload.engine.dispose();
});
test('two devices merge disjoint edits and pause same-item conflicts',async()=>{
 const h=harness();await h.engine.session({user:{id:'a'}});h.engine.save({...empty(),tasks:[task('a')]});
 h.remote={revision:1,state:{...empty(),tasks:[task('b')]}};await h.engine.sync();assert.equal(h.remote.state.tasks.length,2);
 const local=clone(h.engine.state);local.tasks[0].title='local';h.engine.save(local);
 const remote=clone(h.remote);remote.revision++;remote.state.tasks[0].title='remote';h.remote=remote;
 await h.engine.sync();assert.ok(h.engine.conflict);assert.equal(h.remote.state.tasks[0].title,'remote');
 await h.engine.resolve('local');assert.equal(h.remote.state.tasks[0].title,'local');h.engine.dispose();
});
test('legacy import preserves raw data and retry does not duplicate records',async()=>{
 const h=harness();const legacy={...empty(),tasks:[task('legacy')]};h.storage.setItem('commonplace.v1',JSON.stringify(legacy));
 await h.engine.session({user:{id:'a'}});
 assert.deepEqual(await h.engine.importData(legacy,{legacy:true}),{verified:true});
 assert.deepEqual(await h.engine.importData(legacy,{legacy:true}),{verified:true});assert.equal(h.remote.state.tasks.length,1);
 assert.equal(h.storage.getItem('commonplace.v1'),JSON.stringify(legacy));assert.equal(h.storage.getItem('commonplace.legacy.original'),JSON.stringify(legacy));
 assert.equal(await h.engine.migrationNeeded(),false);h.engine.dispose();
});
test('missing audio aborts migration and never marks it complete',async()=>{
 const h=harness();await h.engine.session({user:{id:'a'}});
 await assert.rejects(()=>h.engine.importData({...empty(),notes:[{id:'n',title:'Voice',audioId:'missing'}]},{legacy:true}),/Missing recording/);
 assert.equal(h.remote.revision,0);assert.equal(h.storage.getItem('commonplace.migrated.a'),null);h.engine.dispose();
});
test('logout hides cloud data and a different account cannot inherit the queue',async()=>{
 const h=harness();await h.engine.session({user:{id:'a'}});h.engine.save({...empty(),tasks:[task('private')]});
 await h.engine.logout();assert.equal(h.engine.state.tasks.length,0);assert.equal(h.engine.writable,false);
 h.remote={revision:0,state:empty()};await h.engine.session({user:{id:'b'}});assert.equal(h.engine.state.tasks.length,0);assert.ok(h.storage.getItem('commonplace.cloud.v1.a').includes('private'));h.engine.dispose();
});
test('audio import uploads immutable object, verifies bytes, survives retry and cross-device download',async()=>{
 const h=harness();const blobs=new Map(),objects=new Map();const blob=new Blob(['recording bytes'],{type:'audio/webm'});blobs.set('legacy:voice',blob);
 h.engine.readAudio=async(id,scope)=>blobs.get(scope+':'+id);
 h.engine.writeAudio=async(id,data,scope)=>blobs.set(scope+':'+id,data);
 h.engine.client.storage={from:()=>({upload:async(path,data)=>{if(objects.has(path))return {error:{statusCode:'409'}};objects.set(path,data);return {}},download:async path=>({data:objects.get(path)})})};
 await h.engine.session({user:{id:'a'}});const legacy={...empty(),notes:[{id:'n',title:'Voice',audioId:'voice'}]};h.storage.setItem('commonplace.v1',JSON.stringify(legacy));
 assert.equal((await h.engine.importData(legacy,{legacy:true})).verified,true);assert.equal((await h.engine.importData(legacy,{legacy:true})).verified,true);assert.equal(objects.size,1);
 blobs.delete('a:voice');assert.equal(await (await h.engine.audio('voice')).text(),'recording bytes');h.engine.dispose();
});
test('storage exhaustion keeps unsaved edits in memory and never reports synced',async()=>{
 const h=harness();await h.engine.session({user:{id:'a'}});h.storage.setItem=()=>{throw Error('quota')};
 assert.throws(()=>h.engine.save({...empty(),tasks:[task('unsaved')]}),/quota/);assert.equal(h.engine.state.tasks[0].id,'unsaved');assert.equal(await h.engine.sync(),false);assert.match(h.engine.status,/NOT SAVED/);await assert.rejects(()=>h.engine.logout(),/Export/);h.engine.dispose();
});
test('an import locks editing while awaiting network and cannot erase a new edit',async()=>{
 const h=harness();await h.engine.session({user:{id:'a'}});let release;const original=h.engine.read.bind(h.engine);h.engine.read=async()=>{h.engine.read=original;await new Promise(r=>release=r);return original()};
 const migration=h.engine.importData({...empty(),tasks:[task('imported')]});await new Promise(r=>setTimeout(r,5));assert.equal(h.engine.writable,false);assert.throws(()=>h.engine.save(empty()),/Wait/);release();await migration;h.engine.dispose();
});
test('malformed legacy data is retained and editing stays blocked',async()=>{
 const h=harness();h.storage.setItem('commonplace.v1','broken JSON');await assert.rejects(()=>h.engine.session(null));assert.equal(h.engine.writable,false);assert.throws(()=>h.engine.save(empty()));assert.equal(h.storage.getItem('commonplace.v1'),'broken JSON');h.engine.dispose();
});
