/* Ayrıntı ekranları (alt sayfa): Sıcaklık, Hissedilen, Rüzgâr, UV, Yağış, Basınç, Görüş, Nem / çiy noktası, Güneş.
   Yalnızca kullanıcı ilgili karta dokununca açılır; yalnızca AÇIK sekme çizilir (gizli paneller için DOM kurulmaz).
   Veri: uygulamanın elindeki tahmin (state.data, past_days=1 ile dünün saatleri dahil) ve hava kalitesi; hesaplar detailcalc.js / meteo.js'te.
   Tek isteğe bağlı ağ çağrısı: mevsim ortalaması için Open-Meteo arşiv verisi — YALNIZCA Sıcaklık/Yağış sekmesi açılınca, konum başına bir kez, uzun süreli önbellekle. */
'use strict';
(function () {
  var C = null, M = window.METEO, D = window.DCALC;
  var P = { wrap: null, body: null, open: false, tab: 'temp', time: null, cityId: null, opener: null };
  var ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
  var CLK = 'hd2:clim', CLIM_MAX = 8, CLIM_TTL = 60 * 86400000, FAIL_BACKOFF = 30 * 60000;
  var CLIM = null, inflight = {}, failAt = {};
  var TABS = [
    ['temp', 'Sıcaklık', 'Sıcaklık'], ['feels', 'Hissedilen', 'Hissedilen sıcaklık'], ['wind', 'Rüzgâr', 'Rüzgâr'], ['uv', 'UV', 'UV indeksi'], ['rain', 'Yağış', 'Yağış'],
    ['press', 'Basınç', 'Basınç'], ['vis', 'Görüş', 'Görüş'], ['hum', 'Nem', 'Nem ve çiy noktası'], ['sun', 'Güneş', 'Güneş ve gün ışığı'], ['drive', 'Sürüş', 'Sürüş havası'], ['life', 'Yaşam', 'Günlük yaşam']
  ];
  var DRIVE_COL = ['#6ee7a3', '#ffd25e', '#ff9a8f'];
  var COL = { temp: '#ffd27a', feels: 'rgba(255,255,255,.85)', ref: 'rgba(255,255,255,.5)', rain: '#8fd8ff', prob: '#ffffff', wind: '#b6f0e0', gust: '#ffb86b', press: '#d9c9ff', vis: '#a9e4ff', hum: '#8fd8ff', dew: '#ffd27a', gold: '#ffc93c' };
  var TREND_COL = { 'rise-strong': '#8fd8ff', rise: '#8fd8ff', steady: '#b6f0e0', fall: '#ffd27a', 'fall-strong': '#ff9a8f' };

  function st() { return C.state; }
  function dat() { return C.state.data; }
  function H() { return C.state.data.hourly; }
  function esc(s) { return C.esc(s); }
  function fmt1(v) { return (Math.round(v * 10) / 10).toLocaleString('tr-TR', { maximumFractionDigits: 1 }); }
  function sgn(v, u) { var x = Math.round(v * 10) / 10; return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + u; }
  function at(key, i) { return M.at(H()[key], i); }
  function win() { var h = H(), s = st().start || 0; return [s, Math.min(s + 23, h.time.length - 1)]; }
  function hmOf(t) { return t.slice(11, 16); }
  function dayLabel(t) {
    var cur = dat().current.time.slice(0, 10), p = C.parts(t);
    if (t.slice(0, 10) === cur) return 'Bugün';
    var c = C.parts(cur + 'T12:00'), a = Date.UTC(p.y, p.mo - 1, p.d), b = Date.UTC(c.y, c.mo - 1, c.d);
    if (a - b === 86400000) return 'Yarın';
    return new Date(p.y, p.mo - 1, p.d).toLocaleDateString('tr-TR', { weekday: 'long' });
  }
  function tabDef(id) { for (var i = 0; i < TABS.length; i++) if (TABS[i][0] === id) return TABS[i]; return TABS[0]; }

  // ---------- Hangi sekmelerde veri var ----------
  function anyIn(key, a, b) { var arr = H()[key]; for (var i = a; i <= b; i++) if (M.at(arr, i) !== null) return true; return false; }
  function avail(id) {
    var w = win(), a = w[0], b = w[1], dl = dat().daily;
    switch (id) {
      case 'temp': return anyIn('temperature_2m', a, b);
      case 'feels': return anyIn('apparent_temperature', a, b);
      case 'wind': return anyIn('wind_speed_10m', a, b);
      case 'uv': return anyIn('uv_index', a, b);
      case 'rain': return anyIn('precipitation_probability', a, b) || anyIn('precipitation', a, b);
      case 'press': return anyIn('pressure_msl', Math.max(0, a - 12), b);
      case 'vis': return anyIn('visibility', a, b);
      case 'hum': return anyIn('relative_humidity_2m', a, b) || anyIn('dew_point_2m', a, b);
      case 'sun': return !!(dl && dl.sunrise && dl.sunset && dl.sunrise[0] && dl.sunset[0]);
      case 'drive': return !!(window.ADVICE && st().adv && st().adv.drive);
      case 'life': return !!(window.DAILY && lifeX() && DAILY.comfort(lifeX()));
    }
    return false;
  }
  // ---------- Günlük yaşam sekmesi (0.7.1): Konfor, aktivite endeksleri, giyim, evcil hayvan. Kurallar daily.js'te; ek istek yok ----------
  function lifeX() { try { return DAILY.fromData(dat(), st().start || 0, st().aq || null); } catch (e) { return null; } }
  function lifeHtml() {
    var x = lifeX(), cf = x && DAILY.comfort(x); if (!cf) return '<p class="hint">Günlük yaşam değerlendirmesi için yeterli veri yok.</p>';
    var out = [], acts = DAILY.activities(x), ot = DAILY.outfit(x, window.ADVICE ? ADVICE.clothing({ feels: x.feels, wind: x.wind, gust: x.gust, eveMin: x.eveMin, hour: x.hour, isDay: x.isDay }) : null), pt = DAILY.pet(x);
    out.push('<section class="dt-box lf-box" aria-label="Konfor endeksi"><h3>EYRIVO Konfor Endeksi</h3><div class="lf-score"><b>' + cf.score + '<small>/10</small></b><span>' + esc(cf.label) + '</span></div>' +
      '<div class="lf-bar" role="img" aria-label="Konfor ' + cf.score + '/10"><i style="width:' + cf.score * 10 + '%"></i></div><ul class="lf-why">' + cf.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
      (cf.estimated ? '<p class="hint">Hissedilen sıcaklık verisi yok; gerçek sıcaklıkla tahmin edildi.</p>' : '') + '</section>');
    if (acts.length) out.push('<section class="dt-box lf-box" aria-label="Aktivite endeksleri"><h3>Aktivite endeksleri</h3><ul class="lf-acts">' + acts.map(function (a) {
      return '<li class="' + (a.blocked ? 'off' : '') + '"><span class="lf-i">' + C.uiIcon(a.icon, 22) + '</span><span class="lf-d" aria-hidden="true"></span><span class="lf-t"><span class="lf-n">' + esc(a.name) + '</span><small>' + esc(a.why) + '</small></span><b>' + a.score + '/10</b></li>';
    }).join('') + '</ul></section>');
    if (ot && ot.text) out.push('<section class="dt-box lf-box" aria-label="Giyim"><h3>Ne giymeli?</h3><p class="dt-s">' + esc(ot.text) + '</p></section>');
    if (pt) out.push('<section class="dt-box lf-box lf-pet l' + pt.level + '" aria-label="Evcil hayvan konforu"><div class="lf-ph"><span class="lf-paw">' + C.uiIcon('dog', 26) + '</span><h3>' + esc(String(pt.title).replace(/^🐾\s*/, '')) + '</h3>' +
      (pt.reasons && pt.reasons.length ? '<p class="lf-ps">' + esc(pt.reasons.join(', ')) + '</p>' : '') + '</div></section>');
    out.push('<p class="hint lf-foot">Yaşam değerlendirmeleri hava verisinden türetilen tahmini göstergelerdir; sağlık/veteriner tavsiyesi değildir.</p>');
    return out.join('');
  }
  function availTabs() { return TABS.filter(function (t) { return avail(t[0]); }); }

  // ---------- Küçük parçalar ----------
  function tile(label, value, sub, cls, extra) { return '<div class="sh-tile' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + value + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + (extra || '') + '</div>'; }
  function chip(text, color) { return '<em class="chipuv" style="background:' + color + '">' + esc(text) + '</em>'; }
  function grid(tiles, one) { tiles = tiles.filter(Boolean); return tiles.length ? '<div class="sh-grid' + (one ? ' one' : '') + '">' + tiles.join('') + '</div>' : ''; }
  function km(m) { return m >= 1000 ? fmt1(m / 1000) + ' km' : C.round(m) + ' m'; }
  function selLabel(i) { var t = H().time[i]; if (i === win()[0]) return 'Şimdi'; var dl = dayLabel(t); return (dl === 'Bugün' ? '' : dl + ' ') + hmOf(t); }
  function selIndex() {
    var h = H(), w = win(), i = h.time.indexOf(P.time);
    if (i < w[0] || i > w[1]) i = w[0];
    P.time = h.time[i]; return i;
  }

  // Dünle karşılaştırma: iki işaretli şerit (dün / bugün) + cümle. Veri yoksa hiç çizilmez.
  function cmpBlock(kind, key, i, fmt, minSpan) {
    if (!isToday(i)) return '';   // 'dünkü aynı saat' yalnızca bugünün saatleri için anlamlı
    var v = D.vsYesterday(H(), key, i); if (!v) return '';
    var text = D.cmpText(kind, v), lo = Math.min(v.now, v.prev), hi = Math.max(v.now, v.prev), pad = Math.max(hi - lo, minSpan || 1), dlo = lo - pad, dhi = hi + pad;
    var pos = function (x) { return Math.round((x - dlo) / (dhi - dlo) * 100); };
    return '<section class="dt-box" aria-label="Bugün ve dün"><h3>Dünkü aynı saat · ' + esc(hmOf(H().time[i])) + '</h3>' +
      '<div class="dt-track" role="img" aria-label="Dün ' + esc(fmt(v.prev)) + ', bugün ' + esc(fmt(v.now)) + '"><i class="dt-mk p" style="left:' + pos(v.prev) + '%"><em>Dün ' + esc(fmt(v.prev)) + '</em></i>' +
      '<i class="dt-mk n" style="left:' + pos(v.now) + '%"><em>Bugün ' + esc(fmt(v.now)) + '</em></i></div>' +
      (text ? '<p>' + esc(text) + '</p>' : '') + '</section>';
  }

  // ---------- Grafik (elle çizilen SVG; kütüphane yok) ----------
  // Çizgi yolu: ardışık noktalar monoton kübik (Fritsch–Carlson) eğriyle birleşir — noktaların kendisi değişmez, eğri aşım (taşma) yapmaz; boşluklar (null) ayrı parça olur
  function linePath(pts) {
    var out = '', seg = [], i;
    function flush() {
      var n = seg.length; if (!n) return;
      out += 'M' + seg[0][0].toFixed(1) + ' ' + seg[0][1].toFixed(1);
      if (n === 1) { seg = []; return; }
      var dx = [], m = [], t = [];
      for (i = 0; i < n - 1; i++) { dx[i] = seg[i + 1][0] - seg[i][0]; m[i] = (seg[i + 1][1] - seg[i][1]) / (dx[i] || 1); }
      t[0] = m[0]; t[n - 1] = m[n - 2];
      for (i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
      for (i = 0; i < n - 1; i++) {
        if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
        var a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
        if (s > 9) { var k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
      }
      for (i = 0; i < n - 1; i++) {
        var h3 = dx[i] / 3;
        out += 'C' + (seg[i][0] + h3).toFixed(1) + ' ' + (seg[i][1] + t[i] * h3).toFixed(1) + ' ' + (seg[i + 1][0] - h3).toFixed(1) + ' ' + (seg[i + 1][1] - t[i + 1] * h3).toFixed(1) + ' ' + seg[i + 1][0].toFixed(1) + ' ' + seg[i + 1][1].toFixed(1);
      }
      seg = [];
    }
    pts.forEach(function (p) { if (p === null) flush(); else seg.push(p); });
    flush();
    return out;
  }
  function drawChart(sp, sel) {
    var W = 320, Hh = sp.H || 150, L = 40, R = 8, T = sp.arrows ? 26 : 10, B = 24, n = sp.n, step = (W - L - R) / n, h = H();
    var all = sp.lines.concat(sp.bars), vals = [];
    all.forEach(function (s) { if (s.own) return; s.vals.forEach(function (v) { if (v !== null) vals.push(v); }); });
    if (!vals.length) vals = [0, 1];
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (sp.yMin != null) lo = sp.yMin; if (sp.yMax != null) hi = Math.max(sp.yMax, hi);
    if (hi - lo < sp.minSpan) { var mid = (hi + lo) / 2; if (sp.yMin != null) hi = lo + sp.minSpan; else { lo = mid - sp.minSpan / 2; hi = mid + sp.minSpan / 2; } }
    else if (sp.yMin == null) { var pad = (hi - lo) * 0.08; lo -= pad; hi += pad; }
    var X = function (k) { return L + (k + 0.5) * step; }, Y = function (v, own) { var l = own ? own[0] : lo, u = own ? own[1] : hi; return T + (u - v) / (u - l) * (Hh - T - B); };
    var g = '', k, selK = sel - sp.from;
    [lo, (lo + hi) / 2, hi].forEach(function (v) { g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="rgba(255,255,255,.14)"/><text x="' + (L - 5) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end" class="ct">' + esc(sp.axis(v)) + '</text>'; });
    (sp.guides || []).forEach(function (gd) { if (gd.v > lo && gd.v < hi) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(gd.v).toFixed(1) + '" y2="' + Y(gd.v).toFixed(1) + '" stroke="rgba(255,255,255,.3)" stroke-dasharray="2 4"/>'; });
    if (selK >= 0 && selK < n) g += '<rect x="' + (L + selK * step).toFixed(1) + '" y="' + T + '" width="' + step.toFixed(1) + '" height="' + (Hh - T - B) + '" fill="rgba(255,255,255,.16)" rx="3"/>';
    sp.bars.forEach(function (bs) {
      var bw = Math.max(2, step * 0.62);
      bs.vals.forEach(function (v, kk) { if (v === null) return; var y = Y(Math.max(v, lo)), hh = Math.max(v > 0 ? 1.5 : 0, Y(lo) - y); g += '<rect x="' + (X(kk) - bw / 2).toFixed(1) + '" y="' + (Y(lo) - hh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="1.5" fill="' + (bs.colorFn ? bs.colorFn(v) : bs.color) + '"/>'; });
    });
    sp.lines.forEach(function (ls) {
      var path = linePath(ls.vals.map(function (v, kk) { return v === null ? null : [X(kk), Y(v, ls.own)]; }));
      if (path) g += '<path d="' + path + '" fill="none" stroke="' + ls.color + '" stroke-width="' + ls.w + '" stroke-linecap="round" stroke-linejoin="round"' + (ls.dash ? ' stroke-dasharray="' + ls.dash + '"' : '') + (ls.op ? ' opacity="' + ls.op + '"' : '') + '/>';
    });
    if (sp.arrows) {   // rüzgâr yönü: 3 saatte bir, rüzgârın gittiği yöne bakan küçük ok
      for (k = 0; k < n; k += 3) { var dr = sp.arrows[k]; if (dr === null || dr === undefined) continue; g += '<g transform="translate(' + X(k).toFixed(1) + ' 11) rotate(' + ((Math.round(dr) + 180) % 360) + ')"><path d="M0-6L3.600 4 0 2 -3.600 4z" fill="rgba(255,255,255,.85)"/></g>'; }
    }
    var lead = sp.lines.filter(function (s) { return !s.ref; })[0] || sp.bars[0];
    if (selK >= 0 && selK < n && lead) { var sv = lead.vals[selK]; if (sv !== null) g += '<circle cx="' + X(selK).toFixed(1) + '" cy="' + Y(sv, lead.own).toFixed(1) + '" r="4.5" fill="#fff" stroke="' + (lead.color || '#fff') + '" stroke-width="2"/>'; }
    if (sp.now != null) { var nk = sp.now - sp.from; g += '<line x1="' + X(nk).toFixed(1) + '" x2="' + X(nk).toFixed(1) + '" y1="' + T + '" y2="' + (Hh - B) + '" stroke="rgba(255,255,255,.5)" stroke-dasharray="3 3"/>'; }
    for (k = 0; k < n; k++) { var tm = h.time[sp.from + k]; if (+tm.slice(11, 13) % 6 === 0) g += '<text x="' + X(k).toFixed(1) + '" y="' + (Hh - 7) + '" text-anchor="middle" class="ct">' + tm.slice(11, 16) + '</text>'; }
    var sv2 = lead && lead.vals[selK], label = sp.name + ' ' + (sel >= 0 ? hmOf(h.time[sel]) : '') + ': ' + (sv2 === null || sv2 === undefined ? 'veri yok' : sp.axis(sv2));
    return '<svg class="hr-chart" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="' + esc(label) + '" data-from="' + sp.from + '" data-n="' + n + '" data-l="' + L + '" data-step="' + step + '" data-w="' + W + '">' + g + '</svg>';
  }
  function S(key, from, to) { var o = []; for (var i = from; i <= to; i++) o.push(M.at(H()[key], i)); return o; }
  // Dünkü çizgi yalnızca BUGÜNÜN saatleri için çizilir (gece yarısından sonraki saatlerin 'bir gün öncesi' bugündür, dün değil)
  function isToday(i) { return H().time[i].slice(0, 10) === dat().current.time.slice(0, 10); }
  function Sref(key, from, to) { var o = []; for (var i = from; i <= to; i++) { var j = isToday(i) ? D.sameHourAgo(H().time, i, 1) : -1; o.push(j < 0 ? null : M.at(H()[key], j)); } return o; }
  function hasAny(arr) { return arr.some(function (v) { return v !== null; }); }
  function withRef(sp, key, from, to) { var r = Sref(key, from, to); if (hasAny(r)) { sp.lines.unshift({ vals: r, color: COL.ref, w: 1.2, dash: '3 4', ref: true }); sp.legend = (sp.legend ? sp.legend + ' · ' : '') + 'Soluk kesik çizgi: dün aynı saat'; } return sp; }

  function chartSpecs(id) {
    var w = win(), a = w[0], b = w[1], n = b - a + 1, sp;
    switch (id) {
      case 'temp':
        sp = { name: 'Sıcaklık', from: a, n: n, lines: [{ vals: S('temperature_2m', a, b), color: COL.temp, w: 1.9 }], bars: [], minSpan: 4, axis: function (v) { return C.num(v) + '°'; }, legend: 'Düz çizgi: sıcaklık' };
        return [withRef(sp, 'temperature_2m', a, b)];
      case 'feels':
        sp = { name: 'Hissedilen sıcaklık', from: a, n: n, lines: [{ vals: S('apparent_temperature', a, b), color: COL.feels, w: 1.9 }, { vals: S('temperature_2m', a, b), color: COL.temp, w: 1.4, dash: '4 4' }], bars: [], minSpan: 4, axis: function (v) { return C.num(v) + '°'; }, legend: 'Düz beyaz çizgi: hissedilen · Kesik sarı çizgi: gerçek sıcaklık' };
        return [sp];
      case 'wind':
        sp = { name: 'Rüzgâr', from: a, n: n, lines: [{ vals: S('wind_speed_10m', a, b), color: COL.wind, w: 1.9 }, { vals: S('wind_gusts_10m', a, b), color: COL.gust, w: 1.4, dash: '4 4' }], bars: [], yMin: 0, minSpan: 20, axis: function (v) { return C.round(v); },
          arrows: S('wind_direction_10m', a, b), legend: 'Düz çizgi: rüzgâr · Kesik çizgi: hamle (km/sa) · Oklar: rüzgârın gittiği yön' };
        if (!hasAny(sp.arrows)) sp.arrows = null;
        return [withRef(sp, 'wind_speed_10m', a, b)];
      case 'uv':
        return [{ name: 'UV indeksi', from: a, n: n, lines: [], bars: [{ vals: S('uv_index', a, b), colorFn: function (v) { return C.UV_CLASSES[C.uvClass(v)][1]; } }], yMin: 0, yMax: 8, minSpan: 6, guides: [{ v: 3 }, { v: 6 }, { v: 8 }, { v: 11 }], axis: function (v) { return fmt1(v); }, legend: 'Sütun rengi risk sınıfını gösterir; noktalı çizgiler 3 · 6 · 8 · 11 sınırları' }];
      case 'rain':
        return [{ name: 'Yağış', from: a, n: n, lines: [{ vals: S('precipitation_probability', a, b), color: COL.prob, w: 1.4, own: [0, 100] }], bars: [{ vals: S('precipitation', a, b), color: COL.rain }], yMin: 0, minSpan: 2, axis: function (v) { return fmt1(v); }, legend: 'Sütun: yağış miktarı (mm) · Çizgi: yağış ihtimali (%)' }];
      case 'press': {
        var pf = Math.max(0, a - 12), pn = b - pf + 1;
        sp = { name: 'Basınç', from: pf, n: pn, now: a, lines: [{ vals: S('pressure_msl', pf, b), color: COL.press, w: 1.9 }], bars: [], minSpan: 6, axis: function (v) { return C.round(v); }, legend: 'hPa · Son 12 saat ve önümüzdeki 24 saat (kesik çizgi: şimdi)' };
        return [sp];
      }
      case 'vis':
        return [{ name: 'Görüş', from: a, n: n, lines: [{ vals: S('visibility', a, b).map(function (v) { return v === null ? null : v / 1000; }), color: COL.vis, w: 1.9 }], bars: [], yMin: 0, minSpan: 10, guides: [{ v: 1 }, { v: 4 }, { v: 10 }], axis: function (v) { return fmt1(v); }, legend: 'km · noktalı çizgiler 1 · 4 · 10 km' }];
      case 'hum':
        return [{ name: 'Nem', from: a, n: n, lines: [{ vals: S('relative_humidity_2m', a, b), color: COL.hum, w: 1.9 }], bars: [], yMin: 0, yMax: 100, minSpan: 100, axis: function (v) { return '%' + C.round(v); }, legend: 'Bağıl nem (%)', title: 'Nem' },
          { name: 'Çiy noktası', from: a, n: n, lines: [{ vals: S('dew_point_2m', a, b), color: COL.dew, w: 1.9 }, { vals: S('temperature_2m', a, b), color: COL.feels, w: 1.2, dash: '4 4' }], bars: [], minSpan: 4, axis: function (v) { return C.num(v) + '°'; }, legend: 'Düz sarı çizgi: çiy noktası · Kesik çizgi: sıcaklık (birbirine yaklaşınca hava nemli hissedilir)', title: 'Çiy noktası ve sıcaklık' }];
    }
    return [];
  }
  function chartsHtml(id, i) {
    var specs = chartSpecs(id).filter(function (sp) { return hasAny(sp.lines.concat(sp.bars).reduce(function (acc, s) { return acc.concat(s.vals); }, [])); });
    if (!specs.length) return '';
    return '<section class="hr-charts dt-charts" aria-label="Saatlik grafik">' + specs.map(function (sp) {
      return '<figure class="dt-fig">' + (sp.title ? '<figcaption>' + esc(sp.title) + '</figcaption>' : '') + drawChart(sp, i) + '<p class="hint">' + esc(sp.legend) + '</p></figure>';
    }).join('') + '<p class="hint">Saat seçmek için grafiğe dokun.</p></section>';
  }

  // ---------- Güneş yolu ----------
  function sunData() {
    var d = dat(), dl = d.daily, c = d.current, city = st().city, date = c.time.slice(0, 10);
    return D.sunInfo({ date: date, lat: city.lat, lon: city.lon, offSec: M.num(d.utc_offset_seconds), sunrise: dl.sunrise && dl.sunrise[0], sunset: dl.sunset && dl.sunset[0] });
  }
  function nowMin() { var t = dat().current.time; return +t.slice(11, 13) * 60 + +t.slice(14, 16); }
  function sunChart(info) {
    var W = 320, Hh = 150, L = 10, R = 10, T = 14, B = 24, nm = nowMin(), X = function (m) { return L + (W - L - R) * m / 1440; }, g = '', k;
    var c = info.calc, ymin = -18, ymax, Y, nowY, night;
    if (info.trusted) {
      ymax = Math.max(10, c.maxElev + 4);
      Y = function (e) { return T + (ymax - Math.max(e, ymin)) / (ymax - ymin) * (Hh - T - B); };
      g += '<rect x="' + L + '" y="' + Y(0).toFixed(1) + '" width="' + (W - L - R) + '" height="' + (Hh - B - Y(0)).toFixed(1) + '" fill="rgba(0,0,0,.2)"/>';
      if (c.dawn !== null && c.rise !== null) g += '<rect x="' + X(c.dawn).toFixed(1) + '" y="' + T + '" width="' + (X(c.rise) - X(c.dawn)).toFixed(1) + '" height="' + (Hh - B - T) + '" fill="rgba(255,201,60,.12)"/>';
      if (c.set !== null && c.dusk !== null) g += '<rect x="' + X(c.set).toFixed(1) + '" y="' + T + '" width="' + (X(c.dusk) - X(c.set)).toFixed(1) + '" height="' + (Hh - B - T) + '" fill="rgba(255,201,60,.12)"/>';
      var path = '', area = '';
      var pen = false;
      c.curve.forEach(function (p) { if (p[1] < ymin) { pen = false; return; } path += (pen ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); pen = true; });   // gece (−18° altı) çizilmez
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="rgba(255,255,255,.4)"/>';
      var up = c.curve.filter(function (p) { return p[1] > 0; });
      if (up.length > 1) { area = 'M' + X(info.calc.rise).toFixed(1) + ' ' + Y(0).toFixed(1); up.forEach(function (p) { area += 'L' + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }); area += 'L' + X(info.calc.set).toFixed(1) + ' ' + Y(0).toFixed(1) + 'Z'; g += '<path d="' + area + '" fill="rgba(255,201,60,.2)"/>'; }
      g += '<path d="' + path + '" fill="none" stroke="' + COL.gold + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
      g += '<line x1="' + X(c.noon).toFixed(1) + '" x2="' + X(c.noon).toFixed(1) + '" y1="' + T + '" y2="' + (Hh - B) + '" stroke="rgba(255,255,255,.3)" stroke-dasharray="3 4"/>';
      var ne = D.elevAt(c, nm); nowY = Y(ne); night = ne < -0.833;
    } else {   // güvenilir hesap yok: yalnızca Open-Meteo doğuş/batışı arasında yaklaşık yay (yükseklik ekseni yok)
      var rise = info.rise, set = info.set, A = 60, base = Hh - B - 28, YY = function (m) { return base - A * Math.sin(Math.PI * (m - rise) / (set - rise)); }, pts = '';
      for (k = 0; k <= 40; k++) { var m = rise + (set - rise) * k / 40; pts += (k ? 'L' : 'M') + X(m).toFixed(1) + ' ' + YY(m).toFixed(1); }
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + base + '" y2="' + base + '" stroke="rgba(255,255,255,.4)"/><path d="' + pts + '" fill="none" stroke="' + COL.gold + '" stroke-width="2" stroke-linecap="round" stroke-dasharray="1.5 5"/>';
      night = nm < rise || nm > set; nowY = night ? base : YY(nm);
    }
    g += '<circle cx="' + X(nm).toFixed(1) + '" cy="' + nowY.toFixed(1) + '" r="9" fill="' + (night ? '#cfd8ff' : COL.gold) + '" opacity=".25"/><circle cx="' + X(nm).toFixed(1) + '" cy="' + nowY.toFixed(1) + '" r="5" fill="' + (night ? '#cfd8ff' : COL.gold) + '"/>';
    [0, 360, 720, 1080, 1440].forEach(function (m) { g += '<text x="' + X(m).toFixed(1) + '" y="' + (Hh - 7) + '" text-anchor="' + (m === 0 ? 'start' : m === 1440 ? 'end' : 'middle') + '" class="ct">' + D.fmtMin(m === 1440 ? 1439 : m).replace('23:59', '24:00') + '</text>'; });
    return '<svg class="dt-sunsvg" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Güneşin gün içindeki yolu. Doğuş ' + D.fmtMin(info.rise) + ', batış ' + D.fmtMin(info.set) + '. Şu an ' + D.fmtMin(nm) + '.">' + g + '</svg>';
  }

  // ---------- Üst blok (seçili saatin değeri) ----------
  function dialSvg(dr) {
    return '<svg class="dial" viewBox="0 0 48 48" width="56" height="56" role="img" aria-label="Rüzgâr ' + M.dir(dr).long + ' yönünden esiyor">' +
      '<circle cx="24" cy="24" r="21" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.4)" stroke-width="1.5"/>' +
      '<path d="M24 3v4M24 41v4M3 24h4M41 24h4" stroke="rgba(255,255,255,.55)" stroke-width="1.5" stroke-linecap="round"/>' +
      '<text x="24" y="17" text-anchor="middle" font-size="7" font-weight="700" fill="rgba(255,255,255,.8)">K</text>' +
      '<g style="transform-origin:24px 24px;transform:rotate(' + ((C.round(dr) + 180) % 360) + 'deg)"><path d="M24 11l6 17-6-3.5L18 28z" fill="#fff"/></g></svg>';
  }
  // ---------- Sürüş sekmesi: seçili saat ve 24 saatlik düzey şeridi ----------
  function driveHour(i) { return window.ADVICE ? ADVICE.driveAtHour(H(), i, dat().elevation) : null; }
  function driveStrip(sel) {
    var h = H(), w = win(), bars = '', labels = '', k, i, d, n = w[1] - w[0] + 1;
    for (i = w[0]; i <= w[1]; i++) {
      d = driveHour(i); k = i - w[0];
      bars += '<button type="button" class="dr-h l' + (d && d.known ? d.level : 'x') + (i === sel ? ' on' : '') + '" data-t="' + h.time[i] + '" aria-pressed="' + (i === sel) + '" aria-label="' + hmOf(h.time[i]) + ' ' + (d && d.known ? d.label : 'veri yok') + '"><i></i></button>';
      labels += '<span>' + (+h.time[i].slice(11, 13) % 6 === 0 ? hmOf(h.time[i]) : '') + '</span>';
    }
    return '<section class="dr-strip" aria-label="Saatlik sürüş durumu"><div class="dr-bars" style="--n:' + n + '">' + bars + '</div><div class="dr-lab" style="--n:' + n + '">' + labels + '</div>' +
      '<p class="hint dr-key"><i class="l0"></i>İyi <i class="l1"></i>Dikkat <i class="l2"></i>Riskli</p></section>';
  }
  function headHtml(id, i) {
    var big = '—', small = '', extra = '', dl = dat().daily, v, v2;
    switch (id) {
      case 'temp':
        v = at('temperature_2m', i); big = v === null ? '—' : C.deg(v);
        v2 = at('apparent_temperature', i); small = v2 !== null ? 'Hissedilen ' + C.deg(v2) : '';
        break;
      case 'feels':
        v = at('apparent_temperature', i); big = v === null ? '—' : C.deg(v);
        v2 = at('temperature_2m', i); small = v2 !== null ? 'Gerçek sıcaklık ' + C.deg(v2) : '';
        if (v !== null && v2 !== null && Math.abs(v - v2) >= 0.5) extra = chip(sgn(v - v2, '°'), v > v2 ? '#ffb86b' : '#8fd8ff');
        break;
      case 'wind':
        v = at('wind_speed_10m', i); big = v === null ? '—' : C.round(v) + '<small> km/sa</small>';
        v2 = at('wind_gusts_10m', i); small = v2 !== null ? 'Hamle ' + C.round(v2) + ' km/sa' : '';
        var dr = at('wind_direction_10m', i); if (dr !== null) extra = dialSvg(dr);
        break;
      case 'uv':
        v = at('uv_index', i); big = v === null ? '—' : fmt1(v);
        if (v !== null) { var uc = C.UV_CLASSES[C.uvClass(v)]; extra = chip(uc[0], uc[1]); }
        if (H().time[i].slice(0, 10) === dat().current.time.slice(0, 10) && dl.uv_index_max && M.num(dl.uv_index_max[0]) !== null) small = 'Bugünün en yükseği ' + fmt1(dl.uv_index_max[0]);
        break;
      case 'rain':
        v = at('precipitation_probability', i); big = v === null ? '—' : '%' + C.round(v);
        v2 = at('precipitation', i); small = v2 !== null ? fmt1(v2) + ' mm' : '';
        break;
      case 'press':
        v = at('pressure_msl', i); big = v === null ? '—' : C.round(v).toLocaleString('tr-TR') + '<small> hPa</small>';
        var pt = M.pressureTrend(H().pressure_msl, i); if (pt.ok) extra = chip(pt.label, TREND_COL[pt.cls]);
        break;
      case 'vis':
        v = at('visibility', i); big = v === null ? '—' : km(v);
        small = v === null ? '' : M.visibilityText(v).replace(/\.$/, '');
        break;
      case 'sun': {
        var si = sunData(); big = si.len === null ? '—' : D.lenText(si.len); small = 'Doğuş ' + D.fmtMin(si.rise) + ' · Batış ' + D.fmtMin(si.set);
        break;
      }
      case 'hum':
        v = at('relative_humidity_2m', i); big = v === null ? '—' : '%' + C.round(v);
        v2 = at('dew_point_2m', i); small = v2 !== null ? 'Çiy noktası ' + C.deg(v2) : '';
        if (v === null && v2 !== null) big = C.deg(v2);
        break;
      case 'drive': {
        var dh = driveHour(i);
        if (dh) { big = dh.label; small = dh.reasons.length ? dh.reasons.map(function (r) { return r.text; }).join(' · ') : ''; extra = chip(dh.label, DRIVE_COL[dh.level]); }
        break;
      }
    }
    var hourRow = id === 'sun' ? '' : '<div class="dt-hour" role="group" aria-label="Saat seç"><button type="button" class="dt-step" data-step="-1" aria-label="Önceki saat">' + C.uiIcon('left', 18) + '</button><strong>' + esc(selLabel(i)) + '</strong><button type="button" class="dt-step" data-step="1" aria-label="Sonraki saat">' + C.uiIcon('right', 18) + '</button></div>';
    return '<div class="dt-head"><div class="dt-big"><b>' + big + '</b>' + (small ? '<span>' + esc(small) + '</span>' : '') + '</div>' + (extra ? '<div class="dt-extra">' + extra + '</div>' : '') + '</div>' + hourRow;
  }

  // ---------- Kısa yorum (kural tabanlı) + eski veri notu ----------
  function staleNote() {
    var age = Date.now() - (st().dataT || Date.now());
    if (st().stale || age > 2 * 3600000) return '<p class="hr-note">Gösterilen veri eski' + (navigator.onLine === false ? ' (çevrimdışı)' : '') + '. Son güncelleme: ' + esc(C.stamp(st().dataT || Date.now())) + '.</p>';
    return '';
  }
  function summaryText(id, i) {
    var w = win(), a = w[0], b = w[1], h = H(), tot;
    switch (id) {
      case 'temp': return D.tempSummary(h, a, b);
      case 'feels': return D.feelsSummary(at('temperature_2m', i), at('apparent_temperature', i), at('relative_humidity_2m', i), at('wind_speed_10m', i));
      case 'wind': return D.windSummary(h, a, b);
      case 'uv': return D.uvSummary(h, a, b, C.uvClass, C.UV_CLASSES.map(function (c) { return c[0]; }));
      case 'rain': tot = D.precipTotals(h, a); return D.rainSummary(h, a, b, tot);
      case 'press': return D.pressSummary(h, a, b);
      case 'vis': return D.visSummary(h, a, b);
      case 'hum': return D.humSummary(at('temperature_2m', i), at('relative_humidity_2m', i), at('dew_point_2m', i));
      case 'sun': return D.sunSummary(sunData(), nowMin());
      case 'drive': {
        var dv = st().adv && st().adv.drive, dh = driveHour(i);
        if (!dv || !dh) return '';
        return i === w[0] ? dv.line + ' ' + (dv.change ? dv.change.text : '') : dh.label + ' · ' + dh.text;
      }
    }
    return '';
  }
  function leadHtml(id, i) { var t = summaryText(id, i); return staleNote() + (t ? '<p class="sh-comment">' + esc(t) + '</p>' : ''); }

  // ---------- Gövde ----------
  function mmText(v) { return fmt1(v) + ' mm'; }
  function bodyHtml(id, i) {
    var h = H(), w = win(), a = w[0], b = w[1], dl = dat().daily, out = [], v, v2, ex;
    switch (id) {
      case 'temp': {
        var hi = D.extreme(h.temperature_2m, a, b, true), lo = D.extreme(h.temperature_2m, a, b, false);
        out.push(grid([
          dl.temperature_2m_max && M.num(dl.temperature_2m_max[0]) !== null ? tile('Bugün en yüksek', C.deg(dl.temperature_2m_max[0])) : '',
          dl.temperature_2m_min && M.num(dl.temperature_2m_min[0]) !== null ? tile('Bugün en düşük', C.deg(dl.temperature_2m_min[0])) : '',
          hi ? tile('24 saatte en yüksek', C.deg(hi.v), esc(dayLabel(h.time[hi.i]) + ' ' + hmOf(h.time[hi.i]))) : '',
          lo ? tile('24 saatte en düşük', C.deg(lo.v), esc(dayLabel(h.time[lo.i]) + ' ' + hmOf(h.time[lo.i]))) : ''
        ]));
        out.push(cmpBlock('temp', 'temperature_2m', i, function (x) { return C.deg(x); }, 2));
        break;
      }
      case 'feels': {
        v = at('apparent_temperature', i); v2 = at('temperature_2m', i);
        out.push(grid([
          v !== null && v2 !== null ? tile('Fark', sgn(v - v2, '°'), v - v2 >= 0.5 ? 'Daha sıcak hissediliyor' : v - v2 <= -0.5 ? 'Daha soğuk hissediliyor' : 'Gerçeğe yakın') : '',
          (ex = at('relative_humidity_2m', i)) !== null ? tile(C.uiIcon('drop', 15) + 'Nem', '%' + C.round(ex)) : '',
          (ex = at('wind_speed_10m', i)) !== null ? tile(C.uiIcon('wind', 15) + 'Rüzgâr', C.round(ex) + ' km/sa') : ''
        ]));
        out.push(cmpBlock('feels', 'apparent_temperature', i, function (x) { return C.deg(x); }, 2));
        break;
      }
      case 'wind': {
        v = at('wind_speed_10m', i); var bf = v !== null ? M.beaufort(v) : null, dr = at('wind_direction_10m', i), dn = dr !== null ? M.dir(dr) : null, mx = D.extreme(h.wind_speed_10m, a, b, true);
        out.push(grid([
          bf ? tile('Beaufort', bf.n, esc(bf.label)) : '',
          dn ? tile('Yön', esc(dn.long), 'Bu yönden esiyor · ' + C.round(dr) + '°') : '',
          (ex = at('wind_gusts_10m', i)) !== null ? tile('Hamle', C.round(ex) + ' km/sa') : '',
          mx ? tile('24 saatte en güçlü', C.round(mx.v) + ' km/sa', esc(dayLabel(h.time[mx.i]) + ' ' + hmOf(h.time[mx.i]))) : ''
        ]));
        out.push(cmpBlock('wind', 'wind_speed_10m', i, function (x) { return C.round(x) + ' km/sa'; }, 5));
        break;
      }
      case 'uv': {
        var legend = C.UV_CLASSES.map(function (c, k) { var r = ['0–2', '3–5', '6–7', '8–10', '11+'][k]; return '<li><i style="background:' + c[1] + '"></i><span>' + c[0] + '</span><em>' + r + '</em></li>'; }).join('');
        v = at('uv_index', i); var uvmx = D.extreme(h.uv_index, a, b, true);
        out.push(grid([uvmx ? tile('24 saatte en yüksek', fmt1(uvmx.v), esc(dayLabel(h.time[uvmx.i]) + ' ' + hmOf(h.time[uvmx.i])), '', chip(C.UV_CLASSES[C.uvClass(uvmx.v)][0], C.UV_CLASSES[C.uvClass(uvmx.v)][1])) : '']));
        out.push(cmpBlock('uv', 'uv_index', i, function (x) { return fmt1(x); }, 1));
        out.push('<ul class="dt-legend" aria-label="UV sınıfları">' + legend + '</ul>');
        break;
      }
      case 'rain': {
        var tot = D.precipTotals(h, a), rn = at('rain', i), sn = at('snowfall', i), pr = at('precipitation_probability', i), sub = [];
        if (rn !== null && rn > 0) sub.push('Yağmur ' + fmt1(rn) + ' mm'); if (sn !== null && sn > 0) sub.push('Kar ' + fmt1(sn) + ' cm');
        var nextSub = [];
        if (tot.nextRain !== null && tot.nextRain > 0) nextSub.push('Yağmur ' + fmt1(tot.nextRain) + ' mm'); if (tot.nextSnow !== null && tot.nextSnow > 0) nextSub.push('Kar ' + fmt1(tot.nextSnow) + ' cm');
        var pastSub = tot.pastSnow !== null && tot.pastSnow > 0 ? 'Kar ' + fmt1(tot.pastSnow) + ' cm' : '';
        out.push(grid([
          pr !== null ? tile(C.uiIcon('umbrella', 15) + 'Yağış ihtimali', '%' + C.round(pr), '', '', '<i class="sh-g"><u style="width:' + C.round(pr) + '%"></u></i>') : '',
          (ex = at('precipitation', i)) !== null ? tile(C.uiIcon('drop', 15) + 'Bu saatte', mmText(ex), esc(sub.join(' · '))) : '',
          tot.past !== null ? tile('Son 24 saat', mmText(tot.past), esc(pastSub)) : tile('Son 24 saat', '<span class="rk-none">Veri yok</span>', 'Geçmiş yağış verisi yok'),
          tot.next !== null ? tile('Gelecek 24 saat', mmText(tot.next), esc(nextSub.join(' · '))) : tile('Gelecek 24 saat', '<span class="rk-none">Veri yok</span>', 'Tahmin tam değil')
        ]));
        out.push(cmpBlock('rain', 'precipitation', i, function (x) { return mmText(x); }, 1));
        break;
      }
      case 'press': {
        var pt = M.pressureTrend(h.pressure_msl, i), cell = function (lbl, d) { return d === null ? tile(lbl, '<span class="rk-none">Veri yok</span>') : tile(lbl, sgn(d, ' hPa'), Math.abs(d) < 1 ? 'Yaklaşık sabit' : d < 0 ? 'Düşüyor' : 'Yükseliyor'); };
        out.push(grid([cell('3 saat', pt.d3), cell('6 saat', pt.d6), cell('12 saat', pt.d12),
          pt.ok ? tile('Sınıf', '<span class="pt-' + pt.cls + '">' + pt.label + '</span>') : tile('Sınıf', '<span class="rk-none">Veri yok</span>', esc(pt.sentence))]));
        out.push(cmpBlock('press', 'pressure_msl', i, function (x) { return C.round(x) + ' hPa'; }, 3));
        break;
      }
      case 'vis': {
        var vmn = D.extreme(h.visibility, a, b, false), rh = at('relative_humidity_2m', i), tt = at('temperature_2m', i), dp = at('dew_point_2m', i);
        out.push(grid([
          vmn ? tile('24 saatte en düşük', km(vmn.v), esc(dayLabel(h.time[vmn.i]) + ' ' + hmOf(h.time[vmn.i]))) : '',
          rh !== null ? tile(C.uiIcon('drop', 15) + 'Nem', '%' + C.round(rh)) : '',
          tt !== null && dp !== null ? tile('Sıcaklık − çiy noktası', fmt1(tt - dp) + '°', tt - dp <= 1.5 ? 'Birbirine çok yakın' : 'Aralarında fark var') : ''
        ]));
        out.push('<p class="hint dt-note">Görüş sınıfları: 10 km ve üstü iyi · 4–10 km orta · 1–4 km azalmış · 1 km altı çok düşük. Sis tahmini kesin değildir.</p>');
        break;
      }
      case 'hum': {
        var t0 = at('temperature_2m', i), d0 = at('dew_point_2m', i), r0 = at('relative_humidity_2m', i);
        out.push(grid([
          r0 !== null ? tile(C.uiIcon('drop', 15) + 'Nem', '%' + C.round(r0), esc(r0 < 30 ? 'Kuru' : r0 < 60 ? 'Konforlu' : r0 < 80 ? 'Nemli' : 'Çok nemli')) : '',
          d0 !== null ? tile('Çiy noktası', C.deg(d0)) : '',
          t0 !== null ? tile('Sıcaklık', C.deg(t0)) : '',
          t0 !== null && d0 !== null ? tile('Aradaki fark', fmt1(t0 - d0) + '°', t0 - d0 <= 2 ? 'Çiy noktasına yaklaşıyor' : '') : ''
        ]));
        break;
      }
      case 'drive': {
        var dh2 = driveHour(i), x = dh2 && dh2.sig, el = dat().elevation;
        if (!dh2) break;
        var vis = at('visibility', i), gu = at('wind_gusts_10m', i), wi = at('wind_speed_10m', i), pm = at('precipitation', i), pp = at('precipitation_probability', i), sn = at('snowfall', i);
        var rk = M.risksAt(h, i), lv = function (p) { return p >= 3 ? 'Ciddi' : p === 2 ? 'Yüksek' : p === 1 ? 'Dikkat' : 'Sorun yok'; };
        out.push(grid([
          tile(C.uiIcon('eye', 15) + 'Görüş', vis === null ? '<span class="rk-none">Veri yok</span>' : km(vis), vis === null ? '' : lv(x.vis)),
          tile(C.uiIcon('wind', 15) + 'Rüzgâr hamlesi', gu !== null ? C.round(gu) + ' km/sa' : wi !== null ? C.round(wi) + ' km/sa' : '<span class="rk-none">Veri yok</span>', gu === null && wi !== null ? 'Hamle verisi yok; ortalama rüzgâr' : lv(x.gust)),
          tile(C.uiIcon('umbrella', 15) + 'Yağış', pm === null && pp === null ? '<span class="rk-none">Veri yok</span>' : (pm !== null ? fmt1(pm) + ' mm' : '%' + C.round(pp)), (pm !== null && pp !== null ? '%' + C.round(pp) + ' ihtimal · ' : '') + lv(Math.max(x.rain, x.snow))),
          tile(C.uiIcon('bolt', 15) + 'Fırtına riski', rk.storm.known ? rk.storm.label : '<span class="rk-none">Veri yok</span>'),
          tile(C.uiIcon('drop', 15) + 'Dolu riski', rk.hail.known ? rk.hail.label : '<span class="rk-none">Veri yok</span>'),
          x.ice > 0 ? tile(C.uiIcon('snowflake', 15) + 'Buzlanma', lv(x.ice), at('temperature_2m', i) !== null ? C.deg(at('temperature_2m', i)) + (sn !== null && sn > 0 ? ' · kar' : '') : '') : ''
        ]));
        var dv2 = st().adv && st().adv.drive;
        if (dv2 && dv2.partial) out.push('<p class="hint">Bazı veriler (' + [dv2.missing.vis ? 'görüş' : '', dv2.missing.gust ? 'rüzgâr hamlesi' : '', dv2.missing.rain ? 'yağış' : ''].filter(Boolean).join(', ') + ') bu bölge için yok; değerlendirme eldeki verilerle yapıldı.</p>');
        out.push('<p class="hint">Sürüş havası bir güvenlik garantisi değildir; yol durumunu ve resmi uyarıları dikkate alın.</p>');
        break;
      }
      case 'sun': {
        var s = sunData();
        if (s.rise === null || s.set === null) break;
        out.push('<section class="dt-box dt-sun"><h3>Güneşin gün içindeki yolu</h3>' + sunChart(s) + '<p class="hint">' + (s.trusted ? 'Yükseklik eğrisi astronomik hesaptır; sarı yüzey güneşin ufkun üstünde olduğu süredir.' : 'Yaklaşık yay: yalnızca doğuş ve batış saatine dayanır.') + '</p></section>');
        var T = [
          s.trusted && s.dawn !== null ? tile('İlk ışık', D.fmtMin(s.dawn), 'Şafak (sivil alacakaranlık)') : '',
          tile(C.uiIcon('sunrise', 15) + 'Gün doğumu', D.fmtMin(s.rise)),
          s.trusted ? tile('Güneş öğle', D.fmtMin(s.noon), 'Ufkun ' + C.round(s.maxElev) + '° üstünde') : '',
          tile(C.uiIcon('sunset', 15) + 'Gün batımı', D.fmtMin(s.set)),
          s.trusted && s.dusk !== null ? tile('Son ışık', D.fmtMin(s.dusk), 'Alacakaranlık sonu') : '',
          tile('Gün ışığı', D.lenText(s.len), s.lenDelta !== undefined && s.lenDelta !== null ? (Math.abs(s.lenDelta) < 0.5 ? 'Dünle aynı' : 'Dünden ' + (Math.abs(s.lenDelta) < 1.5 ? '1' : C.round(Math.abs(s.lenDelta))) + ' dk ' + (s.lenDelta > 0 ? 'uzun' : 'kısa')) : '')
        ];
        out.push(grid(T));
        break;
      }
    }
    return out.join('');
  }

  // ---------- Mevsim ortalaması (tarihsel veri; tembel yüklenir, uzun süre önbellekte) ----------
  function climKey(c) { return c.lat.toFixed(1) + ',' + c.lon.toFixed(1); }
  function climAll() { if (!CLIM) CLIM = C.store(CLK) || {}; return CLIM; }
  function expectY1() { return +dat().current.time.slice(0, 4) - 1; }
  function climRec() { var r = climAll()[climKey(st().city)]; return r && r.v && r.v.v === 1 && r.v.tx ? r : null; }
  function climFresh(r) { return !!r && r.y1 === expectY1() && Date.now() - r.t < CLIM_TTL && r.t <= Date.now() + 60000; }
  function climSave(key, y1, cl) {
    var all = climAll(), ids;
    all[key] = { t: Date.now(), y1: y1, v: cl };
    ids = Object.keys(all).sort(function (p, q) { return all[q].t - all[p].t; });
    ids.slice(CLIM_MAX).forEach(function (k) { delete all[k]; });
    C.store(CLK, all);
  }
  function climFetch() {
    var city = st().city, key = climKey(city), cid = P.cityId, y1 = expectY1(), y0 = y1 - (D.CFG.clim.years - 1);
    if (inflight[key] || (failAt[key] && Date.now() - failAt[key] < FAIL_BACKOFF)) return;
    var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 20000);
    inflight[key] = true;
    var url = ARCHIVE + '?latitude=' + city.lat.toFixed(2) + '&longitude=' + city.lon.toFixed(2) + '&start_date=' + y0 + '-01-01&end_date=' + y1 + '-12-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto';
    fetch(url, { signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (json) {
        var cl = D.climateFromArchive(json, D.CFG.clim.years);
        if (!cl) { failAt[key] = Date.now(); return; }
        climSave(key, y1, cl);
        if (P.open && P.cityId === cid) paintClim();   // başka şehre geçildiyse eski sonuç panele yazılmaz (yalnızca önbelleğe girer)
      })
      .catch(function () { failAt[key] = Date.now(); })
      .then(function () { clearTimeout(to); delete inflight[key]; });
  }
  function ensureClimate() {
    if (P.tab !== 'temp' && P.tab !== 'rain') return;
    var r = climRec();
    if (r) paintClim();
    if (climFresh(r) || navigator.onLine === false) return;   // taze (veya çevrimdışı: eldekiyle yetin) → ağ yok
    climFetch();
  }
  function monthsSvg(cl, kind) {
    var W = 320, Hh = 118, L = 34, R = 6, T = 8, B = 20, step = (W - L - R) / 12, cur = +dat().current.time.slice(5, 7) - 1, g = '', m, vals = [];
    for (m = 0; m < 12; m++) { var o = cl.mon[m]; if (kind === 'temp') { if (o.x !== null) vals.push(o.x); if (o.n !== null) vals.push(o.n); } else if (o.p !== null) vals.push(o.p); }
    if (vals.length < 6) return '';
    var lo = kind === 'temp' ? Math.min.apply(null, vals) : 0, hi = Math.max.apply(null, vals);
    if (hi - lo < (kind === 'temp' ? 6 : 20)) hi = lo + (kind === 'temp' ? 6 : 20);
    var pad = kind === 'temp' ? (hi - lo) * 0.08 : 0; if (kind === 'temp') { lo -= pad; hi += pad; }
    var Y = function (v) { return T + (hi - v) / (hi - lo) * (Hh - T - B); };
    [lo, (lo + hi) / 2, hi].forEach(function (v) { g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="rgba(255,255,255,.14)"/><text x="' + (L - 5) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end" class="ct">' + (kind === 'temp' ? C.num(v) + '°' : C.round(v)) + '</text>'; });
    for (m = 0; m < 12; m++) {
      var o2 = cl.mon[m], x = L + m * step + step * 0.2, bw = step * 0.6, on = m === cur, fill = on ? COL.gold : 'rgba(255,255,255,.55)';
      if (kind === 'temp') { if (o2.x === null || o2.n === null) continue; g += '<rect x="' + x.toFixed(1) + '" y="' + Y(o2.x).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(3, Y(o2.n) - Y(o2.x)).toFixed(1) + '" rx="3" fill="' + fill + '"/>'; }
      else { if (o2.p === null) continue; g += '<rect x="' + x.toFixed(1) + '" y="' + Y(o2.p).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1.5, Y(0) - Y(o2.p)).toFixed(1) + '" rx="3" fill="' + (on ? COL.gold : COL.rain) + '"/>'; }
      g += '<text x="' + (L + m * step + step / 2).toFixed(1) + '" y="' + (Hh - 6) + '" text-anchor="middle" class="ct"' + (on ? ' font-weight="700"' : '') + '>' + D.MON[m] + '</text>';
    }
    return '<svg class="dt-months" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="' + (kind === 'temp' ? 'Aylık ortalama en düşük ve en yüksek sıcaklık' : 'Aylık ortalama yağış (mm)') + '">' + g + '</svg>';
  }
  function climHtml() {
    var r = climRec(); if (!r) return '';
    var cl = r.v, dl = dat().daily, date = dat().current.time.slice(0, 10), cur = +date.slice(5, 7) - 1, src = '<p class="hint">Kaynak: Open-Meteo tarihsel veri (ERA5), son ' + cl.years + ' yılın ortalaması.</p>';
    if (P.tab === 'temp') {
      var nor = D.climateNormal(cl, date), tx = dl.temperature_2m_max && dl.temperature_2m_max[0], tn = dl.temperature_2m_min && dl.temperature_2m_min[0], out = '', sentence = '';
      if (nor && M.num(tx) !== null && M.num(tn) !== null) {
        sentence = D.climateSentence(tx, tn, nor, cl.years);
        var lo = Math.min(nor.tmin, tn) - 2, hi = Math.max(nor.tmax, tx) + 2, pos = function (v) { return ((v - lo) / (hi - lo) * 100).toFixed(1); };
        out += '<div class="dt-range" role="img" aria-label="Bugün ' + C.deg(tn) + ' ile ' + C.deg(tx) + ', ortalama ' + C.deg(nor.tmin) + ' ile ' + C.deg(nor.tmax) + '"><i class="nr" style="left:' + pos(nor.tmin) + '%;width:' + (pos(nor.tmax) - pos(nor.tmin)).toFixed(1) + '%"></i><i class="td" style="left:' + pos(tn) + '%;width:' + Math.max(1.5, pos(tx) - pos(tn)).toFixed(1) + '%"></i></div>' +
          '<div class="dt-rl"><span><u class="nr"></u>Ortalama ' + C.deg(nor.tmin) + ' – ' + C.deg(nor.tmax) + '</span><span><u class="td"></u>Bugün ' + C.deg(tn) + ' – ' + C.deg(tx) + '</span></div>';
      }
      var ms = monthsSvg(cl, 'temp'), mo = cl.mon[cur];
      if (!sentence && !ms) return '';
      return '<section class="dt-box" aria-label="Mevsim ortalaması">' + (sentence ? '<h3>Bu dönemin ortalaması</h3><p class="dt-s">' + esc(sentence) + '</p>' + out : '') +
        (ms ? '<h3>Aylık ortalamalar</h3>' + ms + '<p class="hint">Çubuk, ayın ortalama en düşük ve en yüksek sıcaklığı arasını gösterir' + (mo && mo.n !== null && mo.x !== null ? ' (bu ay ' + C.deg(mo.n) + ' – ' + C.deg(mo.x) + ')' : '') + '.</p>' : '') + src + '</section>';
    }
    var rs = monthsSvg(cl, 'rain'); if (!rs) return '';
    var p = cl.mon[cur].p;
    return '<section class="dt-box" aria-label="Aylık yağış ortalaması"><h3>Aylık yağış ortalaması</h3>' + (p !== null ? '<p class="dt-s">Bu ay ortalama yağış ' + fmt1(p) + ' mm.</p>' : '') + rs + '<p class="hint">Çubuklar ayın toplam yağışının (mm) çok yıllı ortalamasıdır.</p>' + src + '</section>';
  }
  function paintClim() {
    var box = C.$('dtClim'); if (!box) return;
    box.innerHTML = (P.tab === 'temp' || P.tab === 'rain') ? climHtml() : '';
  }

  // ---------- Panel ----------
  function navHtml() {
    return availTabs().map(function (t) { return '<button type="button" role="tab" class="hr-tab' + (t[0] === P.tab ? ' on' : '') + '" data-tab="' + t[0] + '" aria-selected="' + (t[0] === P.tab) + '">' + t[1] + '</button>'; }).join('');
  }
  function ensureTab() { if (!avail(P.tab)) { var f = availTabs()[0]; P.tab = f ? f[0] : 'temp'; } }
  function paintHour() {
    if (P.tab === 'life') { C.$('dtHead').innerHTML = ''; C.$('dtLead').innerHTML = ''; C.$('dtCharts').innerHTML = ''; C.$('dtBody').innerHTML = lifeHtml(); return; }
    var i = selIndex();
    C.$('dtHead').innerHTML = headHtml(P.tab, i);
    C.$('dtLead').innerHTML = leadHtml(P.tab, i);
    C.$('dtCharts').innerHTML = P.tab === 'sun' ? '' : P.tab === 'drive' ? driveStrip(i) : chartsHtml(P.tab, i);
    C.$('dtBody').innerHTML = bodyHtml(P.tab, i);
  }
  function paintAll() {
    ensureTab();
    var def = tabDef(P.tab);
    C.$('dtTitle').textContent = def[2];
    C.$('dtSub').textContent = st().city ? st().city.name : '';
    C.$('dtNav').innerHTML = navHtml();
    navArrows();
    paintHour(); paintClim();
  }
  // Sekme şeridi okları (0.7.2): gizli sekme olan yönde yarı saydam ‹ / › görünür; uçlarda gizlenir
  function navArrows() {
    var nv = C.$('dtNav'), l = C.$('dtArrL'), r = C.$('dtArrR'); if (!nv || !l || !r) return;
    var max = nv.scrollWidth - nv.clientWidth, x = nv.scrollLeft, showL = max > 4 && x > 4, showR = max > 4 && x < max - 4;
    [[l, showL], [r, showR]].forEach(function (a) { a[0].tabIndex = a[1] ? 0 : -1; });
    var w = C.$('dtNavW'); if (w) { w.classList.toggle('can-l', showL); w.classList.toggle('can-r', showR); w.classList.toggle('noscroll', max <= 4); }
    var x0 = nv.scrollLeft, x1 = x0 + nv.clientWidth;
    [].forEach.call(nv.querySelectorAll('.hr-tab'), function (t) { var a = t.offsetLeft, b = a + t.offsetWidth; t.classList.toggle('cut', max > 4 && (a < x0 - 1 || b > x1 + 1)); });   // kısmen görünen sekme tamamen gizlenir
    [l, r].forEach(function (a, i) { a.style.visibility = (i ? showR : showL) ? 'visible' : 'hidden'; });   // yer ayrılır (şerit kaymaz), gizliyken tıklanmaz
  }
  function centerTab(instant) {
    var nv = C.$('dtNav'), f = nv && nv.querySelector('.hr-tab.on'); if (!f) return;
    navArrows(); void nv.offsetWidth;   // oklar yer ayırdıktan sonra (şerit daralır) ölç
    var max = nv.scrollWidth - nv.clientWidth, to = Math.max(0, Math.min(max, f.offsetLeft - (nv.clientWidth - f.offsetWidth) / 2));
    if (instant || C.reduceMotion() || !nv.scrollTo) nv.scrollLeft = to; else nv.scrollTo({ left: to, behavior: 'smooth' });
    navArrows();
  }
  function open(tab, opener, time) {
    if (!dat() || !dat().hourly || !C.$('dtSheet')) return;
    document.dispatchEvent(new CustomEvent('hd2:sheet', { detail: 'dt' }));   // aynı anda tek alt panel
    if (tab) P.tab = tab;
    P.cityId = C.cityId(st().city); if (opener) P.opener = opener;
    var w = win(); P.time = time && H().time.indexOf(time) >= 0 ? time : H().time[w[0]];
    P.body.innerHTML = '<header class="sh-head"><div class="sh-title"><h2 id="dtTitle"></h2><p id="dtSub"></p></div><button type="button" class="sh-x" data-close aria-label="Kapat">' + C.uiIcon('close', 20) + '</button></header>' +
      '<div class="dt-navw" id="dtNavW"><button type="button" class="dt-arr l" id="dtArrL" data-arr="-1" aria-label="Önceki sekmeler" tabindex="-1"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>' +
      '<div class="hr-tabs dt-nav" id="dtNav" role="tablist" aria-label="Ayrıntı seç"></div>' +
      '<button type="button" class="dt-arr r" id="dtArrR" data-arr="1" aria-label="Sonraki sekmeler" tabindex="-1"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button></div><div id="dtHead"></div><div id="dtLead"></div><div id="dtCharts"></div><div id="dtBody"></div><div id="dtClim"></div>';
    paintAll();
    C.$('dtNav').addEventListener('scroll', navArrows, { passive: true });
    if (P.wrap.hidden) {
      P.wrap.hidden = false; void P.wrap.offsetWidth; P.wrap.classList.add('open'); P.open = true;
      document.documentElement.classList.add('lock');
      C.app.setAttribute('aria-hidden', 'true'); if ('inert' in C.app) C.app.inert = true;
    } else P.open = true;
    P.wrap.querySelector('.sheet').scrollTop = 0;
    var f = P.wrap.querySelector('.hr-tab.on'); if (f) { f.focus({ preventScroll: true }); centerTab(true); }
    navArrows();
    ensureClimate();
  }
  document.addEventListener('hd2:sheet', function (e) { if (e.detail !== 'dt') close(true); });
  function close(silent) {
    if (P.wrap.hidden) return;
    P.wrap.classList.remove('open'); P.open = false;
    document.documentElement.classList.remove('lock');
    C.app.removeAttribute('aria-hidden'); if ('inert' in C.app) C.app.inert = false;
    var done = function () { if (!P.open) { P.wrap.hidden = true; P.wrap.querySelector('.sheet').style.transform = ''; } };
    if (C.reduceMotion() || silent) done(); else setTimeout(done, 260);
    if (!silent && P.opener && document.contains(P.opener)) P.opener.focus();
  }
  // Uygulama yeni veriyi çizdiğinde: aynı şehir → yerinde yenile; başka şehir → eski şehrin verisi kalmasın, kapat
  function sync() {
    if (!P.open || !C) return;
    if (!dat() || !st().city || C.cityId(st().city) !== P.cityId) { close(true); return; }
    paintAll(); ensureClimate();
  }
  function step(dlt) {
    var h = H(), w = win(), n = h.time.indexOf(P.time) + dlt;
    if (n >= w[0] && n <= w[1]) { P.time = h.time[n]; paintHour(); var b = P.wrap.querySelector('.dt-step[data-step="' + dlt + '"]'); if (b) b.focus({ preventScroll: true }); }
  }
  function choose(t) { if (H().time.indexOf(t) < 0) return; P.time = t; paintHour(); }

  function bind() {
    P.wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]') || e.target.classList.contains('sheet-bg')) { close(); return; }
      var ar = e.target.closest('.dt-arr');
      if (ar) { var nv0 = C.$('dtNav'), dx = (+ar.dataset.arr) * Math.max(120, Math.round(nv0.clientWidth * 0.7)); if (C.reduceMotion() || !nv0.scrollBy) nv0.scrollLeft += dx; else nv0.scrollBy({ left: dx, behavior: 'smooth' }); setTimeout(navArrows, 60); return; }
      var tb = e.target.closest('.hr-tab');
      if (tb) { P.tab = tb.dataset.tab; paintAll(); var nt = P.wrap.querySelector('.hr-tab.on'); if (nt) { nt.focus({ preventScroll: true }); centerTab(false); } ensureClimate(); return; }
      var sb = e.target.closest('.dt-step'); if (sb) { step(+sb.dataset.step); return; }
      var dr = e.target.closest('.dr-h'); if (dr) { choose(dr.dataset.t); var nb = P.wrap.querySelector('.dr-h.on'); if (nb) nb.focus({ preventScroll: true }); return; }
    });
    window.addEventListener('resize', function () { if (P.open) navArrows(); });
    var drag = false;
    function pickFromChart(e) {
      var svg = e.target.closest && e.target.closest('.hr-chart'); if (!svg) return;
      var rc = svg.getBoundingClientRect(), W = +svg.dataset.w, L = +svg.dataset.l, stp = +svg.dataset.step, n = +svg.dataset.n;
      var k = Math.floor(((e.clientX - rc.left) / rc.width * W - L) / stp); k = Math.max(0, Math.min(n - 1, k));
      var idx = +svg.dataset.from + k, w = win(); if (idx < w[0]) idx = w[0]; if (idx > w[1]) idx = w[1];
      var t = H().time[idx]; if (t !== P.time) choose(t);
    }
    P.wrap.addEventListener('pointerdown', function (e) { if (e.target.closest('.hr-chart')) { drag = true; pickFromChart(e); } });
    P.wrap.addEventListener('pointermove', function (e) { if (drag) pickFromChart(e); });
    var endDrag = function () { drag = false; }; P.wrap.addEventListener('pointerup', endDrag); P.wrap.addEventListener('pointercancel', endDrag);
    document.addEventListener('keydown', function (e) {
      if (P.wrap.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.closest && (e.target.closest('.dt-hour') || e.target.closest('.dt-nav'))) {
        if (e.target.closest('.dt-hour')) { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); }
        return;
      }
      if (e.key === 'Tab') {
        var f = Array.prototype.filter.call(P.wrap.querySelectorAll('button:not([disabled]), summary'), function (b) { return b.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    var grip = C.$('dtGrip'), panel = P.wrap.querySelector('.sheet'), y0 = null, dy = 0;
    grip.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; panel.style.transition = 'none'; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; });
    function end() { if (y0 == null) return; y0 = null; panel.style.transition = ''; if (dy > 90) close(); else panel.style.transform = ''; }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  }

  window.HDDetail = {
    init: function (ctx) { C = ctx; P.wrap = C.$('dtSheet'); P.body = C.$('dtRoot'); if (P.wrap) bind(); },
    open: open, close: function () { close(); }, sync: sync,
    _state: function () { return { open: P.open, tab: P.tab, time: P.time, cityId: P.cityId, climInflight: Object.keys(inflight).length }; }
  };
})();
