import {empty,clone,normalize,equal,merge,importInto,stable,validateLinks} from './model.mjs';
export class SyncEngine {
  constructor({client,storage,onState,onStatus,readAudio,writeAudio,isEditing=()=>false,lock=true}) {
    Object.assign(this,{client,storage,onState,onStatus,readAudio,writeAudio,isEditing,lock});
    this.user=null;this.ready=false;this.mode='starting';this.base={revision:0,state:empty()};this.state=empty();
    this.busy=false;this.conflict=null;this.status='Opening your space…';this.timer=null;this.generation=0;
  }
  get writable(){return this.mode==='local'||(this.mode==='cloud'&&this.ready&&!this.importing);}
  key(){return 'commonplace.cloud.v1.'+this.user.id;}
  setStatus(message){this.status=message;this.onStatus?.(message);}
  persist(){this.storage.setItem(this.key(),JSON.stringify({base:this.base,state:this.state}));}
  publish(){this.onState?.(clone(this.state));}
  async start() {
    if(this.lock) {
      if(!globalThis.navigator?.locks) {this.mode='blocked';this.setStatus('Cloud editing requires an updated browser with Web Locks support.');return;}
      const acquired=await new Promise(resolve=>navigator.locks.request('commonplace-editor',{ifAvailable:true}, async lock=>{
        resolve(Boolean(lock));if(lock)await new Promise(r=>this.releaseLock=r);
      }));
      if(!acquired){this.mode='blocked';this.setStatus('Commonplace is open in another tab. Close it, then reload this tab.');return;}
    }
    this.client.auth.onAuthStateChange((_event,session)=>{
      // Never await Supabase calls inside its auth callback (SDK lock deadlock).
      setTimeout(()=>this.session(session).catch(e=>this.fail(e)),0);
    });
    const {data,error}=await this.client.auth.getSession();if(error)throw error;
    await this.session(data.session);
    this.interval=setInterval(()=>{if(!globalThis.document?.hidden)this.sync().catch(e=>this.fail(e));},15000);
  }
  async session(session) {
    const uid=session?.user?.id||null;
    if(uid===this.user?.id&&this.mode==='cloud')return;
    if(!uid&&this.mode==='local')return;
    this.generation++;clearTimeout(this.timer);this.user=session?.user||null;this.ready=false;this.conflict=null;this.storageFailed=false;this.mode='starting';this.state=empty();this.publish();
    if(!uid) {
      const mode=this.storage.getItem('commonplace.cloud.used')?'signed-out':'local';
      this.state=mode==='local'?this.legacy():empty();this.mode=mode;this.publish();
      this.setStatus(this.mode==='local'?'On this device · Sign in to sync':'Signed out');return;
    }
    this.mode='cloud';this.storage.setItem('commonplace.cloud.used','true');
    const raw=this.storage.getItem(this.key());
    if(raw) {const cached=JSON.parse(raw);this.base={revision:cached.base.revision,state:normalize(cached.base.state)};this.state=normalize(cached.state);this.ready=true;}
    else {this.base={revision:0,state:empty()};this.state=empty();}
    this.publish();this.setStatus('Connecting to your cloud…');await this.sync();
  }
  legacy(){const raw=this.storage.getItem('commonplace.v1');return raw?normalize(JSON.parse(raw)):empty();}
  useLocal(){if(this.user)throw Error('Sign out first.');const legacy=this.legacy();this.mode='local';this.state=legacy;this.publish();this.setStatus('On this device · Sign in to sync');}
  save(value) {
    if(!this.writable)throw Error('Wait for sign-in and synchronization before editing.');
    this.state=normalize(value);
    try {
      if(this.mode==='local')this.storage.setItem('commonplace.v1',JSON.stringify(this.state));else this.persist();
    } catch(e){this.storageFailed=true;this.setStatus('NOT SAVED: browser storage is full. Export a backup now.');throw e;}
    this.storageFailed=false;
    if(this.mode==='local'){this.setStatus('Saved on this device · Sign in to sync');return;}
    this.setStatus(this.conflict?'Conflicting edits · Open Settings to resolve':'Saved on this device · Sync pending');
    clearTimeout(this.timer);this.timer=setTimeout(()=>this.sync().catch(e=>this.fail(e)),700);
  }
  fail(error){this.setStatus('Sync needs attention: '+(error?.message||String(error))+'. Edits remain on this device.');}
  async read(){const {data,error}=await this.client.rpc('cp_read');if(error)throw error;return {revision:data.revision,state:normalize(data.state)};}
  async sync() {
    if(!this.user||this.mode!=='cloud'||this.busy||this.conflict||this.storageFailed)return false;
    this.busy=true;const generation=this.generation;const valid=()=>generation===this.generation&&this.mode==='cloud';
    try {
      const remote=await this.read();if(!valid())return false;
      if(!this.ready){this.base=remote;this.state=clone(remote.state);this.persist();this.ready=true;this.publish();}
      if(this.isEditing()&&equal(this.state,this.base.state)&&!equal(remote.state,this.state)){this.setStatus('Cloud update ready · Finish editing to refresh');return false;}
      const merged=merge(this.base.state,this.state,remote.state);
      if(merged.conflicts.length){this.conflict={remote,conflicts:merged.conflicts};this.setStatus('Conflicting edits · Open Settings to resolve');return false;}
      const oldState=this.state;this.base=remote;this.state=merged.state;this.persist();
      if(!equal(oldState,this.state))this.publish();
      const prepared=await this.prepareAudio(clone(this.state),this.user.id);if(!valid())return false;
      // Capture fresh edits made while audio was uploading; attach only metadata from this upload.
      const added=prepared.attachments.filter(a=>!this.state.attachments.some(x=>x.id===a.id));
      this.state.attachments.push(...added);this.state=normalize(this.state);this.persist();
      if(equal(this.state,this.base.state)){this.setStatus('Synced');return true;}
      validateLinks(this.state);
      const sent=clone(this.state);this.setStatus('Saving to cloud…');
      const {data,error}=await this.client.rpc('cp_commit',{expected_revision:this.base.revision,document:sent});
      if(error)throw error;if(!valid())return false;
      if(data.conflict){this.setStatus('Cloud changed · Retrying safely');this.timer=setTimeout(()=>this.sync().catch(e=>this.fail(e)),200);return false;}
      const acknowledged={revision:data.revision,state:normalize(data.state)};
      if(!equal(sent,acknowledged.state))throw Error('Cloud verification failed');
      // An in-flight save must never replace text typed while awaiting its response.
      this.base=acknowledged;this.persist();
      if(equal(sent,this.state))this.setStatus('Synced');else {this.setStatus('Saved on this device · Sync pending');this.timer=setTimeout(()=>this.sync().catch(e=>this.fail(e)),200);}
      return equal(this.state,this.base.state);
    } catch(e){if(valid())this.fail(e);return false;} finally {this.busy=false;}
  }
  async prepareAudio(value,owner,source='cloud') {
    for(const note of value.notes) {
      if(!note.audioId||value.attachments.some(a=>a.id===note.audioId))continue;
      const blob=await this.readAudio(note.audioId,source==='cloud'?owner:source);
      if(!blob)throw Error('Missing recording for “'+(note.title||note.id)+'”. Original data was retained; restore its audio backup before importing');
      const bytes=await blob.arrayBuffer();const hash=await sha256(bytes);
      const path=owner+'/'+encodeURIComponent(note.audioId)+'/'+hash;
      const bucket=this.client.storage.from('commonplace-audio');
      const result=await bucket.upload(path,blob,{contentType:blob.type||'application/octet-stream',upsert:false});
      if(result.error&&!['409','400'].includes(String(result.error.statusCode)))throw result.error;
      // Also verifies an existing object on retry instead of trusting a duplicate response.
      const {data:verified,error}=await bucket.download(path);if(error)throw error;
      if(await sha256(await verified.arrayBuffer())!==hash)throw Error('Audio verification failed');
      value.attachments.push({id:note.audioId,path,sha256:hash,size:blob.size,type:blob.type});
      await this.writeAudio(note.audioId,blob,owner);
    }
    return normalize(value);
  }
  async audio(id) {
    if(this.mode==='local')return this.readAudio(id,'legacy');
    if(!this.user)return null;
    const owner=this.user.id,generation=this.generation;
    const a=this.state.attachments.find(x=>x.id===id);
    const cached=await this.readAudio(id,owner);
    if(cached&&(!a||await sha256(await cached.arrayBuffer())===a.sha256))return cached;
    if(!a)return null;
    const {data,error}=await this.client.storage.from('commonplace-audio').download(a.path);if(error)throw error;
    if(await sha256(await data.arrayBuffer())!==a.sha256)throw Error('Audio checksum mismatch');
    if(this.generation!==generation)return null;
    await this.writeAudio(id,data,owner);return data;
  }
  async importData(incoming,{legacy=false,overwrite=false,audioSource='cloud'}={}) {
    if(!this.user||!this.ready)throw Error('Sign in and connect before importing.');
    if(this.busy||this.conflict||this.storageFailed||!equal(this.state,this.base.state))throw Error('Finish syncing or resolve conflicts before importing.');
    this.busy=true;this.importing=true;const generation=this.generation;
    try {
      let data=normalize(incoming);validateLinks(data);
      if(legacy&&!this.storage.getItem('commonplace.legacy.original'))this.storage.setItem('commonplace.legacy.original',this.storage.getItem('commonplace.v1'));
      data=await this.prepareAudio(data,this.user.id,legacy?'legacy':audioSource);
      if(generation!==this.generation)throw Error('Account changed. Import stopped.');
      const remote=await this.read();
      if(generation!==this.generation)throw Error('Account changed. Import stopped.');
      const result=importInto(remote.state,data,overwrite);
      if(result.conflicts.length&&!overwrite)return {conflicts:result.conflicts};
      // Recovery copy is durable before any explicitly approved collision overwrite.
      this.storage.setItem('commonplace.recovery.'+this.user.id+'.'+Date.now(),JSON.stringify({cloud:remote.state,incoming:data}));
      const {data:response,error}=await this.client.rpc('cp_commit',{expected_revision:remote.revision,document:result.state});
      if(error)throw error;if(response.conflict)throw Error('Cloud changed during import. Retry; no cloud records were changed by this attempt.');
      const check=await this.read();
      if(!equal(normalize(response.state),result.state)||!equal(check.state,result.state))throw Error('Cloud changed during verification. Retry import to verify; originals remain safe.');
      if(generation!==this.generation)throw Error('Account changed. Sign in again to verify.');
      this.base=check;this.state=clone(check.state);this.persist();this.publish();
      if(legacy)this.storage.setItem('commonplace.migrated.'+this.user.id,await sha256(new TextEncoder().encode(stable(normalize(incoming)))));
      this.setStatus('Import verified · Synced');return {verified:true};
    } finally {this.busy=false;this.importing=false;}
  }
  async migrationNeeded(){if(!this.user)return false;const data=this.legacy();if(!data.tasks.length&&!data.notes.length&&!data.projects.length)return false;return this.storage.getItem('commonplace.migrated.'+this.user.id)!==await sha256(new TextEncoder().encode(stable(data)));}
  resolve(prefer) {
    if(!this.conflict)return;
    const {remote}=this.conflict;
    this.storage.setItem('commonplace.recovery.'+this.user.id+'.'+Date.now(),JSON.stringify({local:this.state,cloud:remote.state}));
    const result=merge(this.base.state,this.state,remote.state,prefer);
    // Related deletes may not form a valid mixed graph. Explicit whole-workspace fallback.
    this.state=result.conflicts.some(c=>c.collection==='relationships')?clone(prefer==='cloud'?remote.state:this.state):result.state;
    validateLinks(this.state);this.base=remote;this.conflict=null;this.persist();this.publish();
    return this.sync();
  }
  async logout() {
    if(this.storageFailed)throw Error('Some edits could not be saved locally. Export them before signing out.');
    if(this.busy)throw Error('Wait for the current sync or import to finish before signing out.');
    const {error}=await this.client.auth.signOut({scope:'local'});if(error)throw error;
    this.generation++;this.user=null;this.ready=false;this.mode='signed-out';this.state=empty();this.conflict=null;this.publish();this.setStatus('Signed out');
  }
  dispose(){clearInterval(this.interval);clearTimeout(this.timer);this.releaseLock?.();}
}
export async function sha256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
