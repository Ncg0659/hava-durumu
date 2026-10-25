/* EYRIVO polen arayüzü (0.8): veri alma + kısa süreli önbellek + ana ekran kartı + "Polen ve Alerji" paneli.
   Seviye/cümle mantığı pollen.js'te (saf); burada yalnızca ağ, depolama ve çizim vardır. Ana hava önce çizilir; polen sonra, boşta yüklenir.
   Ağ hatası/zaman aşımı/çevrimdışı ana hava durumunu etkilemez. Aynı konum (0,1° ≈ CAMS ızgarası) için tekrar istek atılmaz. Push yok. */
'use strict';
(function () {
  var P0 = window.POLLEN;
  var C = null;
  var FRESH = 45 * 60000, TIMEOUT = 8000, STALE_AFTER = 3 * 3600000, MAX_KEYS = 5;
  var LS_C = 'hd2:pol:c', LS_PREF = 'hd2:pol:pref';
  var S = { failAt: 0, key: null, model: null, t: 0, kind: 'idle', stale: false, ctl: null, inflight: null };
  var mem = null, P = { wrap: null, body: null, open: false, opener: null };

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* dolu/engelli: sessiz */ } }
  function keyOf(city) { return (Math.round(city.lat * 10) / 10) + ',' + (Math.round(city.lon * 10) / 10); }
  function cache() { if (!mem) mem = lsGet(LS_C) || {}; return mem; }
  function save(key, t, m) {
    var c = cache(); c[key] = { t: t, m: m };
    var ks = Object.keys(c).sort(function (a, b) { return c[b].t - c[a].t; });
    ks.slice(MAX_KEYS).forEach(function (k) { delete c[k]; });
    lsSet(LS_C, c);
  }
  function pref() { var p = lsGet(LS_PREF); return Array.isArray(p) ? p : []; }
  function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
  function today() { var d = C && C.state.data; return d && d.current && d.current.time ? d.current.time.slice(0, 10) : null; }

  // ---------- Veri ----------
  function begin(city) {
    var key = keyOf(city), hit = cache()[key];
    if (S.key !== key) { S.key = key; S.model = null; S.t = 0; S.kind = 'loading'; S.stale = false; }
    if (hit) {
      S.t = hit.t; S.model = hit.m; S.kind = hit.m ? 'ok' : 'nodata';
      if (Date.now() - hit.t < FRESH) { S.stale = false; return Promise.resolve(); }
    }
    if (!online()) { S.failAt = 0; S.stale = !!hit && !!hit.m; S.kind = hit && hit.m ? 'ok' : 'offline'; return Promise.resolve(); }
    if (S.inflight && S.inflight.key === key) return S.inflight.p;
    var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, TIMEOUT);
    var p = fetch(P0.url(city.lat, city.lon), { signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) {
        if (S.key !== key) return;
        var m = P0.parse(j); S.t = Date.now(); S.model = m; S.kind = m ? 'ok' : 'nodata'; S.stale = false; save(key, S.t, m);
      }, function () {
        if (S.key !== key) return;
        S.failAt = Date.now();
        if (hit && hit.m) { S.stale = true; S.kind = 'ok'; } else S.kind = online() ? 'error' : 'offline';   // hata: eski veri varsa "son bilinen", yoksa sakin mesaj
      })
      .then(function () { clearTimeout(tm); if (S.inflight && S.inflight.key === key) S.inflight = null; fill(); });
    S.inflight = { key: key, p: p };
    return p;
  }
  // Ana çizim bittikten sonra çağrılır: boşta başlar, hiçbir şeyi beklemez
  function sync() {
    var city = C && C.state.city; if (!city || typeof city.lat !== 'number') return;
    var key = keyOf(city);
    if (S.key !== key) { S.key = key; S.model = null; S.kind = 'loading'; S.stale = false; S.failAt = 0; }
    fill();
    var need = S.kind === 'loading' || S.kind === 'idle' || ((S.kind === 'ok' || S.kind === 'nodata') && Date.now() - S.t >= FRESH) || S.kind === 'error' || S.kind === 'offline';
    if (!need || (S.failAt && Date.now() - S.failAt < 120000)) return;   // hata sonrası 2 dk beklenir (her çizimde yeniden denenmez)
    var go = function () { if (C.state.city && keyOf(C.state.city) === key) begin(C.state.city).then(fill); };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 300);
  }

  // Bugünün görünümü
  function view() {
    var day = today();
    if (S.kind === 'ok' && S.model && day) {
      var sum = P0.summarize(S.model, day, pref());
      if (sum) return { kind: 'ok', sum: sum, stale: S.stale || Date.now() - S.t > STALE_AFTER };
      return { kind: online() ? 'nodata' : 'offline' };   // önbellek bugünü kapsamıyorsa eski veri gösterilmez
    }
    return { kind: S.kind };
  }

  // ---------- Ana ekran kartı ----------
  function dtGo() { return '<i class="dt-go" aria-hidden="true">' + C.uiIcon('right', 14) + '</i>'; }
  function cardHtml() {
    var v = view(), e = C.esc;
    if (v.kind !== 'ok') return '';   // yalnızca kullanılabilir polen verisi varsa (ana ekran gereksiz kartla dolmaz)
    var ico = '<span class="drive-i">' + C.uiIcon('pollen', 20) + '</span>';
    if (v.kind === 'ok') {
      var s = v.sum, sub = P0.cardSub(s);
      return '<div class="drive pollen d' + s.level + '" data-pol role="button" tabindex="0" aria-haspopup="dialog" aria-label="' + e('Polen: ' + s.label + '. ' + P0.headline(s) + ' Ayrıntıları aç') + '">' + dtGo() + ico +
        '<span class="drive-b"><b>Polen <em class="lv"><i aria-hidden="true"></i>' + e(s.label) + '</em></b><small>' + e(sub) + (v.stale ? ' · Son güncelleme ' + e(C.stamp(S.t)) : '') + '</small></span></div>';
    }
    return '';   // veri yok / hata / zaman aşımı / çevrimdışı+önbellek yok: ana ekranda kart gösterilmez
  }
  // Kartı yerine yazar (her ana çizimde ve veri gelince). Kart içeriği değişmediyse DOM'a dokunmaz.
  function fill() {
    var h = C && C.$('pollenCard');
    if (h) {
      var html = cardHtml();
      if (h.getAttribute('data-h') !== html) { h.innerHTML = html; h.setAttribute('data-h', html); }
      h.hidden = !html;
    }
    if (P.open) renderPanel();
  }

  // ---------- Panel ----------
  function levelPill(l) { return '<em class="lv pl' + l + '"><i aria-hidden="true"></i>' + P0.LEVELS[l] + '</em>'; }
  function head(sub) {
    var e = C.esc;
    return '<header class="sh-head"><span class="sh-sp" aria-hidden="true"></span><div class="sh-title"><h2 id="polTitle">Polen ve Alerji</h2>' + (sub ? '<p>' + e(sub) + '</p>' : '') + '</div>' +
      '<button type="button" class="sh-x" data-close aria-label="Kapat">' + C.uiIcon('close', 20) + '</button></header>';
  }
  function renderPanel() {
    var v = view(), e = C.esc, city = C.state.city, html = '';
    html += head(city ? city.name : '');
    if (v.kind !== 'ok') {
      var msg = v.kind === 'offline' ? 'Polen verisi çevrimdışıyken kullanılamıyor.' : 'Bu konum için polen verisi şu anda mevcut değil.';
      html += '<p class="pol-none">' + e(msg) + '</p>' + infoHtml(false);
      P.body.innerHTML = html; return;
    }
    var s = v.sum;
    html += '<div class="pol-hero d' + s.level + '"><div class="pol-lv">' + levelPill(s.level) + '</div><p class="pol-hl">' + e(P0.headline(s)) + '</p></div>';
    if (v.stale) html += '<p class="hr-note">' + (online() ? 'Güncel polen verisi alınamadı' : 'Çevrimdışı') + ' — son bilinen veri gösteriliyor. Son güncelleme: ' + e(C.stamp(S.t)) + '.</p>';
    html += '<ul class="pol-facts">';
    html += '<li><span>Genel risk</span><b>' + e(s.label) + '</b></li>';
    html += '<li><span>En yoğun zaman</span><b>' + (s.span ? (s.span.single ? e(s.span.from) : e(s.span.from + '–' + s.span.to)) : 'Belirgin yoğunluk yok') + '</b></li>';
    html += '<li><span>Öne çıkan</span><b>' + (s.level === 0 ? '—' : e(s.leading.slice(0, 3).map(function (t) { return t.name; }).join(' · '))) + '</b></li></ul>';
    // saatlik şerit
    html += '<h3 class="pol-h">Saatlik görünüm</h3><div class="pol-strip" role="list" aria-label="Saatlik polen düzeyi">' + P0.strip(s, 3).map(function (h) {
      return '<div class="pol-cell" role="listitem"><span>' + e(h.time) + '</span>' + (h.level === null ? '<b class="x">—</b>' : '<b class="pl' + h.level + '"><i aria-hidden="true"></i>' + P0.LEVELS[h.level] + '</b>') + '</div>';
    }).join('') + '</div>';
    // tür listesi
    html += '<h3 class="pol-h">Türler <small>bugünkü en yüksek değer</small></h3><ul class="pol-list">' + s.types.filter(function (t) { return t.peak !== null; }).sort(function (a, b) { return (b.tracked - a.tracked) || (b.level - a.level) || (b.peak / b.hi - a.peak / a.hi); }).map(function (t) {
      return '<li class="' + (t.tracked ? '' : 'off') + '"><span class="n">' + e(t.name) + '</span><span class="v">' + levelPill(t.level) + '</span><span class="r">' + e(P0.fmtVal(t.peak)) + ' ' + P0.UNIT + '</span></li>';
    }).join('') + '</ul>';
    // tercih
    var tr = pref(), all = !tr.length;
    html += '<h3 class="pol-h">Hangi polen türlerini takip etmek istersin?</h3><div class="pol-pref" role="group" aria-label="Takip edilen polen türleri">' + P0.PREFS.map(function (p) {
      var on = all || tr.indexOf(p[0]) >= 0;
      return '<button type="button" class="hr-tab' + (on ? ' on' : '') + '" data-pref="' + p[0] + '" aria-pressed="' + on + '">' + e(p[1]) + '</button>';
    }).join('') + '</div><p class="pol-sm">Seçim yalnızca bu cihazda saklanır. Hiçbiri seçili değilse tüm türler gösterilir.</p>';
    html += infoHtml(true);
    P.body.innerHTML = html;
  }
  // Bilgi + kaynak + sağlık notu (panel altında TEK kez)
  function infoHtml(withUpdate) {
    var e = C.esc;
    return '<div class="pol-info"><p>Değerler CAMS Avrupa hava kalitesi modelinden gelir (yaklaşık 11 km çözünürlük). Bulunduğun noktadaki bir ölçüm değildir; yerel koşullara göre farklı olabilir.</p>' +
      '<p>Kaynak: <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noopener">Open-Meteo</a> + CAMS' + (withUpdate && S.t ? ' · Son güncelleme ' + e(C.stamp(S.t)) : '') + '</p>' +
      '<p class="pol-med">Polen göstergeleri çevresel tahmin verileridir; tıbbi tavsiye değildir.</p></div>';
  }

  function open(opener) {
    if (!P.wrap || view().kind !== 'ok') return;
    document.dispatchEvent(new CustomEvent('hd2:sheet', { detail: 'pol' }));
    if (opener) P.opener = opener;
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
  document.addEventListener('hd2:sheet', function (e) { if (e.detail !== 'pol') close(true); });

  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-pol]');
      if (t && !P.wrap.contains(t)) open(t);
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target.closest && e.target.closest('[data-pol]');
      if (t && (e.key === 'Enter' || e.key === ' ') && !P.wrap.contains(t)) { e.preventDefault(); open(t); }
    });
    P.wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]') || e.target.classList.contains('sheet-bg')) { close(); return; }
      var b = e.target.closest('[data-pref]');
      if (b) {
        var id = b.dataset.pref, cur = pref(), all = !cur.length;
        var set = all ? P0.PREFS.map(function (p) { return p[0]; }) : cur.slice();
        var i = set.indexOf(id); if (i >= 0) set.splice(i, 1); else set.push(id);
        lsSet(LS_PREF, set.length === P0.PREFS.length ? [] : set);   // hepsi seçili = varsayılan
        renderPanel(); fill();
        var nb = P.body.querySelector('[data-pref="' + id + '"]'); if (nb) nb.focus({ preventScroll: true });
      }
    });
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
    var grip = C.$('polGrip'), panel = P.wrap.querySelector('.sheet'), y0 = null, dy = 0;
    grip.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; panel.style.transition = 'none'; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; });
    function end() { if (y0 == null) return; y0 = null; panel.style.transition = ''; if (dy > 90) close(); else panel.style.transform = ''; }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    window.addEventListener('online', function () { if (C.state.city) { S.kind = S.model ? S.kind : 'loading'; sync(); } });
  }

  window.HDPollen = {
    init: function (ctx) { C = ctx; P.wrap = C.$('polSheet'); P.body = C.$('polBody'); if (P.wrap) bind(); },
    sync: function () { if (!C) return; if (P.open) { var c = C.state.city; if (!c || keyOf(c) !== S.key) close(true); } sync(); },
    fill: fill, open: open, close: function () { close(); },
    _state: function () { return { key: S.key, kind: S.kind, stale: S.stale, t: S.t, open: P.open, view: view().kind }; }
  };
})();
