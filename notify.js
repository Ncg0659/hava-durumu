/* "Önemli hava uyarıları": tek anahtar + küçük açıklama. Gerçek push (Web Push) Cloudflare Worker ile gelir.
   Worker adresi config.js içinde boşsa hiçbir şey göstermez. Hava durumu mantığına dokunmaz. */
'use strict';
(function () {
  var BASE = (window.HD_PUSH_URL || '').replace(/\/+$/, '');
  var card = document.getElementById('notifyCard');
  if (!BASE || !card) return;
  var FLAG = 'hd2:push', SYNC = 'hd2:push-cities';

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* sorun değil */ } return null; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function u8(b64) { var s = b64.replace(/-/g, '+').replace(/_/g, '/'); s += '==='.slice((s.length + 3) % 4); var r = atob(s), o = new Uint8Array(r.length), i; for (i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }
  function b64u(buf) { var b = new Uint8Array(buf), s = '', i; for (i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

  var ua = navigator.userAgent || '';
  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var supported = /^https?:$/.test(location.protocol) && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  var TYPES = [
    ['Gök gürültülü fırtına', 'fırtına bekleniyorsa'],
    ['Kuvvetli yağış', 'saatte 8 mm+ yağmur veya 2 cm+ kar'],
    ['Kuvvetli rüzgâr', 'rüzgâr 50 km/sa+, hamle 70 km/sa+'],
    ['Aşırı sıcak / soğuk', '37°+ veya −7° altı ve mevsim normalinin çok dışında'],
    ['Buzlanma / don', 'ıslak yüzey + 0° altı, dondurucu yağmur'],
    ['Hava kalitesi', 'Avrupa endeksi (EAQI) 60+: yalnızca "kötü" ve daha kötüsü'],
    ['UV', 'yalnızca "aşırı" (11+); 8–10 arası uygulama içinde kalır']
  ];

  var st = { on: false, busy: false, msg: '', cities: [] };

  function cities() {
    var out = [];
    try { out = (JSON.parse(ls('hd2:favs') || '[]') || []).slice(0, 3); } catch (e) { out = []; }
    if (!out.length) { try { var l = JSON.parse(ls('hd2:last') || 'null'); if (l) out = [l]; } catch (e) { /* yok */ } }
    return out.filter(function (c) { return c && isFinite(c.lat) && isFinite(c.lon) && c.name; }).map(function (c) { return { name: c.name, lat: c.lat, lon: c.lon }; });
  }
  function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } }
  function api(path, body, method) {
    return fetch(BASE + path, method === 'GET' ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  function view() {
    var denied = supported && Notification.permission === 'denied';
    var help = '';
    if (!supported) help = ios && !standalone ? 'iPhone\'da bildirim için önce uygulamayı <b>Ana Ekrana ekle</b> (Paylaş › Ana Ekrana Ekle), sonra bu anahtarı aç.' : 'Bu tarayıcı bildirimleri desteklemiyor.';
    else if (denied) help = 'Bildirim izni kapalı. Telefon/tarayıcı ayarlarından bu site için izin verirsen anahtarı açabilirsin.';
    var dis = !supported || denied || st.busy;
    var watching = st.on && st.cities.length ? '<p class="nt-watch">İzlenen: ' + st.cities.map(function (c) { return esc(c.name); }).join(', ') + '</p>' : '';
    card.innerHTML =
      '<div class="nt-row"><div class="nt-t">' + window.uiIcon('bell', 20) + '<h2 id="h-nt">Önemli hava uyarıları</h2></div>' +
      '<button type="button" class="switch" id="ntSwitch" role="switch" aria-checked="' + st.on + '" aria-labelledby="h-nt"' + (dis ? ' disabled' : '') + '><i></i></button></div>' +
      '<p class="nt-d">Fırtına, kuvvetli yağış, kuvvetli rüzgâr, aşırı sıcak/soğuk, kötü hava kalitesi ve buzlanma gibi ciddi durumlarda bildirim al.</p>' +
      watching +
      (help ? '<p class="nt-h">' + help + '</p>' : '') +
      '<p class="nt-m" id="ntMsg" role="status" aria-live="polite"' + (st.msg ? '' : ' hidden') + '>' + esc(st.msg) + '</p>' +
      '<details class="nt-more"><summary>Bildirim türleri</summary><ul>' +
      TYPES.map(function (t) { return '<li><b>' + t[0] + '</b><span>' + t[1] + '</span></li>'; }).join('') +
      '</ul><p class="nt-d">Gün doğumu/batımı, sabah-akşam özeti ve sıradan değişiklikler için bildirim gönderilmez. Aynı olay için bir kez, günde en fazla 4; 23:00–07:00 arası yalnızca ciddi fırtına, çok kuvvetli yağış, tehlikeli rüzgâr ve ciddi buzlanma.</p>' +
      (st.on ? '<button type="button" class="btn ghost" id="ntTest">Deneme bildirimi gönder</button>' : '') + '</details>';
    card.hidden = false;
  }
  function say(m) { st.msg = m || ''; var n = document.getElementById('ntMsg'); if (n) { n.textContent = st.msg; n.hidden = !st.msg; } }

  function sync(sub) {
    var c = cities(); if (!c.length) return Promise.resolve();
    return api('/subscribe', { subscription: sub.toJSON ? sub.toJSON() : sub, cities: c, tz: tz() }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      st.cities = c; ls(SYNC, JSON.stringify(c.map(function (x) { return [x.lat, x.lon]; })));
    });
  }

  function enable() {
    st.busy = true; view();
    var perm = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    return perm.then(function (p) {
      if (p !== 'granted') throw { soft: 'Bildirim izni verilmedi.' };
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      return api('/vapid', null, 'GET').then(function (r) { if (!r.ok) throw new Error('vapid'); return r.json(); }).then(function (j) {
        return reg.pushManager.getSubscription().then(function (cur) {
          if (cur && cur.options && cur.options.applicationServerKey && b64u(cur.options.applicationServerKey) !== j.key) return cur.unsubscribe().then(function () { return null; });
          return cur;
        }).then(function (cur) { return cur || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(j.key) }); });
      });
    }).then(function (sub) { return sync(sub); }).then(function () {
      st.on = true; ls(FLAG, '1'); st.msg = '';
    }).catch(function (e) {
      st.on = false; ls(FLAG, null);
      st.msg = e && e.soft ? e.soft : 'Bildirimler açılamadı. İnternet bağlantını kontrol edip tekrar dene.';
    }).then(function () { st.busy = false; view(); });
  }

  function disable() {
    st.busy = true; view();
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return api('/unsubscribe', { endpoint: ep }).catch(function () { /* sunucuya ulaşılamazsa da yerel aboneliği kapat */ }).then(function () { return sub.unsubscribe(); });
    }).catch(function () { /* sorun değil */ }).then(function () {
      st.on = false; st.cities = []; ls(FLAG, null); ls(SYNC, null); st.msg = ''; st.busy = false; view();
    });
  }

  card.addEventListener('click', function (e) {
    if (e.target.closest('#ntSwitch')) { st.on ? disable() : enable(); return; }
    if (e.target.closest('#ntTest')) {
      var b = e.target.closest('#ntTest'); b.disabled = true;
      navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
        if (!sub) throw new Error('abonelik yok');
        return api('/test', { endpoint: sub.endpoint });
      }).then(function (r) {
        say(r.ok ? 'Deneme bildirimi gönderildi; birkaç saniye içinde gelmeli.' : r.status === 429 ? 'Biraz bekle, deneme bildirimi dakikada bir gönderilebilir.' : 'Deneme gönderilemedi. Anahtarı kapatıp yeniden aç.');
      }).catch(function () { say('Deneme gönderilemedi. İnternet bağlantını kontrol et.'); }).then(function () { b.disabled = false; });
    }
  });

  // Favoriler / şehir değişince (yalnızca açıksa, yalnızca izlenen liste değiştiyse) sunucuya bildir
  var tm = 0;
  document.addEventListener('hd2:cities', function () {
    if (!st.on) return;
    clearTimeout(tm);
    tm = setTimeout(function () {
      var now = JSON.stringify(cities().map(function (x) { return [x.lat, x.lon]; }));
      if (now === ls(SYNC)) return;
      navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) { if (sub) return sync(sub).then(view); }).catch(function () { /* bir sonraki açılışta tekrar denenir */ });
    }, 1500);
  });

  // Başlangıç: önceden açıksa durumu doğrula; abonelik düşmüşse sessizce yenile
  view();
  if (supported && ls(FLAG) === '1' && Notification.permission === 'granted') {
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (sub) { st.on = true; st.cities = cities(); view(); return sync(sub).then(view).catch(function () { /* çevrimdışı: sorun değil */ }); }
      return enable();   // tarayıcı aboneliği düşürmüş: izin zaten var, sessizce yeniden abone ol
    }).catch(function () { /* sorun değil */ });
  } else if (ls(FLAG) === '1') { ls(FLAG, null); }
})();
