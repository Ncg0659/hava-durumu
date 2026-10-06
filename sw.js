/* Hava Durumum: servis çalışanı (yalnızca https/localhost'ta çalışır).

   NE ÖNBELLEKLENİR: yalnızca bu sitenin kendi dosyaları (HTML, CSS, JS, ikonlar, manifest; harita dosyaları
   MapLibre + mapview.js ilk kullanımda). Böylece uygulama arayüzü çevrimdışıyken de açılır.

   NE ÖNBELLEKLENMEZ (özellikle): başka bir siteye giden hiçbir istek bu dosyadan geçmez; yani
   OpenFreeMap karoları/stili, OpenStreetMap, RainViewer radar, Open-Meteo / hava kalitesi / şehir arama
   yanıtları servis çalışanı tarafından saklanmaz. Üçüncü taraf hizmetlerin kendi önbellek kuralları geçerlidir.

   SÜRÜMLEME: BUILD, derleme sırasında dosya içeriklerinden hesaplanır (tools/build.mjs). Herhangi bir dosya
   değişince bu dosyanın içeriği de değişir, tarayıcı yeni sürümü görür, yeni önbelleği kurar ve eskisini siler.
   Yeni sürüm kullanıcı onay verene kadar BEKLER (pwa.js "Yeni sürüm hazır — Güncelle" gösterir). */
'use strict';
var BUILD = 'ad25ee8a';
var PREFIX = 'hd2-shell-';
var CACHE = PREFIX + BUILD;
var CORE = ['index.html', 'style.css', 'app.js', 'icons.js', 'insights.js', 'pwa.js', 'notify.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/favicon-64.png', 'icons/badge-96.png'];
var LAZY = /\/(vendor\/maplibre\/[^/]+|mapview\.js)$/;   // ilk kullanımda önbelleğe girer

function scopeUrl(p) { return new URL(p, self.registration.scope).href; }

function precache() {
  return caches.keys().then(function (keys) {
    var first = !keys.some(function (k) { return k.indexOf(PREFIX) === 0; });   // daha önce kabuk önbelleği yoksa
    return caches.open(CACHE).then(function (cache) {
      return Promise.all(CORE.map(function (p) {
        // 'reload': tarayıcının HTTP önbelleğine bakma, sunucudaki güncel dosyayı al
        return fetch(new Request(scopeUrl(p), { cache: 'reload' })).then(function (res) {
          if (!res.ok) throw new Error(p + ' ' + res.status);
          var jobs = [cache.put(scopeUrl(p), res.clone())];
          if (p === 'index.html') jobs.push(cache.put(self.registration.scope, res.clone()));   // "/hava-durumu/" adresi de aynı sayfa
          return Promise.all(jobs);
        });
      }));
    }).then(function () { if (first) return self.skipWaiting(); });   // ilk kurulum: bekletmeye gerek yok
  });
}

function handle(req) {
  var url = new URL(req.url);
  // config.js (bildirim sunucusu adresi) önbelleğe alınmaz: önce ağ, çevrimdışıysa son görülen kopya
  if (/\/config\.js$/.test(url.pathname)) {
    return fetch(req).then(function (res) {
      if (res && res.ok) { var c = res.clone(); caches.open(CACHE).then(function (ca) { return ca.put(req.url, c); }).catch(function () {}); }
      return res;
    }).catch(function () { return caches.match(req.url).then(function (h) { return h || new Response('', { headers: { 'Content-Type': 'text/javascript' } }); }); });
  }
  if (req.mode === 'navigate') {
    return caches.match(scopeUrl('index.html'), { ignoreSearch: true }).then(function (hit) { return hit || fetch(req); });
  }
  return caches.match(req.url).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic' && LAZY.test(url.pathname)) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { return c.put(req.url, copy); }).catch(function () {});
      }
      return res;
    });
  });
}

function mine(req) {
  if (req.method !== 'GET') return false;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return false;                          // başka siteler: dokunma
  return url.pathname.indexOf(new URL(self.registration.scope).pathname) === 0;   // yalnızca /hava-durumu/ altı
}

if (typeof self !== 'undefined' && self.addEventListener) {
  self.addEventListener('install', function (e) { e.waitUntil(precache()); });
  self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (ks) {
      // eski sürümler ve önceki radar önbelleği (hd2-radar-v1) silinir
      return Promise.all(ks.filter(function (k) { return k.indexOf('hd2-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
  });
  // Gerçek push: sunucudan gelen {title, body, tag, url} her zaman görünür bir bildirim olarak gösterilir
  self.addEventListener('push', function (e) {
    var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
    e.waitUntil(self.registration.showNotification(d.title || 'Hava uyarısı', {
      body: d.body || '', tag: d.tag || undefined, lang: 'tr',
      icon: scopeUrl('icons/icon-192.png'), badge: scopeUrl('icons/badge-96.png'),
      data: { url: d.url || self.registration.scope }
    }));
  });
  self.addEventListener('notificationclick', function (e) {
    e.notification.close();
    var target = (e.notification.data && e.notification.data.url) || self.registration.scope;
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(self.registration.scope) === 0 && 'focus' in list[i]) return list[i].focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    }));
  });
  self.addEventListener('message', function (e) { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
  self.addEventListener('fetch', function (e) {
    if (!mine(e.request)) return;
    e.respondWith(handle(e.request));
  });
}
if (typeof module !== 'undefined') module.exports = { mine: mine, handle: handle, CORE: CORE, LAZY: LAZY };
