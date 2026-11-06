/* EYRIVO geri bildirim (0.8): "Hava doğru mu?" ve "Bu öneri uygun mu?" — yalnızca butonlarla, yazı yok, kullanıcı bilgisi yok.
   Geri bildirim hava tahminini DEĞİŞTİRMEZ; Open-Meteo verisinden ayrı bir "EYRIVO gözlem katmanı" olarak Worker'a (/feedback) gönderilir.
   Aynı cihazdan aynı tür/konum/hava için 12 dk içinde tekrar gönderilmez (sakin mesaj). Çevrimdışıyken yerel sıraya alınır, bağlantı gelince gönderilir.
   0.8.1: Aynı cihazın kısa sürede birden çok kez "oy" vermesini önlemek için kayda GÜNLÜK dönen rastgele bir jeton eklenir (cihazda saklanır; kişisel bilgi değil,
   bir hesapla/servisle eşleşmez, takip/reklam için kullanılmaz). Sunucu onu gün+tuzla hash'ler, ham değeri saklamaz.
   Saf yardımcılar (seçenek seçimi, cooldown, kayıt kurma) tarayıcısız test edilebilir (module.exports). */
'use strict';
(function (g) {
  var CD_MS = 12 * 60 * 1000;                 // aynı tür geri bildirim bekleme süresi
  var Q_MAX = 20, Q_TTL = 24 * 3600 * 1000;   // çevrimdışı sıra: en çok 20 kayıt, 24 saatten eskisi atılır
  var KEY_CD = 'hd2:fb:cd', KEY_Q = 'hd2:fb:q', KEY_DEV = 'hd2:fb:dev';
  var MAX_PER_SCREEN = 6;                     // bir ekranda en çok bu kadar seçenek

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  // ---------- Hava durumu sınıfı ----------
  function kindOf(code) {
    if (code === null) return 'unknown';
    if (code >= 95) return 'storm';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if (code === 45 || code === 48) return 'fog';
    if (code <= 1) return 'clear';
    if (code === 2) return 'partly';
    return 'cloud';
  }

  // ---------- Seçenek seçimi (bağlama uygun, ekran başına en çok 6) ----------
  // s: { code, temp, feels, precip, pop, wind, gust, rainFirst }. Dönüş: { options:[{id,label}], more:[{id,label}] }
  function weatherOptions(s) {
    s = s || {};
    var code = num(s.code), kind = kindOf(code), t = num(s.temp), pop = num(s.pop) || 0, w = num(s.wind) || 0, rf = num(s.rainFirst);
    var wet = kind === 'rain' || kind === 'snow' || kind === 'storm';
    var imminent = !wet && ((rf !== null && rf >= 0 && rf <= 2) || pop >= 60);
    var o = [];
    function add(id, label) { o.push({ id: id, label: label }); }
    // yağış grubu: yalnızca gösterilen duruma uygun olanlar
    if (wet) {
      add('precip_none', kind === 'snow' ? 'Şu an kar yağmıyor' : kind === 'storm' ? 'Şu an fırtına yok' : 'Şu an yağmıyor');   // anlık gözlem: tahminin tamamen yanlış olduğu iddia edilmez
      add('precip_lighter', 'Daha hafif');
      add('precip_heavier', 'Daha kuvvetli');
    } else if (imminent) {
      add('rain_not_yet', 'Daha başlamadı');
      add('rain_started', 'Yağmur başladı');
      if (t !== null && t <= 6) add('snow', 'Kar yağıyor');
    } else {
      add('rain_started', 'Yağmur başladı');
      if (t !== null && t <= 6) add('snow', 'Kar yağıyor');
      if (code !== null && code >= 3 || pop >= 40) { if (t === null || t <= 30) add('hail', 'Dolu var'); }
    }
    // genel grup
    add('warmer', 'Hava daha sıcak');
    add('colder', 'Hava daha soğuk');
    add('wind_up', 'Rüzgâr daha güçlü');
    if (w >= 15) add('wind_down', 'Rüzgâr daha zayıf');
    if (kind === 'fog') add('fog_none', 'Şu an sis yok');
    else if (kind !== 'storm') add('fog', 'Sis var');
    if (kind === 'cloud' || kind === 'partly') add('clearer', 'Hava daha açık');
    if (kind === 'clear' || kind === 'partly') add('cloudier', 'Hava daha kapalı');
    // gösterim: ilk ekran en çok 6; kalanlar "Diğer" ile ikinci ekranda
    if (o.length <= MAX_PER_SCREEN) return { options: o, more: [] };
    return { options: o.slice(0, MAX_PER_SCREEN - 1), more: o.slice(MAX_PER_SCREEN - 1, MAX_PER_SCREEN - 1 + MAX_PER_SCREEN) };
  }

  // Öneri geri bildirimi: "Yetersiz" seçilince hazır seçenekler (giyim/yağış/rüzgâr bağlamına göre, 2–5 adet)
  function adviceOptions(s, tip) {
    s = s || {};
    var code = num(s.code), kind = kindOf(code), f = num(s.feels), pop = num(s.pop) || 0, w = num(s.wind) || 0, gu = num(s.gust) || 0, rf = num(s.rainFirst);
    var rainish = kind === 'rain' || kind === 'storm' || pop >= 40 || (rf !== null && rf >= 0 && rf <= 6) || !!(tip && tip.gear);
    var o = [];
    function add(id, label) { o.push({ id: id, label: label }); }
    if (rainish) add('raincoat', 'Yağmurluk gerekli');
    if (f === null || f <= 22) add('thicker', 'Daha kalın giyinmeli');
    if (rainish) add('umbrella', 'Şemsiye gerekli');
    if (w >= 15 || gu >= 30) add('windbreaker', 'Rüzgârlık gerekli');
    if (f === null || f >= 14) add('cooler', 'Daha serin giyinmeli');
    if (!o.length || (o.length < 2 && !(f !== null && (f >= 24 || f <= 10)))) {   // en az 2 seçenek; ama sıcakta "kalın giyin" / soğukta "serin giyin" gibi mantıksız seçenek eklenmez
      var has = function (id) { return o.some(function (x) { return x.id === id; }); };
      if (!has('thicker') && (f === null || f < 24)) add('thicker', 'Daha kalın giyinmeli');
      if (!has('cooler') && (f === null || f > 10)) add('cooler', 'Daha serin giyinmeli');
    }
    return o.slice(0, 5);
  }
  // Giyim/yağış/rüzgâr/güneş öneri çipleri "Yetersiz" için hazır seçenek sunar; uyarı çipleri (fırtına, buzlanma, hava kirliliği…) doğrudan kaydedilir.
  var GEAR_ICONS = { umbrella: 1, jacket: 1, sun: 1, thermo: 1, wind: 1 };
  function tipHasFollowUp(tip) { return !!(tip && (tip.gear || GEAR_ICONS[tip.i])); }

  // ---------- Cooldown ----------
  function cdKey(type, locId, code, tipKey) { return [type, locId || '', code === null || code === undefined ? '' : code, tipKey || ''].join('|'); }
  function cdActive(map, key, now) { return !!(map && map[key] && now - map[key] < CD_MS && now >= map[key]); }
  function cdPrune(map, now) { var o = {}; Object.keys(map || {}).forEach(function (k) { if (now - map[k] < CD_MS && now >= map[k]) o[k] = map[k]; }); return o; }

  // ---------- Kayıt (anonim: ad/e-posta/profil yok; konum yaklaşık = 2 ondalık ≈ 1 km) ----------
  function r2(v) { v = num(v); return v === null ? null : Math.round(v * 100) / 100; }
  function r1(v) { v = num(v); return v === null ? null : Math.round(v * 10) / 10; }
  function cut(v, n) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').slice(0, n) : null; }
  // Konum alanları: hem kayıt hem /observations sorgusu AYNI işlevi kullanır (bölge eşleşmesi buna bağlı)
  function locFields(c) {
    c = c || {};
    return {
      province: cut(c.prov || (c.mah || c.dist ? '' : c.admin) || '', 40) || null,
      district: cut(c.dist || (c.prov ? c.name : '') || '', 40) || null,
      neighborhood: c.mah ? cut(c.name, 60) : null,
      lat: r2(c.lat), lon: r2(c.lon)
    };
  }
  // Günlük dönen anonim cihaz jetonu: { d: UTC günü, t: rastgele 32 onaltılık }. Gün değişince yenilenir (kalıcı kimlik yok).
  function devToken(now, store) {
    var day = new Date(now).toISOString().slice(0, 10), cur = store && store.get();
    if (cur && cur.d === day && typeof cur.t === 'string' && /^[0-9a-f]{32}$/.test(cur.t)) return cur.t;
    var t = '', i, a = null;
    try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) { a = new Uint8Array(16); crypto.getRandomValues(a); } } catch (e) { a = null; }
    for (i = 0; i < 16; i++) { var b = a ? a[i] : Math.floor(Math.random() * 256); t += (b < 16 ? '0' : '') + b.toString(16); }
    if (store) store.set({ d: day, t: t });
    return t;
  }
  function buildRecord(snap, type, answer, detail, tip, now, dev) {
    snap = snap || {}; var c = snap.city || {}, L = locFields(c);
    return {
      v: 1,
      timestamp: new Date(now).toISOString(),
      location_id: cut(c.id, 80),
      province: L.province, district: L.district, neighborhood: L.neighborhood,
      lat: L.lat, lon: L.lon,
      dev: dev || null,
      weather_code: num(snap.code), temperature: r1(snap.temp), apparent_temperature: r1(snap.feels),
      precipitation: r1(snap.precip), precipitation_probability: num(snap.pop) === null ? null : Math.round(snap.pop),
      wind_speed: r1(snap.wind), wind_gust: r1(snap.gust),
      shown_text: cut(snap.text, 120),
      shown_advice: (snap.advice || []).slice(0, 3).map(function (a) { return cut(a, 120); }),
      feedback_type: type, answer: answer, detail: detail || null,
      tip_key: tip ? cut(tip.key || null, 40) : null, tip_text: tip ? cut(tip.shown || tip.long, 120) : null
    };
  }

  // ---------- Yerel depo ----------
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* sorun değil */ } return null; }
  function jget(k, d) { try { var v = JSON.parse(ls(k) || 'null'); return v === null || v === undefined ? d : v; } catch (e) { return d; } }
  function qRead(now) { var q = jget(KEY_Q, []); return Array.isArray(q) ? q.filter(function (r) { return r && r.timestamp && now - Date.parse(r.timestamp) < Q_TTL; }).slice(-Q_MAX) : []; }
  function qWrite(q) { ls(KEY_Q, q.length ? JSON.stringify(q.slice(-Q_MAX)) : null); }

  var pure = { locFields: locFields, devToken: devToken, kindOf: kindOf, weatherOptions: weatherOptions, adviceOptions: adviceOptions, tipHasFollowUp: tipHasFollowUp, cdKey: cdKey, cdActive: cdActive, cdPrune: cdPrune, buildRecord: buildRecord, CD_MS: CD_MS, Q_MAX: Q_MAX, Q_TTL: Q_TTL, MAX_PER_SCREEN: MAX_PER_SCREEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ===================================================================================================
  //  Arayüz (alt panel)
  // ===================================================================================================
  var C = null, P = { wrap: null, body: null, open: false, flow: null, opener: null, timer: 0, busy: false };
  var BASE = function () { return (g.HD_PUSH_URL || '').replace(/\/+$/, ''); };
  var TICK = '<svg class="fb-tick" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.500"/></svg>';

  function head(title, sub) {
    return '<header class="sh-head"><span class="sh-sp" aria-hidden="true"></span><div class="sh-title"><h2 id="fbTitle">' + C.esc(title) + '</h2>' + (sub ? '<p>' + C.esc(sub) + '</p>' : '') + '</div>' +
      '<button type="button" class="sh-x" data-close aria-label="Kapat">' + C.uiIcon('close', 20) + '</button></header>';
  }
  function optsHtml(list, extra) {
    return '<div class="fb-grid' + (list.length <= 3 ? ' few' : '') + '" role="group" aria-label="Seçenekler">' + list.map(function (o) { return '<button type="button" class="fb-opt" data-opt="' + o.id + '">' + C.esc(o.label) + '</button>'; }).join('') + '</div>' + (extra || '');
  }
  function snapNow() { return C && C.feedbackSnap ? C.feedbackSnap() : null; }
  function render() {
    var f = P.flow; if (!f) return;
    var s = f.snap, html;
    if (f.step === 'thanks') {
      html = head('', '') + '<div class="fb-thanks" role="status" aria-live="polite">' + TICK + '<p>' + C.esc(f.msg) + '</p>' +
        (f.what ? '<p class="fb-what">' + C.esc(f.what) + '</p>' : '') + '<p class="fb-use">Bu bilgi EYRIVO’nun tahmin doğruluğunu ve önerilerini geliştirmek için kullanılır.</p></div>';
    } else if (f.type === 'weather') {
      var sub = s ? (s.text ? s.text + (s.city ? ' · ' + (s.city.name || '') : '') : '') : '';
      if (f.step === 'ask') html = head('Hava doğru mu?', sub) + '<div class="fb-yn"><button type="button" class="fb-opt yes" data-ans="yes">Evet</button><button type="button" class="fb-opt no" data-ans="no">Hayır</button></div>';
      else {
        var wo = weatherOptions(s), list = f.more ? wo.more : wo.options;
        html = head('Ne farklı?', 'Gerçekte nasıl?') + optsHtml(list, !f.more && wo.more.length ? '<button type="button" class="fb-more" data-more>Diğer</button>' : '');
      }
    } else {
      var tip = f.tip;
      if (f.step === 'ask') html = head('Bu öneri uygun mu?', tip ? tip.long : '') + '<div class="fb-yn three"><button type="button" class="fb-opt yes" data-ans="suitable">Uygun</button><button type="button" class="fb-opt mid" data-ans="insufficient">Yetersiz</button><button type="button" class="fb-opt no" data-ans="unnecessary">Gereksiz</button></div>';
      else html = head('Ne eksik?', tip ? tip.long : '') + optsHtml(adviceOptions(s, tip));
    }
    P.body.innerHTML = html;
    var first = P.body.querySelector('.fb-opt, .fb-more, .sh-x'); if (first) first.focus({ preventScroll: true });
  }
  function openFlow(type, snap, tip, opener) {
    if (!P.wrap) return;
    document.dispatchEvent(new CustomEvent('hd2:sheet', { detail: 'fb' }));   // aynı anda tek alt panel
    clearTimeout(P.timer);
    P.flow = { type: type, step: 'ask', snap: snap, tip: tip || null, more: false, msg: '' };
    if (opener) P.opener = opener;
    if (!P.open) {   // (kapanma animasyonu sürerken yeniden açılırsa da çalışsın: hidden değil, açık bayrağına bakılır)
      P.wrap.hidden = false; void P.wrap.offsetWidth; P.wrap.classList.add('open'); P.open = true;
      document.documentElement.classList.add('lock');
      C.app.setAttribute('aria-hidden', 'true'); if ('inert' in C.app) C.app.inert = true;
    }
    render();   // panel görünür olduktan sonra çizilir: odak gerçekten panele geçer
  }
  function close(silent) {
    if (!P.wrap || P.wrap.hidden) return;
    clearTimeout(P.timer);
    P.wrap.classList.remove('open'); P.open = false; P.flow = null;
    document.documentElement.classList.remove('lock');
    C.app.removeAttribute('aria-hidden'); if ('inert' in C.app) C.app.inert = false;
    var done = function () { if (!P.open) { P.wrap.hidden = true; P.wrap.querySelector('.sheet').style.transform = ''; } };
    if (C.reduceMotion() || silent) done(); else setTimeout(done, 260);
    if (!silent && P.opener && document.contains(P.opener)) P.opener.focus();
  }
  document.addEventListener('hd2:sheet', function (e) { if (e.detail !== 'fb') close(true); });

  // ---------- Gönderim ----------
  function post(rec) {
    var b = BASE(); if (!b || typeof fetch !== 'function') return Promise.reject(new Error('adres yok'));
    return fetch(b + '/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) });
  }
  var flushing = false;
  function flush() {
    if (flushing || !BASE() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return Promise.resolve(0);
    var q = qRead(Date.now()); if (!q.length) return Promise.resolve(0);
    flushing = true;
    var sent = 0;
    function next(i) {
      if (i >= q.length) return Promise.resolve();
      return post(q[i]).then(function (r) {
        if (r.status >= 500) throw new Error('sunucu');   // geçici: sırada kalır
        sent++; return next(i + 1);                        // başarılı ya da kalıcı red (4xx): sıradan çıkar
      });
    }
    return next(0).catch(function () { /* kalanlar sırada */ }).then(function () {
      qWrite(qRead(Date.now()).slice(sent)); flushing = false; return sent;
    });
  }
  // Dönüş: Promise<'sent'|'queued'|'offline'|'cooldown'|'local'> (arayüz yalnızca sakin mesaj gösterir; hata dili yok)
  function submit(f, answer, detail) {
    var now = Date.now(), s = f.snap || {}, c = s.city || {};
    var key = cdKey(f.type, c.id, s.code === undefined ? null : s.code, f.tip && f.tip.key);
    var cd = cdPrune(jget(KEY_CD, {}), now);
    if (cdActive(cd, key, now)) return Promise.resolve('cooldown');
    cd[key] = now; ls(KEY_CD, JSON.stringify(cd));
    var rec = buildRecord(s, f.type, answer, detail, f.tip, now, devToken(now, { get: function () { return jget(KEY_DEV, null); }, set: function (v) { ls(KEY_DEV, JSON.stringify(v)); } }));
    if (!BASE()) return Promise.resolve('local');   // tek dosya sürümü: sunucu yok, gönderilemez (yerel kalır)
    var enqueue = function () { var q = qRead(now); q.push(rec); qWrite(q); };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { enqueue(); return Promise.resolve('offline'); }
    return post(rec).then(function (r) {
      if (r.status >= 500) { enqueue(); return 'queued'; }
      return 'sent';
    }).catch(function () { enqueue(); return 'queued'; });
  }
  var MSG = { sent: 'Teşekkürler. Gözlemini kaydettik.', queued: 'Teşekkürler. Gözlemin kaydedildi; bağlantı düzelince gönderilecek.', cooldown: 'Teşekkürler. Bu gözlemi az önce kaydetmiştik.', local: 'Teşekkürler. Gözlemini aldık.', offline: 'Teşekkürler. Gözlemin cihazında; bağlantı gelince gönderilecek.' };
  var ANS = { yes: 'Hava doğru', suitable: 'Öneri uygun', insufficient: 'Öneri yetersiz', unnecessary: 'Öneri gereksiz' };
  // Teşekkür ekranında gösterilen kısa özet: seçilen gözlemin kendi yazısı
  function whatLabel(f, answer, detail) {
    var s = f.snap, list, i;
    if (detail) {
      list = f.type === 'weather' ? (function () { var w = weatherOptions(s); return w.options.concat(w.more); })() : adviceOptions(s, f.tip);
      for (i = 0; i < list.length; i++) if (list[i].id === detail) return list[i].label;
    }
    return ANS[answer] || '';
  }
  function finish(answer, detail) {
    var f = P.flow; if (!f || P.busy) return;
    P.busy = true;
    submit(f, answer, detail).then(function (res) {
      P.busy = false;
      if (P.flow !== f) return;   // kullanıcı bu arada kapattı
      f.step = 'thanks'; f.msg = MSG[res] || MSG.queued; f.what = whatLabel(f, answer, detail); f.result = res; render();
      P.timer = setTimeout(function () { close(); }, C.reduceMotion() ? 3000 : 3600);
    });
  }

  function bind() {
    P.wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]') || e.target.classList.contains('sheet-bg')) { close(); return; }
      var f = P.flow; if (!f) return;
      var ans = e.target.closest('[data-ans]'), opt = e.target.closest('[data-opt]');
      if (e.target.closest('[data-more]')) { f.more = true; render(); return; }
      if (ans) {
        var a = ans.dataset.ans;
        if (f.type === 'weather') { if (a === 'yes') finish('yes', null); else { f.step = 'pick'; render(); } }
        else {
          if (a === 'insufficient' && tipHasFollowUp(f.tip)) { f.step = 'pick'; render(); }
          else finish(a, null);
        }
        return;
      }
      if (opt) { finish(f.type === 'weather' ? 'no' : 'insufficient', opt.dataset.opt); }
    });
    document.addEventListener('keydown', function (e) {
      if (P.wrap.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') {
        var fo = Array.prototype.filter.call(P.wrap.querySelectorAll('button:not([disabled])'), function (b) { return b.offsetParent !== null; });
        if (!fo.length) return;
        var first = fo[0], last = fo[fo.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    var grip = C.$('fbGrip'), panel = P.wrap.querySelector('.sheet'), y0 = null, dy = 0;
    grip.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; panel.style.transition = 'none'; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; });
    function end() { if (y0 == null) return; y0 = null; panel.style.transition = ''; if (dy > 90) close(); else panel.style.transform = ''; }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  }

  // Şehir değişince açık geri bildirim kapanır (başka şehrin verisine cevap verilmesin)
  function sync() {
    if (!P.open || !P.flow) return;
    var s = snapNow(), a = P.flow.snap && P.flow.snap.city, b = s && s.city;
    if (!s || !a || !b || a.id !== b.id) close(true);
  }

  g.HDFeedback = {
    init: function (ctx) {
      C = ctx; P.wrap = C.$('fbSheet'); P.body = C.$('fbBody');
      if (P.wrap) bind();
      g.addEventListener('online', function () { flush(); });
      setTimeout(flush, 4000);   // açılışta sırada bekleyen varsa sessizce gönder
    },
    openWeather: function (opener) { var s = snapNow(); if (s) openFlow('weather', s, null, opener); },
    openAdvice: function (i, opener) { var s = snapNow(); if (!s || !s.tips || !s.tips[i]) return; openFlow('advice', s, s.tips[i], opener); },
    close: function () { close(); }, sync: sync, flush: flush,
    _state: function () { return { open: P.open, flow: P.flow ? { type: P.flow.type, step: P.flow.step } : null, queue: qRead(Date.now()).length }; },
    _pure: pure
  };
})(typeof window !== 'undefined' ? window : globalThis);
