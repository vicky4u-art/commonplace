import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {SyncEngine} from '../src/sync.mjs';
import {empty,clone} from '../src/model.mjs';
const tick=()=>new Promise(r=>setTimeout(r,20));
test('original UI: project/task/subtask/rich note/link survives second device and logout/login',async()=>{
 let remote={revision:0,state:empty()};
 const js=await readFile(new URL('../app.js',import.meta.url),'utf8');
 const make=async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast"></div>',{url:'https://commonplace.test/',runScripts:'outside-only'});const w=dom.window;
  w.scrollTo=()=>{};w.confirm=()=>true;w.COMMONPLACE_CLOUD={enabled:true,url:'https://example.supabase.co',publishableKey:'test'};
  const client={auth:{getSession:async()=>({data:{session:{user:{id:'alice',email:'alice@example.com'}}}}),onAuthStateChange:()=>{},signOut:async()=>({})},rpc:async(name,args)=>{
    if(name==='cp_read')return {data:clone(remote)};
    if(args.expected_revision!==remote.revision)return {data:{conflict:true}};
    remote={revision:remote.revision+1,state:clone(args.document)};return {data:clone(remote)};
  }};
  let engine;w.CommonplaceCloud={createClient:()=>client,SyncEngine:class extends SyncEngine {constructor(options){super({...options,lock:false});engine=this}}};
  w.eval(js);await tick();assert.equal(engine.ready,true);
  const click=async selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();await tick()};
  const input=(selector,text)=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.value=text;el.dispatchEvent(new w.Event('input',{bubbles:true}))};
  const go=async route=>{w.location.hash=route;await tick()};
  return {dom,w,get engine(){return engine},click,input,go};
 };
 const a=await make();await a.go('projects');await a.click('[data-action="new-project"]');a.input('#project-name','Learn');await a.click('[data-action="save-project"]');
 const pid=a.engine.state.projects[0].id;
 await a.click('[data-action="new-task"]');a.input('#capture-text','Read chapter');await a.click('[data-action="save-capture"]');const tid=a.engine.state.tasks[0].id;
 a.input('#new-subtask','Take notes');await a.click('[data-action="add-subtask"]');await a.click('[data-action="toggle-subtask"]');
 await a.click('[data-action="linked-new-note"]');const nid=a.engine.state.notes[0].id;
 a.input('#note-title','Research');const editor=a.w.document.querySelector('#note-editor');editor.innerHTML='<h2>Ideas</h2><ul class="checklist"><li data-done="true">Done</li></ul><script>bad()</script>';editor.dispatchEvent(new a.w.Event('input',{bubbles:true}));
 await a.go('dashboard');await a.engine.sync();
 const b=await make();assert.equal(b.engine.state.tasks[0].subtasks[0].done,true);assert.equal(b.engine.state.tasks[0].projectId,pid);assert.deepEqual(b.engine.state.tasks[0].noteIds,[nid]);
 await b.go('note/'+nid);assert.equal(b.w.document.querySelector('#note-editor h2').textContent,'Ideas');assert.equal(b.w.document.querySelector('#note-editor script'),null);assert.ok(b.w.document.querySelector('a[href="#task/'+tid+'"]'));
 await b.go('task/'+tid);await b.click('[data-action="toggle-task"]');await b.engine.sync();await a.engine.sync();assert.equal(a.engine.state.tasks[0].done,true);
 await a.go('note/'+nid);a.w.document.querySelector('#note-editor').focus();await a.engine.logout();assert.equal(a.w.document.querySelector('#note-editor'),null);assert.equal(a.w.document.body.textContent.includes('Research'),false);
 await a.engine.session({user:{id:'alice',email:'alice@example.com'}});assert.equal(a.engine.state.notes[0].title,'Research');
 a.engine.dispose();b.engine.dispose();a.dom.window.close();b.dom.window.close();
});
