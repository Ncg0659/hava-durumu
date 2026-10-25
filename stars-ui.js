/* EYRIVO Yıldız Gözlem arayüzü (0.8): ana ekran kartı + "Yıldız Gözlem" paneli.
   Skor/pencere/neden mantığı stars.js'te, Güneş/Ay hesabı astro.js'te (saf, yerel). Burada yalnızca durum okuma ve çizim vardır.
   Ek ağ isteği YOK: uygulamanın zaten çektiği (ya da önbellekteki) saatlik hava verisi kullanılır; çevrimdışı çalışır.
   Kart yalnızca hesaplanabilir veri varken görünür (veri/gece yoksa ya da hesap hata verirse gizli kalır; ana ekran bozulmaz). */
'use strict';
(function () {
  var S0 = window.STARS, A0 = window.ASTRO;
  var C = null, P = { wrap: null, body: null, open: false, opener: null };
  var memo = { key: '', val: null };

  function nowMs() { return Date.now(); }
  // Aynı şehir + aynı veri + aynı 5 dakikada yeniden hesaplanmaz
  function calc() {
    var d = C.state.data, city = C.state.city;
    if (!d || !d.hourly || !city || typeof city.lat !== 'number') return null;
    var now = nowMs(), key = C.cityId(city) + '|' + (C.state.dataT || 0) + '|' + Math.floor(now / 300000);
    if (memo.key === key) return memo.val;
    var r = null;
    try {
      r = S0.analyze({ hourly: d.hourly, offset: d.utc_offset_seconds || 0, lat: city.lat, lon: city.lon, now: now });
      if (r && r.none) r = null;
    } catch (e) { r = null; }   // astronomi hesabı hata verirse kart gizli, panel açılmaz
    memo.key = key; memo.val = r; return r;
  }
  function stale() { var age = Date.now() - (C.state.dataT || Date.now()); return !!C.state.stale || age > 2 * 3600000; }
  function cls(b) { return 'pl' + (2 - b); }   // 2 İyi → yeşil(pl0) · 1 Orta → sarı(pl1) · 0 Zayıf → kırmızı(pl2): mevcut uyarı renkleri

  // ---------- Ana ekran kartı ----------
  function dtGo() { return '<i class="dt-go" aria-hidden="true">' + C.uiIcon('right', 14) + '</i>'; }
  function cardHtml() {
    var r = calc(), e = C.esc; if (!r) return '';
    var sub = r.window && r.band >= 1 ? 'En iyi zaman ' + r.window.from + '–' + r.window.to : r.reasons[0];
    if (r.window && r.band < 1) sub = r.reasons[0];
    return '<div class="drive stars d' + (2 - r.band) + '" data-star role="button" tabindex="0" aria-haspopup="dialog" aria-label="' + e('Yıldız Gözlem: bu gece ' + r.score + '/10, ' + r.label + '. ' + sub + ' Ayrıntıları aç') + '">' + dtGo() +
      '<span class="drive-i">' + C.uiIcon('moon', 20) + '</span><span class="drive-b"><b>Yıldız Gözlem <em class="lv ' + cls(r.band) + '"><i aria-hidden="true"></i>Bu gece ' + r.score + '/10 · ' + e(r.label) + '</em></b>' +
      '<small>' + nw(sub) + (stale() ? ' · Son güncelleme ' + e(C.stamp(C.state.dataT || Date.now())) : '') + '</small></span></div>';
  }
  function fill() {
    var h = C && C.$('starCard');
    if (h) {
      var html = cardHtml();
      if (h.getAttribute('data-h') !== html) { h.innerHTML = html; h.setAttribute('data-h', html); }
      h.hidden = !html;
    }
    if (P.open) { if (calc()) renderPanel(); else close(true); }
  }
  function sync() {
    if (!C) return;
    fill();   // hesap küçüktür ve önbelleklidir; kart ana çizimden sonra, boşta yazılır
  }

  // ---------- Panel ----------
  var TIPS = ['Şehir ışıklarından uzak bir yer tercih et.', 'Gözlerinin karanlığa alışması için biraz bekle.', 'Telefon ekranının parlaklığını azalt.'];
  function nw(s) { return C.esc(s).replace(/(\d\d:\d\d–\d\d:\d\d)/g, '<span class="nw">$1</span>'); }
  function pct(v) { return '%' + Math.round(v); }
  function kmTxt(m) { var k = m / 1000; return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10).toString().replace('.', ',') + ' km'; }
  function pill(b) { return '<em class="lv ' + cls(b) + '"><i aria-hidden="true"></i>' + S0.BAND_TXT[b] + '</em>'; }
  function row(name, val, b) { return '<li><span>' + name + '</span><b>' + val + ' ' + pill(b) + '</b></li>'; }
  function head(sub) {
    return '<header class="sh-head"><span class="sh-sp" aria-hidden="true"></span><div class="sh-title"><h2 id="stTitle">Yıldız Gözlem</h2>' + (sub ? '<p>' + C.esc(sub) + '</p>' : '') + '</div>' +
      '<button type="button" class="sh-x" data-close aria-label="Kapat">' + C.uiIcon('close', 20) + '</button></header>';
  }
  function factorsHtml(r) {
    var f = r.factors, m = r.moon, out = '';
    out += row('Bulutluluk', pct(f.cloud), f.cloud <= 25 ? 2 : f.cloud <= 60 ? 1 : 0);
    if (f.vis !== null) out += row('Görüş', kmTxt(f.vis), f.vis >= 10000 ? 2 : f.vis >= 4000 ? 1 : 0);
    out += f.wet ? row('Yağış', 'Var', 0) : (f.pop !== null && f.pop >= 40 ? row('Yağış', 'Olasılık ' + pct(f.pop), 1) : row('Yağış', 'Yok', 2));
    if (f.fog) out += row('Nem / sis', 'Sis', 0);
    else if (f.hum !== null) out += row('Nem / sis', pct(f.hum), f.hum <= 80 ? 2 : f.hum <= 90 ? 1 : 0);
    out += m.winUp ? row('Ay', pct(m.illum * 100) + ' aydınlık', m.illum <= 0.3 ? 2 : m.illum <= 0.7 ? 1 : 0) : row('Ay', 'Ufkun altında', 2);
    return out;
  }
  function moonHtml(r) {
    var m = r.moon, e = C.esc, lines = [];
    var ev = m.events.slice().sort(function (a, b) { return a.label < b.label ? -1 : 1; });
    ev.forEach(function (x) { lines.push((x.type === 'rise' ? 'Ay doğuşu ' : 'Ay batışı ') + e(x.label)); });
    if (!ev.length) lines.push(m.upAtStart ? 'Ay gece boyunca gökyüzünde' : 'Ay bu gece doğmuyor');
    var tag = m.illum <= 0.3 ? 'Gökyüzü için uygun' : m.illum <= 0.7 ? 'Orta aydınlık' : 'Ay oldukça parlak';
    return '<h3 class="pol-h">Ay</h3><div class="st-moon"><div class="st-mn"><b>' + e(m.phase) + '</b><span>' + pct(m.illum * 100) + ' aydınlık</span></div><p>' + lines.join(' · ') + '</p><p class="st-tag">' + e(tag) + '</p></div>';
  }
  function stripHtml(r) {
    return '<h3 class="pol-h">Saatlik görünüm</h3><div class="pol-strip" role="list" aria-label="Saatlik gökyüzü uygunluğu">' + r.hours.map(function (h) {
      var ic = h.wet ? 'drop' : h.eff <= 30 ? 'moon' : 'cloud';
      return '<div class="pol-cell st-cell' + (h.inWindow ? ' win' : '') + '" role="listitem"><span>' + C.esc(h.label) + '</span>' + C.uiIcon(ic, 16) + '<b class="' + cls(h.band) + '"><i aria-hidden="true"></i>' + h.score + '/10</b></div>';
    }).join('') + '</div>';
  }
  function renderPanel() {
    var r = calc(), e = C.esc, city = C.state.city; if (!r) return;
    var html = head(city ? city.name : '');
    html += '<div class="pol-hero d' + (2 - r.band) + '"><div class="st-big"><b>' + r.score + '<small>/10</small></b>' + pill(r.band) + '</div><p class="pol-hl">' + nw(r.headline) + '</p><p class="st-kind">Meteorolojik gözlem uygunluğu</p></div>';
    if (stale()) html += '<p class="hr-note">Gösterilen hava verisi eski' + (navigator.onLine === false ? ' (çevrimdışı)' : '') + '. Son güncelleme: ' + e(C.stamp(C.state.dataT || Date.now())) + '.</p>';
    html += '<h3 class="pol-h">' + (r.score >= 8 ? 'Öne çıkan' : 'Neden bu puan?') + '</h3><ul class="st-why">' + r.reasons.slice(0, 3).map(function (x) { return '<li>' + nw(x) + '</li>'; }).join('') + '</ul>';
    html += '<ul class="pol-facts st-facts">' + factorsHtml(r) + '</ul>';
    html += stripHtml(r) + moonHtml(r);
    var lvl = r.night.level === 'astronomical' ? 'Astronomik karanlık' : r.night.level === 'nautical' ? 'Deniz alacakaranlığı sonrası' : 'Sivil alacakaranlık sonrası';
    html += '<p class="pol-sm st-dark">' + lvl + ': ' + e(r.night.startLabel) + '–' + e(r.night.endLabel) + '</p>';
    html += '<h3 class="pol-h">Gözlem için</h3><ul class="st-why">' + TIPS.map(function (x) { return '<li>' + e(x) + '</li>'; }).join('') + '</ul>';
    html += '<div class="pol-info"><p>Bu skor gökyüzünün meteorolojik uygunluğudur; kaç yıldız göreceğini göstermez. Yerel ışık kirliliği bu değerlendirmeye dahil değildir.</p>' +
      '<p>Hava verisi: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> · Güneş ve Ay konumu cihazında hesaplanır' + (C.state.dataT ? ' · Hava verisi son güncelleme ' + e(C.stamp(C.state.dataT)) : '') + '</p></div>';
    P.body.innerHTML = html;
  }
  function open(opener) {
    if (!P.wrap || !calc()) return;
    document.dispatchEvent(new CustomEvent('hd2:sheet', { detail: 'st' }));
    if (opener) P.opener = opener;
    P.cid = C.cityId(C.state.city);
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
  document.addEventListener('hd2:sheet', function (e) { if (e.detail !== 'st') close(true); });

  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-star]');
      if (t && !P.wrap.contains(t)) open(t);
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target.closest && e.target.closest('[data-star]');
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
    var grip = C.$('stGrip'), panel = P.wrap.querySelector('.sheet'), y0 = null, dy = 0;
    grip.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; panel.style.transition = 'none'; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; });
    function end() { if (y0 == null) return; y0 = null; panel.style.transition = ''; if (dy > 90) close(); else panel.style.transform = ''; }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  }

  window.HDStars = {
    init: function (ctx) { C = ctx; P.wrap = C.$('stSheet'); P.body = C.$('stBody'); if (P.wrap && S0 && A0) bind(); },
    sync: function () { if (!C || !S0 || !A0) return; if (P.open) { var c = C.state.city; if (!c || C.cityId(c) !== P.cid) close(true); } sync(); },
    open: open, close: function () { close(); },
    _state: function () { var r = null; try { r = calc(); } catch (e) { /* */ } var c = C && C.state.city; return { lat: c && c.lat, lon: c && c.lon, open: P.open, has: !!r, score: r && r.score, window: r && r.window && (r.window.from + '–' + r.window.to) }; }
  };
})();
