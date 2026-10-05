/* Radar karolarını önbelleğe alan servis çalışanı (yalnızca https/localhost'ta çalışır).
   Yalnızca RainViewer radar karolarına dokunur. Karo yolu zaman damgası içerdiği için değişmez;
   en fazla 120 karo tutulur, eskiler silinir.
   OpenStreetMap karoları KULLANILMIYOR ve önbelleğe alınmıyor; harita altlığı (OpenFreeMap) tarayıcının
   normal HTTP önbelleğini kullanır, yani sağlayıcının verdiği önbellek başlıklarına uyulur.
   Karolar normal (CORS) istekle alınır; CORS yoksa önbelleğe ALINMAZ, istek olduğu gibi geçer. */
'use strict';
var RADAR_CACHE = 'hd2-radar-v1';
var RADAR_MAX = 120;

function kindOf(urlStr) {
  return new URL(urlStr).hostname === 'tilecache.rainviewer.com' ? 'radar' : null;
}
function fresh() { return true; } // radar karo adresi değişmez
function trim(cache, max) {
  return cache.keys().then(function (keys) {
    var extra = keys.length - max, i, jobs = [];
    for (i = 0; i < extra; i++) jobs.push(cache.delete(keys[i])); // en eski eklenenler başta
    return Promise.all(jobs);
  });
}
function handle(req, kind, waitUntil) {
  var name = RADAR_CACHE, max = RADAR_MAX;
  return caches.open(name).then(function (cache) {
    return cache.match(req.url).then(function (hit) {
      if (hit && fresh(hit, kind)) return hit;
      return fetch(req.url, { mode: 'cors', credentials: 'omit' }).then(function (res) {
        if (res && res.ok) waitUntil(cache.put(req.url, res.clone()).then(function () { return trim(cache, max); }));
        return res;
      }).catch(function () {
        if (hit) return hit;       // çevrimdışı: eski karo hiç yoktan iyidir
        return fetch(req);         // CORS yoksa normal istek (önbelleğe alınmaz)
      });
    });
  });
}

if (typeof self !== 'undefined' && self.addEventListener) {
  self.addEventListener('install', function () { self.skipWaiting(); });
  self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k.indexOf('hd2-') === 0 && k !== RADAR_CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
  });
  self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;
    var kind = kindOf(req.url);
    if (!kind) return;
    e.respondWith(handle(req, kind, function (p) { e.waitUntil(p); }));
  });
}
if (typeof module !== 'undefined') module.exports = { handle: handle, kindOf: kindOf, trim: trim, fresh: fresh };
