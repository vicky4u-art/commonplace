// Pure data operations shared by synchronization and tests. No browser or network access.
export const empty = () => ({version:1, projects:[], tasks:[], notes:[], attachments:[]});
export const clone = value => JSON.parse(JSON.stringify(value));
export const stable = value => JSON.stringify(value, function(_key,v) {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v;
});
export const equal = (a,b) => stable(a) === stable(b);
export const collections = ['projects','tasks','notes','attachments'];
export function normalize(raw) {
  const out=empty();
  for(const key of collections) {
    if(key!=='attachments' && !Array.isArray(raw?.[key])) throw Error('Invalid backup: missing '+key);
    out[key]=clone(raw[key]||[]).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    const seen=new Set();
    for(const row of out[key]) {
      if(typeof row.id!=='string'||!row.id||seen.has(row.id)) throw Error('Invalid or duplicate '+key+' ID');
      seen.add(row.id);
    }
  }
  for(const t of out.tasks) {
    t.subtasks=t.subtasks||[];
    t.noteIds=[...new Set(t.noteIds||[])].sort();
    const ids=new Set();
    for(const s of t.subtasks) {if(!s.id||ids.has(s.id)) throw Error('Duplicate subtask ID');ids.add(s.id);}
  }
  return out;
}
export function validateLinks(s) {
  const projects=new Set(s.projects.map(p=>p.id)),notes=new Set(s.notes.map(n=>n.id));
  for(const x of [...s.tasks,...s.notes]) if(x.projectId&&!projects.has(x.projectId)) throw Error('An item refers to a missing project. Resolve this before syncing.');
  for(const t of s.tasks) for(const id of t.noteIds) if(!notes.has(id)) throw Error('A task refers to a missing note. Resolve this before syncing.');
}
// Three-way entity merge: disjoint edits merge; same-entity edit/delete conflicts never overwrite silently.
export function merge(base,local,remote,prefer=null) {
  const result=empty(),conflicts=[];
  for(const key of collections) {
    const b=new Map(base[key].map(x=>[x.id,x])),l=new Map(local[key].map(x=>[x.id,x])),r=new Map(remote[key].map(x=>[x.id,x]));
    for(const id of new Set([...b.keys(),...l.keys(),...r.keys()])) {
      const bv=b.get(id),lv=l.get(id),rv=r.get(id);let chosen;
      if(equal(lv,rv)||equal(rv,bv)) chosen=lv;
      else if(equal(lv,bv)) chosen=rv;
      else {conflicts.push({collection:key,id,local:lv,cloud:rv});chosen=prefer==='cloud'?rv:lv;}
      if(chosen)result[key].push(clone(chosen));
    }
  }
  try{validateLinks(result)}catch(e){conflicts.push({collection:'relationships',id:'workspace',message:e.message});}
  return {state:normalize(result),conflicts};
}
// Idempotent, additive import. A duplicate ID with different content is an explicit conflict.
export function importInto(cloud,incoming,overwrite=false) {
  const result=clone(cloud),conflicts=[];
  for(const key of collections)for(const row of incoming[key]) {
    const i=result[key].findIndex(x=>x.id===row.id);
    if(i<0)result[key].push(clone(row));
    else if(!equal(result[key][i],row)) {conflicts.push({collection:key,id:row.id});if(overwrite)result[key][i]=clone(row);}
  }
  validateLinks(result);
  return {state:normalize(result),conflicts};
}
