// Jans verkstad: natverksprioriterad navigering, offlinebackup av senaste appen.
const CACHE = "jans-verkstad-pwa-20261027b";
const FILES = [
  "./index.html",
  "./verkstad-v3-2-test.html",
  "./manifest.webmanifest",
  "./verkstad-v3-2.webmanifest",
  "./jans-hantverk-256.png",
  "./icon.svg",
  "./index-D-qwewMk.css",
  "./app-zpV9q5eu.js"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("jans-verkstad-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    // Hamtar aktuell startsida vid varje ny oppning; anvander cache utan internet.
    event.respondWith(fetch(request, {cache:"no-store"}).then(response => {
      if (response.ok) {
        const key = url.origin + url.pathname;
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(key,response.clone())));
      }
      return response;
    }).catch(async () => {
      const fallback = await caches.match(request,{ignoreSearch:true});
      return fallback || await caches.match("./verkstad-v3-2-test.html") || await caches.match("./index.html") || Response.error();
    }));
    return;
  }
  event.respondWith(caches.match(request,{ignoreSearch:true}).then(hit => hit || fetch(request)));
});
