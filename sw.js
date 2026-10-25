// Network-first same-origin app shell. Never cache Supabase/auth/API responses.
const CACHE='commonplace-shell-v3';
const ASSETS=['./','./index.html','./styles.css','./app.js','./cloud-config.js','./vendor/cloud.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('commonplace-shell-')&&key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.search||url.pathname.includes('/auth/'))return;
 const allowed=ASSETS.map(asset=>new URL(asset,self.registration.scope).pathname);
 if(!allowed.includes(url.pathname))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}return response}).catch(()=>caches.match(event.request)));
});
