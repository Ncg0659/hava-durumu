/* EYRIVO bölgesel gözlem özeti (0.8.1): "Bölgedeki son gözlemler" kartı + "Bölgesel Gözlemler" paneli.
   Kullanıcıların "Hava doğru mu?" geri bildirimlerinden, Worker'da (/observations) toplulaştırılmış sonuç gösterilir:
   yalnızca son 30 dk, aynı bölge, en az 5 farklı cihaz ve baskın cevap ≥ %70 olunca. Eşik sağlanmazsa kart HİÇ görünmez (boş kart yok).
   Tahmin (Open-Meteo) ile kullanıcı gözlemi iki ayrı katmandır; gözlem tahmini DEĞİŞTİRMEZ, "tahmin yanlış" denmez.
   Ham kayıt/kişi gösterilmez; yalnızca sayılar. Ana ekranı bloklamaz: açılıştan sonra tembel yüklenir, kısa süre önbelleklenir.
   Saf yardımcılar (etiket, sinyal seçimi, tahminle karşılaştırma) tarayıcısız test edilebilir (module.exports). */
'use strict';
(function (g) {
  var TTL = 3 * 60000;          // aynı bölge için en az bu kadar aralıkla sorgu
  var SHOW_MAX = 5 * 60000;     // bundan eski sonuç gösterilmez (canlı kullanıcı gözlemi: eski sonuç güncelmiş gibi durmasın)
  var ORDER = ['precip', 'fog', 'wind', 'temp'];
  var TITLE = { precip: 'Yağış', fog: 'Sis', wind: 'Rüzgâr', temp: 'Sıcaklık' };
  var SUB = { rain: 'Yağmur yağıyor', lighter: 'Yağış daha hafif', heavier: 'Yağış daha kuvvetli', snow: 'Kar yağıyor', hail: 'Dolu var' };
  var CLS = {
    precip: { dry: 'Şu an yağmıyor', wet: 'Yağış var' },
    fog: { fog: 'Sis var', clear: 'Şu an sis yok' },
    wind: { up: 'Rüzgâr daha güçlü', down: 'Rüzgâr daha zayıf' },
    temp: { warmer: 'Hava daha sıcak', colder: 'Hava daha soğuk' }
  };
  var ICON = { precip: 'umbrella', fog: 'eye', wind: 'wind', temp: 'thermo' };

  function valueLabel(cat, r) {
    if (cat === 'precip' && r.top === 'wet' && r.sub && SUB[r.sub]) return SUB[r.sub];
    return (CLS[cat] && CLS[cat][r.top]) || '';
  }
  // En anlamlı en çok 2 sinyal (öncelik: yağış, sis, rüzgâr, sıcaklık). Farklı kategoriler hiç karıştırılmaz.
  function pickSignals(cats) {
    var out = [];
    ORDER.forEach(function (k) { var r = cats && cats[k]; if (r && out.length < 2 && valueLabel(k, r)) out.push({ cat: k, label: valueLabel(k, r), n: r.n, share: r.share, r: r }); });
    return out;
  }
  function scopeLabel(scope, loc) {
    loc = loc || {};
    if (scope === 'mahalle' && loc.neighborhood && loc.district) return loc.neighborhood + ' · ' + loc.district;
    if ((scope === 'mahalle' || scope === 'ilce') && loc.district) return loc.district + ' çevresi';
    return 'Bu konumun çevresi';
  }
  // Tahminle karşılaştırma: yalnızca doğrudan karşılaştırılabilen kategoriler (yağış, sis). Dönüş: 'same' | 'diff' | null
  function compare(cats, kind) {
    if (!cats || !kind) return null;
    if (cats.precip) { var wetF = kind === 'rain' || kind === 'snow' || kind === 'storm'; return (cats.precip.top === 'wet') === wetF ? 'same' : 'diff'; }
    if (cats.fog) return (cats.fog.top === 'fog') === (kind === 'fog') ? 'same' : 'diff';
    return null;
  }
  var CMP = { same: 'Bölgesel gözlemler tahminle uyumlu.', diff: 'Bölgesel gözlemler şu anda tahminden farklı.' };
  function usable(data) { return !!(data && data.ok && data.enabled !== false && data.cats && pickSignals(data.cats).length); }

  var pure = { valueLabel: valueLabel, pickSignals: pickSignals, scopeLabel: scopeLabel, compare: compare, usable: usable, CMP: CMP, TTL: TTL, SHOW_MAX: SHOW_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  var C = null, P = { wrap: null, body: null, open: false, opener: null, cid: '' };
  var cache = {}, busy = '', backoff = {}, timer = 0;

  function base() { return (g.HD_PUSH_URL || '').replace(/\/+$/, ''); }
  function fbPure() { return (g.HDFeedback && g.HDFeedback._pure) || null; }
  function curId() { return C.state.city ? C.cityId(C.state.city) : ''; }
  function loc() { var f = fbPure(); return f && C.state.city ? f.locFields(C.state.city) : null; }
  // Gösterilecek sonuç: aynı konum + yeterince taze + eşik sağlayan kategori var
  function current() {
    var cid = curId(), e = cid && cache[cid];
    if (!e || !e.data || Date.now() - e.t > SHOW_MAX || !usable(e.data)) return null;
    return e;
  }
  function snap() { return C.feedbackSnap ? C.feedbackSnap() : null; }
  function forecastKind(s) { var f = fbPure(); return s && f && typeof s.code === 'number' ? f.kindOf(s.code) : null; }
  function offlineNote(e) { return (navigator.onLine === false || Date.now() - e.t > TTL) ? ' · Son güncelleme ' + C.esc(C.stamp(e.t)) : ''; }

  // ---------- Ana ekran kartı ----------
  function dtGo() { return '<i class="dt-go" aria-hidden="true">' + C.uiIcon('right', 14) + '</i>'; }
  function cardHtml() {
    var e = current(); if (!e) return '';
    var d = e.data, sig = pickSignals(d.cats), s = snap(), esc = C.esc, L = scopeLabel(d.scope, loc());
    var rows = sig.map(function (x) { return '<span class="ob-sig">' + esc(x.label) + ' <em>' + x.n + ' gözlem</em></span>'; }).join('');
    return '<div class="drive obs" data-obs role="button" tabindex="0" aria-haspopup="dialog" aria-label="' + esc('Bölgedeki son gözlemler: ' + sig.map(function (x) { return x.label + ', ' + x.n + ' gözlem'; }).join('; ') + '. Ayrıntıları aç') + '">' +
      '<span class="drive-i">' + C.uiIcon(ICON[sig[0].cat], 20) + '</span><span class="drive-b"><b>Bölgedeki son gözlemler</b>' + rows +
      '<small>' + esc(L) + ' · son ' + (d.window || 30) + ' dk' + offlineNote(e) + '</small>' +
      (s && s.text ? '<small class="ob-fc">EYRIVO tahmini: ' + esc(s.text) + '</small>' : '') + '</span>' + dtGo() + '</div>';
  }
  function fill() {
    var h = C && C.$('obsCard');
    if (h) {
      var html = cardHtml();
      if (h.getAttribute('data-h') !== html) { h.innerHTML = html; h.setAttribute('data-h', html); }
      h.hidden = !html;
    }
    if (P.open) renderPanel();
  }

  // ---------- Panel ----------
  function head(sub) {
    return '<header class="sh-head"><span class="sh-sp" aria-hidden="true"></span><div class="sh-title"><h2 id="obTitle">Bölgesel Gözlemler</h2>' + (sub ? '<p>' + C.esc(sub) + '</p>' : '') + '</div>' +
      '<button type="button" class="sh-x" data-close aria-label="Kapat">' + C.uiIcon('close', 20) + '</button></header>';
  }
  var NOTE = '<div class="pol-info"><p>Gözlemler kullanıcı bildirimlerinden oluşur ve resmi meteorolojik ölçüm değildir.</p></div>';
  function renderPanel() {
    var e = current(), esc = C.esc;
    if (!e) { P.body.innerHTML = head('') + '<p class="ob-empty">Bu bölgede henüz yeterli güncel gözlem yok.</p>' + NOTE; return; }
    var d = e.data, sig = pickSignals(d.cats), s = snap(), L = scopeLabel(d.scope, loc()), win = d.window || 30, cmp = compare(d.cats, forecastKind(s));
    var html = head(L) + '<p class="ob-win">Son ' + win + ' dakika' + offlineNote(e) + '</p>';
    html += '<div class="ob-pair"><div class="ob-blk"><span>Bölgesel gözlemler</span><b>' + esc(sig[0].label) + '</b><small>Son ' + win + ' dk · ' + sig[0].n + ' gözlem</small></div>' +
      (s && s.text ? '<div class="ob-blk"><span>Tahmin</span><b>' + esc(s.text) + '</b><small>EYRIVO tahmini</small></div>' : '') + '</div>';
    if (cmp) html += '<p class="ob-cmp">' + esc(CMP[cmp]) + '</p>';
    html += '<ul class="pol-facts ob-facts">' + ORDER.filter(function (k) { return d.cats[k] && valueLabel(k, d.cats[k]); }).map(function (k) {
      var r = d.cats[k], parts = Object.keys(r.counts || {}).sort(function (a, b) { return r.counts[b] - r.counts[a]; }).map(function (c) { return r.counts[c] + ': ' + esc((CLS[k] && CLS[k][c]) || ''); }).join(' · ');
      return '<li><span>' + esc(TITLE[k]) + '<small>' + r.n + ' gözlem</small></span><b>%' + Math.round(r.share * 100) + ' → ' + esc(valueLabel(k, r)) + '<small>' + parts + '</small></b></li>';
    }).join('') + '</ul>' + NOTE;
    P.body.innerHTML = html;
  }
  function open(opener) {
    if (!P.wrap) return;
    document.dispatchEvent(new CustomEvent('hd2:sheet', { detail: 'ob' }));
    if (opener) P.opener = opener;
    P.cid = curId();
    if (!P.open) {
      P.wrap.hidden = false; void P.wrap.offsetWidth; P.wrap.classList.add('open'); P.open = true;
      document.documentElement.classList.add('lock');
      C.app.setAttribute('aria-hidden', 'true'); if ('inert' in C.app) C.app.inert = true;
    }
    renderPanel();
    var x = P.body.querySelector('.sh-x'); if (x) x.focus({ preventScroll: true });
  }
  function close(silent) {
    if (!P.wrap || P.wrap.hidden) return;
    P.wrap.classList.remove('open'); P.open = false;
    document.documentElement.classList.remove('lock');
    C.app.removeAttribute('aria-hidden'); if ('inert' in C.app) C.app.inert = false;
    var done = function () { if (!P.open) { P.wrap.hidden = true; P.wrap.querySelector('.sheet').style.transform = ''; } };
    if (C.reduceMotion() || silent) done(); else setTimeout(done, 260);
    if (!silent && P.opener && document.contains(P.opener)) P.opener.focus();
  }
  document.addEventListener('hd2:sheet', function (e) { if (e.detail !== 'ob') close(true); });

  // ---------- Veri (tembel, ana hava verisini bloklamaz) ----------
  function query(city) {
    var f = fbPure(), L = f && f.locFields(city); if (!L || L.lat === null || L.lon === null) return '';
    var q = ['lat=' + L.lat, 'lon=' + L.lon];
    if (L.province) q.push('province=' + encodeURIComponent(L.province));
    if (L.district) q.push('district=' + encodeURIComponent(L.district));
    if (L.neighborhood) q.push('neighborhood=' + encodeURIComponent(L.neighborhood));
    return q.join('&');
  }
  function load() {
    var city = C.state.city, cid = curId(), b = base(), now = Date.now();
    if (!city || !b || typeof fetch !== 'function' || navigator.onLine === false) return;   // çevrimdışı: yeni sorgu yok; eski sonuç SHOW_MAX sonra kendiliğinden gizlenir
    var e = cache[cid]; if (e && now - e.t < (e.ttl || TTL)) return;
    if (busy === cid || (backoff[cid] || 0) > now) return;
    var q = query(city); if (!q) return;
    busy = cid;
    var ac = typeof AbortController === 'function' ? new AbortController() : null, to = ac ? setTimeout(function () { ac.abort(); }, 7000) : 0;
    fetch(b + '/observations?' + q, ac ? { signal: ac.signal } : undefined).then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); }).then(function (j) {
      clearTimeout(to); busy = '';
      if (!j || j.ok !== true) throw new Error('yanıt');
      cache[cid] = { t: Date.now(), data: j, ttl: j.enabled === false ? 30 * 60000 : 0 };   // kapalıysa 30 dk sorma
      if (curId() === cid) fill();   // başka konuma geçildiyse bu sonuç gösterilmez (yalnızca önbelleğe girer)
    }).catch(function () { clearTimeout(to); busy = ''; backoff[cid] = Date.now() + 2 * 60000; if (curId() === cid) fill(); });
  }
  function sync() {
    if (!C) return;
    if (P.open && curId() !== P.cid) close(true);   // konum değişti: eski bölgenin paneli kapanır
    fill();                                          // eski konumun sonucu asla gösterilmez (current() konuma bağlı)
    clearTimeout(timer); timer = setTimeout(load, 1200);   // ana ekran çizildikten sonra
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-obs]');
      if (t && !P.wrap.contains(t)) open(t);
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target.closest && e.target.closest('[data-obs]');
      if (t && (e.key === 'Enter' || e.key === ' ') && !P.wrap.contains(t)) { e.preventDefault(); open(t); }
    });
    P.wrap.addEventListener('click', function (e) { if (e.target.closest('[data-close]') || e.target.classList.contains('sheet-bg')) close(); });
    document.addEventListener('keydown', function (e) {
      if (P.wrap.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') {
        var fo = Array.prototype.filter.call(P.wrap.querySelectorAll('button:not([disabled]), a[href]'), function (b) { return b.offsetParent !== null; });
        if (!fo.length) return;
        var first = fo[0], last = fo[fo.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    var grip = C.$('obGrip'), panel = P.wrap.querySelector('.sheet'), y0 = null, dy = 0;
    grip.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; panel.style.transition = 'none'; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; });
    function end() { if (y0 == null) return; y0 = null; panel.style.transition = ''; if (dy > 90) close(); else panel.style.transform = ''; }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
    g.addEventListener('online', function () { sync(); });
    g.addEventListener('offline', function () { fill(); });
  }

  g.HDObs = {
    init: function (ctx) { C = ctx; P.wrap = C.$('obSheet'); P.body = C.$('obBody'); if (P.wrap) bind(); },
    sync: sync, open: open, close: function () { close(); },
    _pure: pure,
    _state: function () { var e = current(); return { open: P.open, shown: !!e, scope: e && e.data.scope, signals: e ? pickSignals(e.data.cats).map(function (x) { return x.label; }) : [], busy: busy }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
