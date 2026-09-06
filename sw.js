const CACHE='salud-mental-v039-iphone';
const ASSETS=['./iphone.html','./manifest.webmanifest','./icon.svg','./iphone-parts/part01.txt','./iphone-parts/part02.txt','./iphone-parts/part03.txt','./iphone-parts/part04.txt','./iphone-parts/part05.txt','./iphone-parts/part06.txt','./iphone-parts/part07.txt'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).catch(()=>caches.match('./iphone.html')));return;
 }
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});