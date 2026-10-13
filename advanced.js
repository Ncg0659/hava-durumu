/* EYRIVO gelişmiş veri modülleri (advanced/*.js birleşimi) */
/* Gelişmiş veri modülleri: TEK yapılandırma yeri (özellik bayrakları, katman ayrımı, modül başına önbellek süreleri).
   Şimdilik hiçbir modül kullanıcı arayüzüne bağlı değildir ve bayrakların hepsi kapalıdır; kapalı modül ağ isteği yapmaz.
   Veri kaynağı yalnızca Open-Meteo'dur; lisans/plan koşulları için ilgili Open-Meteo sayfasına bakılmalıdır (burada iddia edilmez). */
'use strict';
(function (g) {
  var MIN = 60000, H = 3600000, D = 86400000;

  // Modül açık/kapalı. Üretimde hepsi false. Geliştirmede Advanced.setFlag('flood', true) ile tek tek açılır (yalnızca bellekte).
  var FEATURES = { ensemble: false, flood: false, climate: false, seasonal: false, marine: false, airquality: false };

  // core/free ↔ advanced: yalnızca etiket. Bugün hiçbir şeyi kilitlemez, arayüzde gösterilmez; ileride erişim ayrımı için tek nokta.
  var TIER = { ensemble: 'advanced', flood: 'advanced', climate: 'advanced', seasonal: 'advanced', marine: 'advanced', airquality: 'advanced' };
  var CORE_FEATURES = ['forecast', 'hourly', 'risk', 'advice', 'driving', 'map', 'radar', 'push', 'offline', 'favorites', 'airquality-basic'];

  // ttl: taze sayılma süresi · staleMax: çevrimdışı/ağ hatasında "eski" bayrağıyla hâlâ gösterilebilecek en uzun yaş
  // neg: "uygun değil" sonucunun hatırlanma süresi (aynı yere boşuna tekrar sorulmasın) · max: modül başına saklanan en çok konum
  var CACHE = {
    ensemble:   { ttl: 3 * H,   staleMax: 24 * H,  neg: 30 * MIN, max: 8 },    // modeller günde 2–4 kez yenilenir: kısa/orta
    flood:      { ttl: 6 * H,   staleMax: 3 * D,   neg: 12 * H,   max: 8 },    // günlük akım verisi: orta
    climate:    { ttl: 30 * D,  staleMax: 365 * D, neg: 1 * D,    max: 4 },    // uzun vadeli projeksiyon değişmez: çok uzun
    seasonal:   { ttl: 24 * H,  staleMax: 14 * D,  neg: 6 * H,    max: 4 },    // günlük/aylık güncellenir: uzun
    marine:     { ttl: 3 * H,   staleMax: 2 * D,   neg: 12 * H,   max: 8 },    // dalga modeli: orta
    airquality: { ttl: 30 * MIN, staleMax: 6 * H,  neg: 30 * MIN, max: 8 }     // mevcut hava kalitesi önbelleğiyle aynı sıklık
  };

  var C = {
    FEATURES: FEATURES, TIER: TIER, CORE_FEATURES: CORE_FEATURES, CACHE: CACHE,
    KEY_PREFIX: 'hd2:xm:',          // 'hd2:adv' zaten öneri motorunun anahtarı; karışmasın diye 'xm'
    TIMEOUT_MS: 12000,              // tek istek zaman aşımı
    MAX_ENTRY_BYTES: 24000,         // bundan büyük özet saklanmaz (ham yük asla saklanmaz)
    COAST_KM: 25                    // deniz modülü için "kıyıya yeterince yakın" sınırı
  };
  g.AdvConfig = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis);

;
/* Gelişmiş modüllerin ortak çekirdeği: sonuç sözleşmesi, önbellek, istek yönetimi, bayrak denetimi.
   Bir modül şu şekilde tanımlanır (ensemble.js vb.):
     { name, source, version, applicable(loc)→{ok,reason}, key(loc,opts), url(loc,opts), parse(json,loc,opts)→{data,meta} | {unavailable,meta} }
   Çekirdek şunları yapar: bayrak kapalıysa HİÇ ağ/depolama işi yapmaz · taze önbellek varsa ağa gitmez · çevrimdışıysa eski veriyi "stale" işaretiyle verir ·
   aynı anahtar için tek istek · aynı modülde yeni konum istenince eski isteği iptal eder (eski şehir yenisinin üstüne yazamaz) ·
   yalnızca küçük, normalize özet saklar. Hata durumunda sessiz kalır (konsol spam'i yok).
   Sonuç: { status:'ok'|'unavailable'|'error', module, data, fetchedAt, stale, source, meta } */
'use strict';
(function (g) {
  var CFG = g.AdvConfig || require('./config.js');

  function copy(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }
  function validLoc(l) { return !!l && isFinite(l.lat) && isFinite(l.lon) && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180; }
  function fix(n, d) { return Number(n).toFixed(d); }
  function locKey(l, digits) { var d = digits == null ? 2 : digits; return fix(l.lat, d) + ',' + fix(l.lon, d); }

  // ---------- depolama bağdaştırıcıları (localStorage; olmazsa bellek) ----------
  function memStorage() {
    var m = {};
    return { get: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; }, set: function (k, v) { m[k] = v; return true; },
      remove: function (k) { delete m[k]; }, keys: function () { return Object.keys(m); } };
  }
  function lsStorage() {
    var ls; try { ls = g.localStorage; ls.getItem('hd2:xm:probe'); } catch (e) { return memStorage(); }
    return {
      get: function (k) { try { return ls.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { ls.setItem(k, v); return true; } catch (e) { return false; } },
      remove: function (k) { try { ls.removeItem(k); } catch (e) { /* yok say */ } },
      keys: function () { var o = []; try { for (var i = 0; i < ls.length; i++) o.push(ls.key(i)); } catch (e) { /* yok say */ } return o; }
    };
  }

  // ---------- sonuç üreticileri ----------
  function make(mod, status, o) {
    o = o || {};
    return { status: status, module: mod.name, data: o.data == null ? null : o.data, fetchedAt: o.fetchedAt || null, stale: !!o.stale, source: mod.source || 'open-meteo', meta: o.meta || {} };
  }
  function unavailable(mod, reason, extra) { var m = copy(extra || {}); m.reason = reason; return make(mod, 'unavailable', { meta: m, fetchedAt: m.fetchedAt || null }); }

  function createRuntime(o) {
    o = o || {};
    var rt = {
      storage: o.storage || lsStorage(),
      fetch: o.fetch || function (u, i) { return g.fetch(u, i); },
      now: o.now || function () { return Date.now(); },
      online: o.online || function () { return !(g.navigator && g.navigator.onLine === false); },
      flags: copy(CFG.FEATURES),
      inflight: {}, ctl: {}, latest: {},
      stats: { fetch: 0, hit: 0, stale: 0, superseded: 0, error: 0 }
    };

    rt.isOn = function (name) { return rt.flags[name] === true; };
    rt.setFlag = function (name, on) { if (Object.prototype.hasOwnProperty.call(rt.flags, name)) rt.flags[name] = !!on; return rt.flags[name]; };

    function pol(mod) { return CFG.CACHE[mod.name] || { ttl: 3600000, staleMax: 86400000, neg: 600000, max: 6 }; }
    function fullKey(mod, loc, opts) { return CFG.KEY_PREFIX + mod.name + ':' + (mod.key ? mod.key(loc, opts) : locKey(loc)); }

    function cacheGet(key, mod) {
      var raw = rt.storage.get(key); if (!raw) return null;
      try {
        var e = JSON.parse(raw);
        if (e && e.v === (mod.version || 1) && typeof e.t === 'number') return e;
      } catch (err) { /* bozuk kayıt */ }
      rt.storage.remove(key); return null;
    }
    function evict(mod) {
      var p = pol(mod), pre = CFG.KEY_PREFIX + mod.name + ':', list = [];
      rt.storage.keys().forEach(function (k) {
        if (k.indexOf(pre) !== 0) return;
        var t = 0; try { t = JSON.parse(rt.storage.get(k)).t || 0; } catch (e) { /* bozuk → en eski say */ }
        list.push({ k: k, t: t });
      });
      list.sort(function (a, b) { return b.t - a.t; });
      list.slice(p.max).forEach(function (x) { rt.storage.remove(x.k); });
    }
    function cachePut(key, mod, entry) {
      var txt = JSON.stringify(entry);
      if (txt.length > CFG.MAX_ENTRY_BYTES) return false;      // büyük yük saklanmaz
      if (!rt.storage.set(key, txt)) { evict(mod); if (!rt.storage.set(key, txt)) return false; }
      evict(mod); return true;
    }
    function fromEntry(mod, e, stale, how) {
      var m = copy(e.meta || {}); m.cache = how; m.ageMs = rt.now() - e.t;
      return make(mod, 'ok', { data: e.data, fetchedAt: e.t, stale: stale, meta: m });
    }

    // Yalnızca önbelleğe bakar (ağ yok). Kayıt yoksa null. "Uygun değil" olarak kaydedilmişse unavailable döner.
    rt.readCached = function (mod, loc, opts) {
      if (!validLoc(loc)) return null;
      var e = cacheGet(fullKey(mod, loc, opts || {}), mod); if (!e) return null;
      var age = rt.now() - e.t, p = pol(mod);
      if (e.ok) return age <= p.staleMax ? fromEntry(mod, e, age >= p.ttl, age >= p.ttl ? 'stale' : 'hit') : null;
      return age < p.neg ? unavailable(mod, e.reason, { cache: 'hit', fetchedAt: e.t, suitability: e.suit }) : null;
    };

    rt.cancel = function (name) {
      Object.keys(rt.ctl).forEach(function (n) {
        if (name && n !== name) return;
        var c = rt.ctl[n]; if (c && c.ac) { c.superseded = true; try { c.ac.abort(); } catch (e) { /* yok say */ } }
      });
    };

    rt.run = function (mod, loc, opts) {
      opts = opts || {};
      var name = mod.name, p = pol(mod);
      if (!rt.isOn(name)) return Promise.resolve(unavailable(mod, 'disabled'));            // kapalı modül: ağ yok, depolama yok
      if (!validLoc(loc)) return Promise.resolve(unavailable(mod, 'bad-location'));
      var ap = mod.applicable ? mod.applicable(loc, opts) : { ok: true };
      if (!ap.ok) return Promise.resolve(unavailable(mod, ap.reason || 'not-applicable', ap.meta));

      var key = fullKey(mod, loc, opts), now = rt.now(), c = cacheGet(key, mod);
      if (c && !opts.refresh) {
        var age = now - c.t;
        if (c.ok && age < p.ttl) { rt.stats.hit++; return Promise.resolve(fromEntry(mod, c, false, 'hit')); }
        if (!c.ok && age < p.neg) { rt.stats.hit++; return Promise.resolve(unavailable(mod, c.reason, { cache: 'hit', fetchedAt: c.t, suitability: c.suit })); }
      }
      var okOld = c && c.ok && (now - c.t) <= p.staleMax ? c : null;
      if (!rt.online()) {
        if (okOld) { rt.stats.stale++; return Promise.resolve(fromEntry(mod, okOld, true, 'stale')); }
        return Promise.resolve(unavailable(mod, 'offline'));
      }
      if (rt.inflight[key]) return rt.inflight[key];                                     // aynı uç nokta için tek istek

      // aynı modülde başka konum isteniyorsa eskisini iptal et
      var prev = rt.ctl[name];
      if (prev && prev.key !== key) rt.cancel(name);
      var tok = (rt.latest[name] = (rt.latest[name] || 0) + 1);
      var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var ctl = { key: key, ac: ac, superseded: false, timedOut: false };
      rt.ctl[name] = ctl;
      var timer = setTimeout(function () { ctl.timedOut = true; if (ac) { try { ac.abort(); } catch (e) { /* yok say */ } } }, CFG.TIMEOUT_MS);
      rt.stats.fetch++;

      function isSuperseded() { return ctl.superseded || rt.latest[name] !== tok; }
      function fallback(reason) {
        rt.stats.error++;
        if (okOld) { rt.stats.stale++; var r = fromEntry(mod, okOld, true, 'stale'); r.meta.error = reason; return r; }
        return make(mod, 'error', { meta: { reason: reason } });
      }

      var pr = Promise.resolve().then(function () {
        if (isSuperseded()) { var ae = new Error('aborted'); ae.name = 'AbortError'; throw ae; }   // daha ağa çıkmadan iptal edildiyse istek hiç atılmaz
        return rt.fetch(mod.url(loc, opts), ac ? { signal: ac.signal } : {});
      }).then(function (res) {
        if (res.ok) return res.json().then(function (j) { return { json: j }; });
        var st = res.status;
        return res.json().then(function (j) { return j; }, function () { return null; }).then(function (j) {
          if (st === 400) return { rejected: (j && j.reason) || 'http-400' };       // istek bu konum/parametre için geçersiz → "uygun değil"
          throw new Error('http-' + st);
        });
      }).then(function (r) {
        if (isSuperseded()) { rt.stats.superseded++; return unavailable(mod, 'superseded'); }
        var t = rt.now(), parsed;
        if (r.rejected) parsed = { unavailable: r.rejected };
        else { try { parsed = mod.parse(r.json, loc, opts); } catch (pe) { throw new Error('parse'); } }   // bozuk yanıt → 'error' (eski veri varsa o)
        if (parsed.unavailable) {
          cachePut(key, mod, { v: mod.version || 1, t: t, ok: false, reason: parsed.unavailable, suit: parsed.meta && parsed.meta.suitability });
          var mm = copy(parsed.meta || {}); mm.cache = 'miss'; mm.fetchedAt = t;
          return unavailable(mod, parsed.unavailable, mm);
        }
        var meta = copy(parsed.meta || {}); meta.cache = 'miss';
        var stored = cachePut(key, mod, { v: mod.version || 1, t: t, ok: true, data: parsed.data, meta: parsed.meta || {} });
        if (!stored) meta.cacheSkipped = true;
        return make(mod, 'ok', { data: parsed.data, fetchedAt: t, stale: false, meta: meta });
      }).catch(function (err) {
        if (isSuperseded()) { rt.stats.superseded++; return unavailable(mod, 'superseded'); }
        return fallback(ctl.timedOut ? 'timeout' : (err && /^(http-\d+|parse)$/.test(err.message) ? err.message : (err && err.name === 'AbortError' ? 'aborted' : 'network')));
      }).then(function (out) {
        clearTimeout(timer); delete rt.inflight[key]; if (rt.ctl[name] === ctl) delete rt.ctl[name];
        return out;
      });
      rt.inflight[key] = pr;
      return pr;
    };
    return rt;
  }

  // küçük istatistik yardımcıları (null/NaN değerleri atlar)
  function nums(a) { var o = []; for (var i = 0; i < a.length; i++) if (typeof a[i] === 'number' && isFinite(a[i])) o.push(a[i]); return o; }
  function mean(a) { var n = nums(a); if (!n.length) return null; var s = 0; n.forEach(function (x) { s += x; }); return s / n.length; }
  function std(a) { var n = nums(a); if (n.length < 2) return null; var m = mean(n), s = 0; n.forEach(function (x) { s += (x - m) * (x - m); }); return Math.sqrt(s / n.length); }
  function r(x, d) { if (x == null) return null; var k = Math.pow(10, d == null ? 1 : d); var v = Math.round(x * k) / k; return v === 0 ? 0 : v; }
  function qs(o) { return Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]).replace(/%2C/g, ','); }).join('&'); }

  var Core = { nums: nums, mean: mean, std: std, r: r, qs: qs, createRuntime: createRuntime, memStorage: memStorage, lsStorage: lsStorage, validLoc: validLoc, locKey: locKey, make: make, unavailable: unavailable, copy: copy };
  g.AdvCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);

;
/* Konum uygunluğu (capability): hangi gelişmiş modül bu konumda ANLAMLI olabilir? Ağ isteği yapmaz, saf hesaptır.
   getAdvancedCapabilities(loc, ctx) → { ensemble, flood, climate, seasonal, marine } (true/false)
   explainAdvancedCapabilities(loc, ctx) → aynısı + details: modül başına { available, confidence:'low'|'medium'|'high', reason }
   İlkeler:
   · Ensemble / Climate / Seasonal küresel modellerdir: geçerli koordinat yeterli.
   · Marine: kıyıya yakınlık ön süzgeci (aşağıdaki kaba Türkiye kıyı çizgisi). Referans alanı dışında "bilinmiyor" → false (uydurma yok).
     Asıl kesin karar marine.js'te API'nin gerçekten deniz verisi döndürmesine bağlıdır.
   · Flood: SIRF API cevap verdi diye açılmaz. true yalnızca flood.js'in daha önce "uygun" (nehir hücresi yakın + akım anlamlı) diye
     doğruladığı ve önbelleğe yazdığı konumlar için (ctx.floodVerdict). Bilinmiyorsa false. */
'use strict';
(function (g) {
  var CFG = g.AdvConfig || require('./config.js');

  // Kaba kıyı çizgisi (derece; [enlem, boylam]). Yalnızca "kıyıdan kaç km" ön süzgeci içindir; haritaya çizilmez, hassas sınır değildir.
  var COAST = [
    [[41.51, 41.54], [41.40, 41.42], [41.03, 40.52], [41.00, 39.72], [40.92, 38.39], [41.00, 37.88], [41.29, 36.33], [41.73, 35.95], [42.03, 35.15],
      [41.95, 34.00], [41.89, 33.00], [41.75, 32.39], [41.45, 31.79], [41.09, 31.12], [41.10, 30.69], [41.18, 29.61], [41.23, 29.12], [41.63, 28.10], [41.90, 28.02]],
    [[41.23, 29.12], [41.04, 29.00], [40.97, 28.80], [41.00, 28.60], [41.07, 28.25], [40.98, 27.51], [40.61, 27.11], [40.41, 26.67], [40.15, 26.40], [40.05, 26.18]],
    [[41.04, 29.05], [40.90, 29.20], [40.76, 29.52], [40.76, 29.93], [40.70, 29.45], [40.43, 29.15], [40.38, 28.88], [40.35, 27.97], [40.40, 27.79], [40.40, 27.30], [40.34, 26.69], [40.15, 26.40]],
    [[40.05, 26.18], [39.58, 26.90], [39.31, 26.69], [39.07, 26.89], [38.93, 26.93], [38.43, 27.15], [38.35, 26.77], [38.32, 26.30], [38.20, 26.83], [37.86, 27.26], [37.38, 27.27],
      [37.24, 27.60], [37.03, 27.43], [36.75, 27.68], [36.85, 28.27], [36.62, 29.12], [36.20, 29.64], [36.30, 30.15], [36.88, 30.70], [36.54, 32.00], [36.08, 32.84], [36.38, 34.09],
      [36.78, 34.62], [36.57, 35.38], [36.59, 36.17], [36.41, 35.89], [36.08, 35.97]]
  ];
  var COVER = { lat0: 35.3, lat1: 42.3, lon0: 25.8, lon1: 45.0 };   // referansın geçerli olduğu kutu

  function valid(l) { return !!l && isFinite(l.lat) && isFinite(l.lon) && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180; }

  function segKm(p, a, b) {
    var kx = 111.32 * Math.cos(p.lat * Math.PI / 180), ky = 110.57;
    var ax = (a[1] - p.lon) * kx, ay = (a[0] - p.lat) * ky, bx = (b[1] - p.lon) * kx, by = (b[0] - p.lat) * ky;
    var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    var x = ax + t * dx, y = ay + t * dy; return Math.sqrt(x * x + y * y);
  }
  // Kıyıya en kısa mesafe (km). Referans alanı dışındaysa null (= bilinmiyor).
  function coastDistanceKm(loc) {
    if (!valid(loc)) return null;
    if (loc.lat < COVER.lat0 || loc.lat > COVER.lat1 || loc.lon < COVER.lon0 || loc.lon > COVER.lon1) return null;
    var best = Infinity;
    COAST.forEach(function (ch) { for (var i = 0; i + 1 < ch.length; i++) { var d = segKm(loc, ch[i], ch[i + 1]); if (d < best) best = d; } });
    return best;
  }

  function marineSuitability(loc) {
    var d = coastDistanceKm(loc);
    if (d == null) return { available: false, confidence: 'low', reason: 'Bu bölge için kıyı referansı yok (şimdilik yalnızca Türkiye çevresi tanımlı).', coastKm: null };
    if (d <= 10) return { available: true, confidence: 'high', reason: 'Kıyıya yakın (~' + Math.round(d) + ' km).', coastKm: Math.round(d) };
    if (d <= CFG.COAST_KM) return { available: true, confidence: 'medium', reason: 'Kıyıya orta uzaklıkta (~' + Math.round(d) + ' km).', coastKm: Math.round(d) };
    return { available: false, confidence: 'high', reason: 'Kıyıdan uzak (~' + Math.round(d) + ' km): deniz verisi anlamlı değil.', coastKm: Math.round(d) };
  }

  function global(loc) {
    return valid(loc) ? { available: true, confidence: 'high', reason: 'Küresel model; geçerli koordinat.' } : { available: false, confidence: 'high', reason: 'Geçersiz koordinat.' };
  }
  function floodState(loc, ctx) {
    if (!valid(loc)) return { available: false, confidence: 'high', reason: 'Geçersiz koordinat.' };
    var v = ctx && ctx.floodVerdict;
    if (v && v.available === true) return { available: true, confidence: v.confidence || 'medium', reason: v.reason || 'Önceden doğrulandı.' };
    if (v && v.available === false) return { available: false, confidence: v.confidence || 'medium', reason: v.reason || 'Uygun nehir eşleşmesi bulunamadı.' };
    return { available: false, confidence: 'low', reason: 'Henüz doğrulanmadı: nehir eşleşmesi flood modülünün uygunluk kontrolünden geçmedi.' };
  }

  function explainAdvancedCapabilities(loc, ctx) {
    var d = { ensemble: global(loc), climate: global(loc), seasonal: global(loc), marine: valid(loc) ? marineSuitability(loc) : global(loc), flood: floodState(loc, ctx) };
    return {
      ensemble: d.ensemble.available, flood: d.flood.available, climate: d.climate.available, seasonal: d.seasonal.available, marine: d.marine.available, details: d
    };
  }
  function getAdvancedCapabilities(loc, ctx) {
    var e = explainAdvancedCapabilities(loc, ctx);
    return { ensemble: e.ensemble, flood: e.flood, climate: e.climate, seasonal: e.seasonal, marine: e.marine };
  }

  var Cap = { getAdvancedCapabilities: getAdvancedCapabilities, explainAdvancedCapabilities: explainAdvancedCapabilities, coastDistanceKm: coastDistanceKm, marineSuitability: marineSuitability, COVER: COVER };
  g.AdvCapability = Cap;
  if (typeof module !== 'undefined' && module.exports) module.exports = Cap;
})(typeof window !== 'undefined' ? window : globalThis);

;
/* ENSEMBLE: tahmin güveni için model topluluğu (çok üyeli) yayılımı.
   API: https://ensemble-api.open-meteo.com/v1/ensemble — TEK bir ensemble modelinin üyeleri kullanılır; tekil (deterministik) tahminle karıştırılmaz.
   Çıktı sayısal "%güven" DEĞİL; yalnızca yayılım (spread) ve üç kademe (high/medium/low). Eşikler kaba ve kalibre edilmemiştir (aşağıda).
   Doğrulama notu: üye anahtar adları (`temperature_2m_member01`…) Open-Meteo belgesinde açıkça listelenmiyor; ayrıştırıcı bu kalıba göre yazıldı,
   canlı yanıtla doğrulanmadı. Kalıp tutmazsa "unavailable" döner, uydurma sonuç üretilmez. */
'use strict';
(function (g) {
  var Core = g.AdvCore || require('./core.js');
  var CFG = {
    model: 'ecmwf_ifs025',      // 51 üyeli küresel ensemble (belge: ECMWF IFS 0.25°, 15 gün). Değiştirilebilir.
    days: 5,
    minMembers: 10,            // bundan az üye "ensemble" sayılmaz
    minHours: 12,              // bir günün hesaba girmesi için gereken saat sayısı
    // Gün içi yayılım (üyeler arası standart sapma) → kademe. Kaba/sezgisel eşikler: [high için ≤, medium için ≤]; üstü low.
    th: { temp: [1.5, 3], precip: [1, 4], wind: [3, 6] }   // °C · mm (günlük toplam) · km/sa (günlük ortalama)
  };
  var VARS = [['temperature_2m', 'temp'], ['precipitation', 'precip'], ['wind_speed_10m', 'wind']];
  var SCORE = { high: 2, medium: 1, low: 0 }, NAME = ['low', 'medium', 'high'];

  function level(v, th) { return v == null ? null : v <= th[0] ? 'high' : v <= th[1] ? 'medium' : 'low'; }
  function worst(a) { var m = 2; a.forEach(function (x) { if (x != null && SCORE[x] < m) m = SCORE[x]; }); return a.some(function (x) { return x != null; }) ? NAME[m] : null; }

  function members(h, name) {
    var re = new RegExp('^' + name + '(_member\\d+)?$'), out = [];
    Object.keys(h).forEach(function (k) { if (re.test(k) && Array.isArray(h[k])) out.push(h[k]); });
    return out;
  }

  function parse(j) {
    var h = j && j.hourly;
    if (!h || !Array.isArray(h.time)) return { unavailable: 'no-data' };
    var series = {}, n = Infinity;
    VARS.forEach(function (v) { series[v[1]] = members(h, v[0]); n = Math.min(n, series[v[1]].length); });
    if (n < CFG.minMembers) return { unavailable: 'Yeterli ensemble üyesi yok (' + (isFinite(n) ? n : 0) + '); tek model ensemble sayılmaz.', meta: { members: isFinite(n) ? n : 0 } };

    var byDay = {};
    h.time.forEach(function (t, i) { var d = String(t).slice(0, 10); (byDay[d] = byDay[d] || []).push(i); });
    var days = Object.keys(byDay).sort().map(function (d) {
      var idx = byDay[d]; if (idx.length < CFG.minHours) return null;
      var o = { date: d }, lv = [];
      VARS.forEach(function (v) {
        var key = v[1], per = series[key].map(function (arr) {
          var vals = Core.nums(idx.map(function (i) { return arr[i]; }));
          if (vals.length < idx.length * 0.75) return null;
          if (key === 'precip') { var s = 0; vals.forEach(function (x) { s += x; }); return s; }   // günlük toplam
          return Core.mean(vals);                                                                    // günlük ortalama
        });
        var sd = Core.std(per); o[key + 'Spread'] = Core.r(sd, 1);
        lv.push(level(sd, CFG.th[key]));
      });
      o.confidence = worst(lv); return o.confidence ? o : null;
    }).filter(Boolean).slice(0, CFG.days);
    if (!days.length) return { unavailable: 'no-days' };

    var near = days.slice(0, 3);
    function avg(k) { return Core.r(Core.mean(near.map(function (d) { return d[k]; })), 1); }
    var sc = Core.mean(near.map(function (d) { return SCORE[d.confidence]; }));
    return {
      data: { temperatureSpread: avg('tempSpread'), precipitationSpread: avg('precipSpread'), windSpread: avg('windSpread'), confidence: NAME[Math.floor(sc + 1e-9)], days: days },
      meta: { members: n, model: CFG.model, units: { temperatureSpread: '°C (üyeler arası std)', precipitationSpread: 'mm (günlük toplam, std)', windSpread: 'km/sa (günlük ortalama, std)' },
        note: 'Güven kademesi kaba eşiklerle hesaplanır; yüzde olasılık değildir.', verified: false }
    };
  }

  var mod = {
    name: 'ensemble', source: 'open-meteo', version: 1,
    applicable: function (loc) { return Core.validLoc(loc) ? { ok: true } : { ok: false, reason: 'bad-location' }; },
    key: function (loc) { return Core.locKey(loc, 1) + ':' + CFG.model; },        // ensemble ızgarası kaba: 0,1° ≈ 11 km
    url: function (loc) {
      return 'https://ensemble-api.open-meteo.com/v1/ensemble?' + Core.qs({ latitude: loc.lat.toFixed(2), longitude: loc.lon.toFixed(2), hourly: 'temperature_2m,precipitation,wind_speed_10m',
        models: CFG.model, forecast_days: CFG.days, timezone: 'auto', wind_speed_unit: 'kmh' });
    },
    parse: parse, CFG: CFG
  };
  g.AdvEnsemble = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis);

;
/* FLOOD: nehir debisi (GloFAS, Open-Meteo Flood API). YANLIŞ POZİTİF ÜRETMEMEK İÇİN önce "uygunluk (suitability)" kararı verilir.
   API: https://flood-api.open-meteo.com/v1/flood — belgeye göre istek noktasının ~5 km çevresindeki EN BÜYÜK nehre eşler; yanıttaki
   latitude/longitude seçilen hücrenin merkezidir. API her konumda sayı döndürebilir; bu yüzden "cevap verdi" ≠ "anlamlı".
   Suitability: { available, confidence:'low'|'medium'|'high', reason }. available yalnızca medium/high için true.
   Ölçütler: (1) eşlenen hücre isteğe yeterince yakın mı, (2) akım gerçek bir akarsu için yeterince büyük mü,
   (3) kıyı/şehir merkezi gibi şüpheli eşleşme süzgeci (kıyıya çok yakın + küçük akım → reddedilir).
   Bu modül henüz arayüze bağlı değildir ve herhangi bir risk/uyarı sınıfı üretmez (klimatoloji eşiği olmadan "taşkın" denemez). */
'use strict';
(function (g) {
  var Core = g.AdvCore || require('./core.js');
  var Cap = g.AdvCapability || require('./capability.js');
  var CFG = {
    days: 10,
    maxSnapKm: 12,                       // eşlenen hücre merkezi bundan uzaksa reddet
    highSnapKm: 4, mediumSnapKm: 8,
    minMean: 2,                          // m³/s: altı "anlamlı akarsu yok"
    mediumMean: 8, highMean: 30,
    coastNearKm: 5, coastMinMean: 50     // kıyıya ≤5 km ve ortalama akım <50 m³/s → şehir merkezi/kıyı eşleşmesi şüpheli
  };

  function distKm(a, b) {
    var kx = 111.32 * Math.cos(a.lat * Math.PI / 180), dx = (a.lon - b.lon) * kx, dy = (a.lat - b.lat) * 110.57; return Math.sqrt(dx * dx + dy * dy);
  }
  function no(reason, extra) { var r = { available: false, confidence: 'low', reason: reason }; for (var k in (extra || {})) r[k] = extra[k]; return r; }

  // Saf karar fonksiyonu (test edilir). j: Flood API yanıtı.
  function suitability(loc, j) {
    var vals = Core.nums(j && j.daily && j.daily.river_discharge || []);
    if (!vals.length) return no('Bu noktada nehir verisi yok.');
    var cell = { lat: j.latitude, lon: j.longitude };
    var snap = isFinite(cell.lat) && isFinite(cell.lon) ? distKm(loc, cell) : null;
    var mean = Core.mean(vals);
    var base = { snapKm: snap == null ? null : Core.r(snap, 1), meanDischarge: Core.r(mean, 1) };
    if (snap == null) return no('Eşlenen nehir hücresinin konumu bilinmiyor.', base);
    if (snap > CFG.maxSnapKm) return no('Eşlenen nehir hücresi uzak (~' + Math.round(snap) + ' km).', base);
    if (mean < CFG.minMean) return no('Akım çok küçük (' + base.meanDischarge + ' m³/s): anlamlı bir akarsu değil.', base);
    var coast = Cap.coastDistanceKm(loc);
    if (coast != null && coast <= CFG.coastNearKm && mean < CFG.coastMinMean) return no('Kıyıya çok yakın ve akım küçük: kıyı/şehir merkezi eşleşmesi şüpheli.', base);
    var conf = snap <= CFG.highSnapKm && mean >= CFG.highMean ? 'high' : snap <= CFG.mediumSnapKm && mean >= CFG.mediumMean ? 'medium' : 'low';
    if (conf === 'low') return no('Zayıf eşleşme (hücre ~' + Math.round(snap) + ' km, ortalama akım ' + base.meanDischarge + ' m³/s).', base);
    var r = { available: true, confidence: conf, reason: 'Yakın nehir hücresi (~' + Math.round(snap) + ' km), ortalama akım ' + base.meanDischarge + ' m³/s.' };
    for (var k in base) r[k] = base[k]; return r;
  }

  function parse(j, loc) {
    var s = suitability(loc, j);
    if (!s.available) return { unavailable: s.reason, meta: { suitability: s } };
    var d = j.daily, t = d.time || [], q = d.river_discharge, v = Core.nums(q), peak = -Infinity, pi = 0;
    q.forEach(function (x, i) { if (typeof x === 'number' && x > peak) { peak = x; pi = i; } });
    var a = Core.mean(q.slice(0, 3)), b = Core.mean(q.slice(-3));
    var trend = a == null || b == null || a === 0 ? 'steady' : (b - a) / a > 0.15 ? 'rising' : (b - a) / a < -0.15 ? 'falling' : 'steady';
    return {
      data: { suitability: s, cell: { lat: j.latitude, lon: j.longitude }, discharge: { now: Core.r(v[0], 1), mean: Core.r(Core.mean(v), 1), peak: Core.r(peak, 1), peakDate: t[pi] || null, trend: trend, unit: 'm³/s' } },
      meta: { suitability: s, days: v.length, verified: false, note: 'Taşkın riski/uyarı sınıfı üretilmez; yalnızca modellenmiş akım özeti.' }
    };
  }

  var mod = {
    name: 'flood', source: 'open-meteo', version: 1, probe: true,
    applicable: function (loc) { return Core.validLoc(loc) ? { ok: true } : { ok: false, reason: 'bad-location' }; },
    key: function (loc) { return Core.locKey(loc, 2); },
    url: function (loc) { return 'https://flood-api.open-meteo.com/v1/flood?' + Core.qs({ latitude: loc.lat.toFixed(2), longitude: loc.lon.toFixed(2), daily: 'river_discharge', forecast_days: CFG.days }); },
    parse: parse, suitability: suitability, CFG: CFG
  };
  g.AdvFlood = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis);

;
/* CLIMATE: uzun vadeli iklim PROJEKSİYONU (Open-Meteo Climate API; yüksek çözünürlüklü CMIP6 modelleri). Ana tahminden ve Paket 4'teki
   "geçmiş 10 yıl" (Historical/Archive API, detail.js) karşılaştırmasından tamamen AYRIDIR: farklı API, farklı önbellek, farklı anahtar.
   Çıktı bir tahmin değil model çıktısıdır: 2021–2030, 2031–2040, 2041–2050 onyıl özetleri (etiket: 2030/2040/2050).
   API: https://climate-api.open-meteo.com/v1/climate (daily: temperature_2m_mean, precipitation_sum). Belgeye göre veri 2050'ye kadar,
   yüksek emisyon senaryosuna yakın modellerdir. İstek maliyeti zaman aralığıyla orantılı olduğu için tek model + 2 değişken + 30 yıl kullanılır. */
'use strict';
(function (g) {
  var Core = g.AdvCore || require('./core.js');
  var CFG = { model: 'EC_Earth3P_HR', from: 2021, to: 2050, decades: [2030, 2040, 2050], minShare: 0.9 };

  function parse(j) {
    var d = j && j.daily;
    if (!d || !Array.isArray(d.time) || !Array.isArray(d.temperature_2m_mean)) return { unavailable: 'no-data' };
    var out = [];
    CFG.decades.forEach(function (end) {
      var from = end - 9, temps = [], psum = 0, n = 0, pn = 0;
      d.time.forEach(function (t, i) {
        var y = +String(t).slice(0, 4); if (y < from || y > end) return;
        n++;
        if (typeof d.temperature_2m_mean[i] === 'number') temps.push(d.temperature_2m_mean[i]);
        var p = d.precipitation_sum && d.precipitation_sum[i]; if (typeof p === 'number') { psum += p; pn++; }
      });
      var expect = (end - from + 1) * 365;
      if (temps.length < expect * CFG.minShare) return;
      out.push({ label: end, from: from, to: end, tempMean: Core.r(Core.mean(temps), 1), precipPerYear: pn >= expect * CFG.minShare ? Core.r(psum / (end - from + 1), 0) : null });
    });
    if (!out.length) return { unavailable: 'Projeksiyon aralığı eksik.' };
    var first = out[0], last = out[out.length - 1];
    return {
      data: { kind: 'projection', decades: out, tempChangeSpanC: out.length > 1 ? Core.r(last.tempMean - first.tempMean, 1) : null },
      meta: { model: CFG.model, units: { tempMean: '°C', precipPerYear: 'mm/yıl' }, note: 'Model projeksiyonudur, günlük tahmin değildir; geçmiş karşılaştırmasıyla karıştırılmaz.', verified: false }
    };
  }

  var mod = {
    name: 'climate', source: 'open-meteo', version: 1,
    applicable: function (loc) { return Core.validLoc(loc) ? { ok: true } : { ok: false, reason: 'bad-location' }; },
    key: function (loc) { return Core.locKey(loc, 1) + ':' + CFG.model; },        // iklim ızgarası kaba (~10–25 km)
    url: function (loc) {
      return 'https://climate-api.open-meteo.com/v1/climate?' + Core.qs({ latitude: loc.lat.toFixed(2), longitude: loc.lon.toFixed(2), start_date: CFG.from + '-01-01', end_date: CFG.to + '-12-31',
        models: CFG.model, daily: 'temperature_2m_mean,precipitation_sum' });
    },
    parse: parse, CFG: CFG
  };
  g.AdvClimate = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis);

;
/* SEASONAL: mevsimlik EĞİLİM / ANOMALİ (Open-Meteo Seasonal API, ECMWF). Günlük derece tahmini DEĞİLDİR: veri modeli yalnızca
   "normale göre fark" (anomali) ve buna bağlı eğilim etiketi taşır; mutlak sıcaklık/yağış değeri içermez.
   API: https://seasonal-api.open-meteo.com/v1/seasonal (weekly + monthly: temperature_2m_anomaly, precipitation_anomaly).
   Anomali = tahmin − model klimatolojisi (belge). Doğrulama notu: değişken adları ve model kimlikleri belgeden çıkarıldı, canlı yanıtla doğrulanmadı;
   uyuşmazlıkta API 400 verir veya anahtarlar bulunamaz → "unavailable". Üye bazlı anahtarlar (_memberNN) varsa ortalaması alınır. */
'use strict';
(function (g) {
  var Core = g.AdvCore || require('./core.js');
  var CFG = {
    days: 120, weeks: 8, months: 4,
    tempNear: 0.5,        // °C: |anomali| bundan küçükse "normale yakın"
    precipNear: 1         // birim: API'nin döndürdüğü yağış anomalisi birimi (mm); |anomali| bundan küçükse "normale yakın"
  };

  // `${base}` veya `${base}_memberNN` anahtarlarının zaman başına ortalaması
  function series(block, base) {
    var re = new RegExp('^' + base + '(_member\\d+)?$'), arrs = [];
    Object.keys(block).forEach(function (k) { if (re.test(k) && Array.isArray(block[k])) arrs.push(block[k]); });
    if (!arrs.length) return null;
    return block.time.map(function (_, i) { return Core.mean(arrs.map(function (a) { return a[i]; })); });
  }
  function dir(x, near, pos, neg) { return x == null ? null : Math.abs(x) < near ? 'near' : x > 0 ? pos : neg; }

  function block(b, limit) {
    if (!b || !Array.isArray(b.time)) return null;
    var t = series(b, 'temperature_2m_anomaly'), p = series(b, 'precipitation_anomaly');
    if (!t && !p) return null;
    var rows = b.time.slice(0, limit).map(function (d, i) {
      return { start: d, tempAnomaly: t ? Core.r(t[i], 1) : null, precipAnomaly: p ? Core.r(p[i], 1) : null };
    });
    var mt = Core.mean(rows.map(function (r) { return r.tempAnomaly; })), mp = Core.mean(rows.map(function (r) { return r.precipAnomaly; }));
    return { rows: rows, trend: { temperature: dir(mt, CFG.tempNear, 'warmer', 'cooler'), precipitation: dir(mp, CFG.precipNear, 'wetter', 'drier') },
      meanTempAnomaly: Core.r(mt, 1), meanPrecipAnomaly: Core.r(mp, 1) };
  }

  function parse(j) {
    var w = block(j && j.weekly, CFG.weeks), m = block(j && j.monthly, CFG.months);
    if (!w && !m) return { unavailable: 'Mevsimlik anomali verisi bulunamadı.' };
    return {
      data: { kind: 'anomaly', weekly: w, monthly: m },
      meta: { units: { tempAnomaly: '°C (normale göre)', precipAnomaly: 'mm (normale göre)' }, note: 'Anomali/eğilim sinyalidir; günlük tahmin değildir.', verified: false }
    };
  }

  var mod = {
    name: 'seasonal', source: 'open-meteo', version: 1,
    applicable: function (loc) { return Core.validLoc(loc) ? { ok: true } : { ok: false, reason: 'bad-location' }; },
    key: function (loc) { return Core.locKey(loc, 1); },
    url: function (loc) {
      return 'https://seasonal-api.open-meteo.com/v1/seasonal?' + Core.qs({ latitude: loc.lat.toFixed(2), longitude: loc.lon.toFixed(2),
        weekly: 'temperature_2m_anomaly,precipitation_anomaly', monthly: 'temperature_2m_anomaly,precipitation_anomaly', forecast_days: CFG.days, timezone: 'auto' });
    },
    parse: parse, CFG: CFG
  };
  g.AdvSeasonal = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis);

;
/* MARINE: dalga/deniz verisi (Open-Meteo Marine API). Yalnızca KIYIYA YAKIN konumlarda çalışır (capability.js ön süzgeci), ayrıca API'nin
   gerçekten deniz verisi döndürmesi şart: dalga yüksekliği değerlerinin çoğu null ise "unavailable".
   API: https://marine-api.open-meteo.com/v1/marine (hourly: wave_height, wave_direction, wave_period, sea_surface_temperature).
   Dalga yönü "geldiği yön"dür (0° = kuzeyden). Kıyı rüzgârı mevcut tahmin verisinden (forecast API) alınır, bu modül ayrıca istemez.
   Doğrulama notu: karaya düşen noktalarda API'nin null mı hata mı döndürdüğü belgede yazmıyor; ikisi de "unavailable" olarak ele alınır. */
'use strict';
(function (g) {
  var Core = g.AdvCore || require('./core.js');
  var Cap = g.AdvCapability || require('./capability.js');
  var CFG = { hours: 24, minShare: 0.5 };   // wave_height değerlerinin en az yarısı dolu olmalı

  function parse(j) {
    var h = j && j.hourly;
    if (!h || !Array.isArray(h.time) || !Array.isArray(h.wave_height)) return { unavailable: 'Bu nokta için deniz verisi yok.' };
    var wh = h.wave_height, ok = Core.nums(wh);
    if (!ok.length || ok.length < wh.length * CFG.minShare) return { unavailable: 'Bu nokta için deniz verisi yok (karaya düşen hücre).' };
    function at(k, i) { var a = h[k]; return Array.isArray(a) && typeof a[i] === 'number' ? a[i] : null; }
    var max = Math.max.apply(null, ok), mi = wh.indexOf(max);
    return {
      data: {
        now: { time: h.time[0], waveHeight: Core.r(at('wave_height', 0), 1), waveDirection: Core.r(at('wave_direction', 0), 0), wavePeriod: Core.r(at('wave_period', 0), 1), seaTemp: Core.r(at('sea_surface_temperature', 0), 1) },
        next24: { maxWaveHeight: Core.r(max, 1), maxWaveTime: h.time[mi] || null, meanWaveHeight: Core.r(Core.mean(ok), 1) },
        cell: { lat: j.latitude, lon: j.longitude }
      },
      meta: { hours: wh.length, units: { waveHeight: 'm', waveDirection: '° (geldiği yön)', wavePeriod: 's', seaTemp: '°C' }, verified: false }
    };
  }

  var mod = {
    name: 'marine', source: 'open-meteo', version: 1,
    applicable: function (loc) {
      if (!Core.validLoc(loc)) return { ok: false, reason: 'bad-location' };
      var s = Cap.marineSuitability(loc);
      return s.available ? { ok: true } : { ok: false, reason: s.reason, meta: { suitability: s } };
    },
    key: function (loc) { return Core.locKey(loc, 2); },
    url: function (loc) {
      return 'https://marine-api.open-meteo.com/v1/marine?' + Core.qs({ latitude: loc.lat.toFixed(2), longitude: loc.lon.toFixed(2),
        hourly: 'wave_height,wave_direction,wave_period,sea_surface_temperature', forecast_hours: CFG.hours, timezone: 'auto' });
    },
    parse: parse, CFG: CFG
  };
  g.AdvMarine = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis);

;
/* GELİŞMİŞ HAVA KALİTESİ: saatlik EAQI trendi, kötüleşme penceresi, kirletici değerleri, uygunsa polen. MEVCUT hava kalitesi kartına/hesabına DOKUNMAZ.
   Sınıflandırma yalnızca ortak EAQI (eaqi.js) ile yapılır; bu dosyada EAQI eşiği tanımlanmaz (yinelenen eşik yok).
   Kirleticiler (PM2.5, PM10, O3, NO2) ve polen için sınıf/eşik UYDURULMAZ: ham model değerleri (µg/m³, tane/m³) verilir.
   API: https://air-quality-api.open-meteo.com/v1/air-quality — polen alanları yalnızca Avrupa'da ve mevsimde dolu gelir; null olanlar atlanır. */
'use strict';
(function (g) {
  var Core = g.AdvCore || require('./core.js');
  var E = g.EAQI || (typeof require === 'function' ? require('../eaqi.js') : null);
  var CFG = { hours: 36, ahead: 24, trendHours: 6, trendDelta: 10 };   // trendDelta: EAQI puanı farkı (sınıf eşiği değil; yalnızca "belirgin değişim")
  var POLLEN = ['alder_pollen', 'birch_pollen', 'grass_pollen', 'mugwort_pollen', 'olive_pollen', 'ragweed_pollen'];
  var POLL = [['pm2_5', 'pm25'], ['pm10', 'pm10'], ['ozone', 'o3'], ['nitrogen_dioxide', 'no2']];

  function parse(j) {
    var h = j && j.hourly;
    if (!h || !Array.isArray(h.time) || !Array.isArray(h.european_aqi)) return { unavailable: 'no-data' };
    var ct = j.current && j.current.time ? String(j.current.time).slice(0, 13) : null, i0 = 0;
    if (ct) { for (var i = 0; i < h.time.length; i++) if (String(h.time[i]).slice(0, 13) === ct) { i0 = i; break; } }
    var v0 = h.european_aqi[i0];
    if (typeof v0 !== 'number') return { unavailable: 'Şu an için EAQI değeri yok.' };
    var lv0 = E.level(v0), n = Math.min(CFG.ahead, h.time.length - i0 - 1), series = [], peak = { v: v0, i: 0 };
    for (var k = 0; k <= n; k++) {
      var v = h.european_aqi[i0 + k]; if (typeof v !== 'number') continue;
      series.push({ t: h.time[i0 + k], v: E.round(v), level: E.level(v) });
      if (v > peak.v) peak = { v: v, i: k };
    }
    // kötüleşme penceresi: şimdikinden daha kötü SINIFA geçilen ilk kesintisiz aralık
    var win = null, w0 = -1;
    for (var q = 0; q < series.length; q++) if (series[q].level > lv0) { w0 = q; break; }
    if (w0 >= 0) {
      var w1 = w0, mx = series[w0].level;
      while (w1 + 1 < series.length && series[w1 + 1].level > lv0) { w1++; if (series[w1].level > mx) mx = series[w1].level; }
      win = { from: series[w0].t, to: series[w1].t, level: mx, label: E.LABEL[mx] };
    }
    var ahead = series.length > CFG.trendHours ? series[CFG.trendHours].v - series[0].v : (series.length > 1 ? series[series.length - 1].v - series[0].v : 0);
    var cur = j.current || {}, pol = {};
    POLL.forEach(function (p) { var x = cur[p[0]]; if (typeof x === 'number') pol[p[1]] = Core.r(x, 1); });
    var pollen = {}; POLLEN.forEach(function (k) { var a = h[k], x = a && a[i0]; if (typeof x === 'number') pollen[k.replace('_pollen', '')] = Core.r(x, 1); });
    return {
      data: {
        now: { eaqi: E.round(v0), level: lv0, label: E.LABEL[lv0] },
        trend: { direction: ahead >= CFG.trendDelta ? 'worsening' : ahead <= -CFG.trendDelta ? 'improving' : 'steady', delta: Math.round(ahead), hours: Math.min(CFG.trendHours, series.length - 1) },
        peak: { eaqi: E.round(peak.v), level: E.level(peak.v), label: E.LABEL[E.level(peak.v)], time: series.length ? (h.time[i0 + peak.i] || null) : null },
        worseningWindow: win, pollutants: pol, pollen: Object.keys(pollen).length ? pollen : null, series: series
      },
      meta: { units: { pollutants: 'µg/m³', pollen: 'tane/m³' }, note: 'EAQI sınıfı ortak eaqi.js ile; kirletici/polen için sınıf uydurulmaz.', verified: false }
    };
  }

  var mod = {
    name: 'airquality', source: 'open-meteo', version: 1,
    applicable: function (loc) { return Core.validLoc(loc) ? { ok: true } : { ok: false, reason: 'bad-location' }; },
    key: function (loc) { return Core.locKey(loc, 2); },
    url: function (loc) {
      return 'https://air-quality-api.open-meteo.com/v1/air-quality?' + Core.qs({ latitude: loc.lat.toFixed(2), longitude: loc.lon.toFixed(2),
        current: 'european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide', hourly: 'european_aqi,' + POLLEN.join(','), forecast_hours: CFG.hours, timezone: 'auto' });
    },
    parse: parse, CFG: CFG
  };
  g.AdvAirQuality = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis);

;
/* Gelişmiş veri modülleri — tek giriş noktası (window.Advanced). Uygulama açılışında YÜKLENMEZ ve hiçbir ağ isteği yapmaz;
   ileride bir arayüz bunu lazy yükleyecek. Şu an hiçbir kod advanced.js'i yüklemez ve hiçbir modül kullanıcı arayüzüne bağlı değildir.
     Advanced.capabilities(loc)      → { ensemble, flood, climate, seasonal, marine } (ağ yok)
     Advanced.explain(loc)           → aynısı + details (gerekçe/güven)
     Advanced.load(name, loc, opts)  → Promise<{status,data,fetchedAt,stale,source,meta}> (bayrak kapalıysa ağsız 'unavailable/disabled')
     Advanced.setFlag(name, on)      → test/geliştirme için modülü açar (yalnızca bellekte, kalıcı değildir)
     Advanced.cancel(name?)          → şehir değişiminde bekleyen istekleri iptal eder */
'use strict';
(function (g) {
  var CFG = g.AdvConfig || require('./config.js');
  var Core = g.AdvCore || require('./core.js');
  var Cap = g.AdvCapability || require('./capability.js');
  var MODS = {
    ensemble: g.AdvEnsemble || require('./ensemble.js'), flood: g.AdvFlood || require('./flood.js'), climate: g.AdvClimate || require('./climate.js'),
    seasonal: g.AdvSeasonal || require('./seasonal.js'), marine: g.AdvMarine || require('./marine.js'), airquality: g.AdvAirQuality || require('./airquality.js')
  };

  function create(rt) {
    rt = rt || Core.createRuntime();
    var A = {
      runtime: rt, modules: MODS, config: CFG, tier: CFG.TIER,
      isOn: rt.isOn, setFlag: rt.setFlag, cancel: rt.cancel,
      flags: function () { return Core.copy(rt.flags); },
      ctx: function (loc) { var v = rt.readCached(MODS.flood, loc); return { floodVerdict: v ? (v.status === 'ok' ? v.data.suitability : v.meta && v.meta.suitability) : null }; },
      capabilities: function (loc) { return Cap.getAdvancedCapabilities(loc, A.ctx(loc)); },
      explain: function (loc) { return Cap.explainAdvancedCapabilities(loc, A.ctx(loc)); },
      load: function (name, loc, opts) {
        var m = MODS[name];
        if (!m) return Promise.resolve({ status: 'unavailable', module: name, data: null, fetchedAt: null, stale: false, source: 'open-meteo', meta: { reason: 'unknown-module' } });
        return rt.run(m, loc, opts);
      },
      create: create
    };
    return A;
  }

  var Advanced = create();
  g.Advanced = Advanced;
  if (typeof module !== 'undefined' && module.exports) module.exports = Advanced;
})(typeof window !== 'undefined' ? window : globalThis);

