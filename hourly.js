/* Saatlik ayrıntı paneli (alt sayfa). Kendi ağ isteği ATMAZ: yalnızca uygulamanın zaten elinde olan tahmin (state.data) ve hava kalitesi (state.aq) verisini gösterir.
   Hesaplar meteo.js'te (basınç trendi, fırtına/dolu riski); hava kalitesi sınıfları eaqi.js'te (Worker ile ortak). Eksik değişken = kart gizlenir; 0 ile karıştırılmaz.
   Grafikler: elle çizilen küçük SVG (kütüphane yok), her seferinde yalnızca seçili sekme. */
'use strict';
(function () {
  var C = null, M = window.METEO, E = window.EAQI;
  var P = { wrap: null, body: null, open: false, time: null, cityId: null, tab: 'temp', opener: null };
  var TABS = [['temp', 'Sıcaklık'], ['rain', 'Yağış'], ['wind', 'Rüzgâr'], ['press', 'Basınç'], ['uv', 'UV']];
  var COL = { temp: '#ffd27a', feels: 'rgba(255,255,255,.75)', rain: '#8fd8ff', prob: '#ffffff', wind: '#b6f0e0', gust: '#ffb86b', press: '#d9c9ff' };
  var RISK_COL = ['#5ad28f', '#f0d94a', '#ff6b5e'];

  function d() { return C.state.data; }
  function esc(s) { return C.esc(s); }
  function fmt1(v) { return (Math.round(v * 10) / 10).toLocaleString('tr-TR', { maximumFractionDigits: 1 }); }
  function has(arr, i) { return M.at(arr, i) !== null; }
  function anyData(arr, a, b) { for (var i = a; i <= b; i++) if (has(arr, i)) return true; return false; }
  function winRange() { var h = d().hourly, s = C.state.start || 0; return [s, Math.min(s + 23, h.time.length - 1)]; }
  function dayLabel(t) {
    var cur = d().current.time.slice(0, 10), p = C.parts(t);
    if (t.slice(0, 10) === cur) return 'Bugün';
    var c = C.parts(cur + 'T12:00'), a = Date.UTC(p.y, p.mo - 1, p.d), b = Date.UTC(c.y, c.mo - 1, c.d);
    if (a - b === 86400000) return 'Yarın';
    return new Date(p.y, p.mo - 1, p.d).toLocaleDateString('tr-TR', { weekday: 'long' });
  }

  // ---------- Parçalar ----------
  function tile(icon, label, value, sub, cls, extra) {
    return '<div class="sh-tile' + (cls ? ' ' + cls : '') + '"><span>' + (icon ? C.uiIcon(icon, 15) : '') + label + '</span><b>' + value + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + (extra || '') + '</div>';
  }
  // Ayrıntı ekranına geçiş: karo dokunulabilir olur (yapı değişmez)
  function dtLink(id, name, html) { return html ? html.replace('<div class="sh-tile', '<div data-dt="' + id + '" role="button" tabindex="0" aria-haspopup="dialog" aria-label="' + name + ' ayrıntılarını aç" class="sh-tile dt-link') : html; }
  function chip(text, color) { return '<em class="chipuv" style="background:' + color + '">' + esc(text) + '</em>'; }
  function aqAt(time, i) {
    var aq = C.state.aq; if (!aq) return null;
    var k = aq.hourly && aq.hourly.time ? aq.hourly.time.indexOf(time) : -1;
    if (k >= 0 && M.num(aq.hourly.eaqi && aq.hourly.eaqi[k]) !== null) {
      return { value: E.round(aq.hourly.eaqi[k]), level: E.level(aq.hourly.eaqi[k]), pm25: M.at(aq.hourly.pm25, k), pm10: M.at(aq.hourly.pm10, k) };
    }
    if (i === C.state.start) { var c = aq.comps || [], f = function (key) { for (var j = 0; j < c.length; j++) if (c[j].key === key) return c[j].val; return null; }; return { value: aq.value, level: aq.level, pm25: f('pm2_5'), pm10: f('pm10') }; }
    return null;
  }

  function topHtml(i) {
    var h = d().hourly, t = h.time[i], day = h.is_day ? h.is_day[i] === 1 : true, info = C.describe(h.weather_code[i], day), ap = M.at(h.apparent_temperature, i), tp = M.at(h.temperature_2m, i);
    return '<div class="sh-now">' + C.weatherIcon(info.kind, day, 64, false) + '<div><div class="sh-t"><b>' + (tp === null ? '—' : C.deg(tp)) + '</b>' +
      (ap !== null ? '<span>Hissedilen ' + C.deg(ap) + '</span>' : '') + '</div><p>' + esc(info.text) + '</p></div></div>';
  }

  function riskTile(title, rk, icon) {
    if (!rk.known) return tile(icon, title, '<span class="rk-none">Veri yok</span>', 'Yeterli veri yok', 'rk');
    var why = rk.level === 0 ? (rk.instability ? 'Kararsızlık var, diğer işaretler zayıf.' : 'Belirgin bir işaret yok.') : rk.reasons.join(' ');
    return tile(icon, title, '<span class="rk-lv" style="color:' + RISK_COL[rk.level] + '">' + rk.label + '</span>', esc(why) + ' <small class="rk-c">Güven: ' + rk.confidence + '</small>', 'rk');
  }

  function windTile(h, i) {
    var w = M.at(h.wind_speed_10m, i), g = M.at(h.wind_gusts_10m, i), dr = M.at(h.wind_direction_10m, i);
    if (w === null && g === null) return '';
    var bf = w !== null ? M.beaufort(w) : null, dn = dr !== null ? M.dir(dr) : null, w3 = M.at(h.wind_speed_10m, i - 3);
    var trend = w !== null && w3 !== null ? (w - w3 >= 10 ? 'Önceki saatlere göre güçleniyor' : w3 - w >= 10 ? 'Önceki saatlere göre zayıflıyor' : '') : '';
    var dial = dr === null ? '' : '<svg class="dial" viewBox="0 0 48 48" width="56" height="56" role="img" aria-label="Rüzgâr ' + dn.long + ' yönünden esiyor">' +
      '<circle cx="24" cy="24" r="21" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.4)" stroke-width="1.5"/>' +
      '<path d="M24 3v4M24 41v4M3 24h4M41 24h4" stroke="rgba(255,255,255,.55)" stroke-width="1.5" stroke-linecap="round"/>' +
      '<text x="24" y="17" text-anchor="middle" font-size="7" font-weight="700" fill="rgba(255,255,255,.8)">K</text>' +
      '<g style="transform-origin:24px 24px;transform:rotate(' + ((C.round(dr) + 180) % 360) + 'deg)"><path d="M24 11l6 17-6-3.5L18 28z" fill="#fff"/></g></svg>';
    return '<div class="sh-tile wide"><span>' + C.uiIcon('wind', 15) + 'Rüzgâr</span><div class="wd-row"><div>' +
      '<b>' + (w !== null ? C.round(w) + ' km/sa' : '—') + '</b>' +
      (g !== null ? '<em>Hamle ' + C.round(g) + ' km/sa</em>' : '') +
      (bf ? '<em>' + bf.n + ' Beaufort · ' + bf.label + '</em>' : '') +
      (dn ? '<em>' + dn.long + ' yönünden · ' + C.round(dr) + '°</em>' : '') +
      (trend ? '<em>' + trend + '</em>' : '') + '</div>' + dial + '</div></div>';
  }

  function leadHtml(i) {
    var h = d().hourly, age = Date.now() - (C.state.dataT || Date.now()), note = '';
    if (C.state.stale || age > 2 * 3600000) note = '<p class="hr-note">Gösterilen veri eski' + (navigator.onLine === false ? ' (çevrimdışı)' : '') + '. Son güncelleme: ' + esc(C.stamp(C.state.dataT || Date.now())) + '.</p>';
    return note + '<p class="sh-comment">' + esc(M.hourSummary(h, i)) + '</p>';
  }
  function detailHtml(i) {
    var h = d().hourly, t = h.time[i], out = [], v, k;
    var tiles = [];
    if ((v = M.at(h.precipitation_probability, i)) !== null) tiles.push(dtLink('rain', 'Yağış', tile('umbrella', 'Yağış ihtimali', '%' + C.round(v), '', '', '<i class="sh-g"><u style="width:' + C.round(v) + '%"></u></i>')));
    if ((v = M.at(h.precipitation, i)) !== null) {
      var rain = M.at(h.rain, i), snow = M.at(h.snowfall, i), sub = [];
      if (rain !== null && rain > 0) sub.push('Yağmur ' + fmt1(rain) + ' mm'); if (snow !== null && snow > 0) sub.push('Kar ' + fmt1(snow) + ' cm');
      tiles.push(dtLink('rain', 'Yağış', tile('drop', 'Yağış miktarı', fmt1(v) + ' mm', sub.join(' · '))));
    }
    if ((v = M.at(h.relative_humidity_2m, i)) !== null) { var dp = M.at(h.dew_point_2m, i); tiles.push(dtLink('hum', 'Nem', tile('drop', 'Nem', '%' + C.round(v), dp !== null ? 'Çiy noktası ' + C.deg(dp) : ''))); }
    else if ((v = M.at(h.dew_point_2m, i)) !== null) tiles.push(dtLink('hum', 'Nem', tile('drop', 'Çiy noktası', C.deg(v), '')));
    if ((v = M.at(h.cloud_cover, i)) !== null) tiles.push(tile('cloud', 'Bulut', '%' + C.round(v), ''));
    if ((v = M.at(h.visibility, i)) !== null) tiles.push(dtLink('vis', 'Görüş', tile('eye', 'Görüş', v >= 1000 ? fmt1(v / 1000) + ' km' : C.round(v) + ' m', M.visibilityText(v))));
    if ((v = M.at(h.uv_index, i)) !== null) { var uc = C.UV_CLASSES[C.uvClass(v)]; tiles.push(dtLink('uv', 'UV', tile('sun', 'UV indeksi', fmt1(v), '', '', chip(uc[0], uc[1])))); }
    if ((v = M.at(h.freezing_level_height, i)) !== null) tiles.push(tile('snowflake', 'Donma seviyesi', Math.round(v).toLocaleString('tr-TR') + ' m', ''));
    var aq = aqAt(t, i);
    if (aq) tiles.push(tile('mask', 'Hava kalitesi', aq.value, '', '', chip(E.LABEL[aq.level], window.Insights.AQ_COLOR[aq.level]) + (aq.pm25 !== null || aq.pm10 !== null ? '<em>' + (aq.pm25 !== null ? 'PM2.5 ' + fmt1(aq.pm25) : '') + (aq.pm25 !== null && aq.pm10 !== null ? ' · ' : '') + (aq.pm10 !== null ? 'PM10 ' + fmt1(aq.pm10) : '') + ' µg/m³</em>' : '')));
    else if (C.state.aqState === 'loading') tiles.push(tile('mask', 'Hava kalitesi', '…', 'Yükleniyor'));
    else tiles.push(tile('mask', 'Hava kalitesi', '<span class="rk-none">Veri yok</span>', C.state.aqState === 'error' ? 'Alınamadı' : 'Bu saat için tahmin yok'));
    out.push('<div class="sh-grid">' + tiles.join('') + '</div>');

    out.push(windTile(h, i) ? '<div class="sh-grid one">' + dtLink('wind', 'Rüzgâr', windTile(h, i)) + '</div>' : '');

    var pt = M.pressureTrend(h.pressure_msl, i), pv = M.at(h.pressure_msl, i);
    if (pv !== null) out.push('<div class="sh-grid one">' + dtLink('press', 'Basınç', tile('gauge', 'Basınç', Math.round(pv).toLocaleString('tr-TR') + ' hPa', pt.ok ? '<strong class="pt-' + pt.cls + '">' + pt.label + '</strong> · ' + esc(pt.sentence) : esc(pt.sentence), 'wide')) + '</div>');

    var rk = M.risksAt(h, i);
    out.push('<div class="sh-grid">' + riskTile('Fırtına riski', rk.storm, 'bolt') + riskTile('Dolu riski', rk.hail, 'cloud') + '</div>');
    var x = M.inputs(h, i), tech = [];
    if (x.cape !== null) tech.push('CAPE: ' + C.round(x.cape) + ' J/kg'); if (x.li !== null) tech.push('Kaldırma indeksi: ' + fmt1(x.li)); if (x.cin !== null) tech.push('CIN: ' + C.round(x.cin) + ' J/kg');
    if (tech.length) out.push('<details class="hr-tech"><summary>Teknik değerler</summary><p>' + tech.map(esc).join(' · ') + '</p><p class="hint">Risk, bu değerlerin ve rüzgâr, yağış, basınç ile hava kodunun birlikte yorumuyla bulunur; kesin tahmin değildir.</p></details>');
    return out.join('');
  }

  // ---------- Grafik ----------
  function chartSpec(tab, h, a, b) {
    var s = C.state.start, from = a, S = function (key, f) { var o = []; for (var i = f; i <= b; i++) o.push(M.at(h[key], i)); return o; };
    if (tab === 'temp') return { from: from, unit: '°', lines: [{ vals: S('temperature_2m', from), color: COL.temp, w: 1.9 }, { vals: S('apparent_temperature', from), color: COL.feels, w: 1.4, dash: '4 4' }], bars: [], minSpan: 4, fmt: function (v) { return C.deg(v); },
      cap: 'Düz çizgi sıcaklık, kesik çizgi hissedilen.' };
    if (tab === 'rain') return { from: from, lines: [{ vals: S('precipitation_probability', from), color: COL.prob, w: 1.4, own: [0, 100] }], bars: [{ vals: S('precipitation', from), color: COL.rain }], yMin: 0, minSpan: 2, fmt: function (v) { return fmt1(v) + ' mm'; },
      cap: 'Sütunlar yağış miktarı (mm), çizgi yağış ihtimali (%).' };
    if (tab === 'wind') return { from: from, lines: [{ vals: S('wind_speed_10m', from), color: COL.wind, w: 1.9 }, { vals: S('wind_gusts_10m', from), color: COL.gust, w: 1.4, dash: '4 4' }], bars: [], yMin: 0, minSpan: 20, fmt: function (v) { return C.round(v) + ' km/sa'; },
      cap: 'Düz çizgi rüzgâr, kesik çizgi hamle (km/sa).' };
    if (tab === 'press') { var pf = Math.max(0, s - 12); return { from: pf, now: s, lines: [{ vals: S('pressure_msl', pf), color: COL.press, w: 1.9 }], bars: [], minSpan: 6, fmt: function (v) { return C.round(v) + ' hPa'; }, cap: 'Son 12 saat ve önümüzdeki 24 saat (hPa).' }; }
    if (tab === 'uv') return { from: from, lines: [], bars: [{ vals: S('uv_index', from), colorFn: function (v) { return C.UV_CLASSES[C.uvClass(v)][1]; } }], yMin: 0, minSpan: 6, fmt: function (v) { return fmt1(v); }, cap: 'UV indeksi; renk şiddeti gösterir.' };
    return null;
  }
  function tabAvailable(tab, h, a, b) {
    var sp = chartSpec(tab, h, a, b); if (!sp) return false;
    var any = false; sp.lines.concat(sp.bars).forEach(function (s) { s.vals.forEach(function (v) { if (v !== null) any = true; }); });
    return any;
  }
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
  function drawChart(sp, h, sel) {
    var W = 320, H = 150, L = 38, R = 8, T = 10, B = 24, n = sp.lines.concat(sp.bars)[0].vals.length, step = (W - L - R) / n;
    var vals = []; sp.lines.concat(sp.bars).forEach(function (s) { if (s.own) return; s.vals.forEach(function (v) { if (v !== null) vals.push(v); }); });
    if (!vals.length) vals = [0, 1];
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (sp.yMin != null) lo = sp.yMin; if (sp.yMax != null) hi = sp.yMax;
    if (hi - lo < sp.minSpan) { var mid = (hi + lo) / 2; if (sp.yMin != null) hi = lo + sp.minSpan; else { lo = mid - sp.minSpan / 2; hi = mid + sp.minSpan / 2; } }
    else if (sp.yMin == null) { var pad = (hi - lo) * 0.08; lo -= pad; hi += pad; }
    var X = function (k) { return L + (k + 0.5) * step; }, Y = function (v, own) { var l = own ? own[0] : lo, u = own ? own[1] : hi; return T + (u - v) / (u - l) * (H - T - B); };
    var g = '', k, s;
    [lo, (lo + hi) / 2, hi].forEach(function (v) { g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="rgba(255,255,255,.14)"/><text x="' + (L - 5) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end" class="ct">' + esc(sp.unit === '°' ? C.num(v) + '°' : sp.fmt(v).replace(/ .*$/, '')) + '</text>'; });
    var selK = sel - sp.from;
    if (selK >= 0 && selK < n) g += '<rect x="' + (L + selK * step).toFixed(1) + '" y="' + T + '" width="' + step.toFixed(1) + '" height="' + (H - T - B) + '" fill="rgba(255,255,255,.16)" rx="3"/>';
    sp.bars.forEach(function (bs) {
      var bw = Math.max(2, step * 0.62);
      bs.vals.forEach(function (v, kk) { if (v === null) return; var y = Y(Math.max(v, lo)), hh = Math.max(v > 0 ? 1.5 : 0, Y(lo) - y); g += '<rect x="' + (X(kk) - bw / 2).toFixed(1) + '" y="' + (Y(lo) - hh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="1.5" fill="' + (bs.colorFn ? bs.colorFn(v) : bs.color) + '"/>'; });
    });
    sp.lines.forEach(function (ls) {
      var path = linePath(ls.vals.map(function (v, kk) { return v === null ? null : [X(kk), Y(v, ls.own)]; }));
      g += '<path d="' + path + '" fill="none" stroke="' + ls.color + '" stroke-width="' + ls.w + '" stroke-linecap="round" stroke-linejoin="round"' + (ls.dash ? ' stroke-dasharray="' + ls.dash + '"' : '') + '/>';
    });
    if (selK >= 0 && selK < n) { s = sp.lines[0] || sp.bars[0]; var sv = s.vals[selK]; if (sv !== null) g += '<circle cx="' + X(selK).toFixed(1) + '" cy="' + Y(sv, s.own).toFixed(1) + '" r="4.5" fill="#fff" stroke="' + (s.color || '#fff') + '" stroke-width="2"/>'; }
    if (sp.now != null) { var nk = sp.now - sp.from; g += '<line x1="' + X(nk).toFixed(1) + '" x2="' + X(nk).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="rgba(255,255,255,.5)" stroke-dasharray="3 3"/>'; }
    for (k = 0; k < n; k++) { var tm = h.time[sp.from + k], hr = +tm.slice(11, 13); if (hr % 6 === 0) g += '<text x="' + X(k).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" class="ct">' + tm.slice(11, 16) + '</text>'; }
    var label = sp.cap + ' ' + hm(h.time[sel]) + ': ' + (function () { var s0 = sp.lines[0] || sp.bars[0], v = s0 && s0.vals[selK]; return v == null ? 'veri yok' : sp.fmt(v); })();
    return '<svg class="hr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '" data-from="' + sp.from + '" data-n="' + n + '" data-l="' + L + '" data-step="' + step + '" data-w="' + W + '">' + g + '</svg>';
  }
  function hm(s) { return s.slice(11, 16); }
  function chartHtml(i) {
    var h = d().hourly, r = winRange(), tabs = TABS.filter(function (t) { return tabAvailable(t[0], h, r[0], r[1]); });
    if (!tabs.length) return '';
    if (!tabs.some(function (t) { return t[0] === P.tab; })) P.tab = tabs[0][0];
    var sp = chartSpec(P.tab, h, r[0], r[1]);
    return '<section class="hr-charts" aria-label="Saatlik grafikler"><div class="hr-tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" class="hr-tab' + (t[0] === P.tab ? ' on' : '') + '" data-tab="' + t[0] + '" aria-selected="' + (t[0] === P.tab) + '">' + t[1] + '</button>';
    }).join('') + '</div><div id="hrChart">' + drawChart(sp, h, i) + '</div><p class="hint" id="hrCap">' + esc(sp.cap) + ' Seçmek için grafiğe dokun.</p></section>';
  }

  // ---------- Panel ----------
  function pickerHtml(sel) {
    var h = d().hourly, r = winRange(), out = '', i;
    for (i = r[0]; i <= r[1]; i++) {
      var day = h.is_day ? h.is_day[i] === 1 : true, info = C.describe(h.weather_code[i], day), tp = M.at(h.temperature_2m, i);
      out += '<button type="button" class="hp-b' + (i === sel ? ' on' : '') + '" data-t="' + esc(h.time[i]) + '" aria-pressed="' + (i === sel) + '" aria-label="' + (i === r[0] ? 'Şimdi' : hm(h.time[i])) + '"><span>' + (i === r[0] ? 'Şimdi' : hm(h.time[i])) + '</span>' + C.weatherIcon(info.kind, day, 26, false) + '<b>' + (tp === null ? '—' : C.deg(tp)) + '</b></button>';
    }
    return out;
  }
  function selIndex() {
    var h = d().hourly, r = winRange(), i = h.time.indexOf(P.time);
    if (i < r[0] || i > r[1]) i = r[0];
    P.time = h.time[i]; return i;
  }
  function paint(full) {
    var h = d().hourly, i = selIndex(), t = h.time[i];
    C.$('hrTitle').textContent = dayLabel(t) + ' ' + hm(t);
    C.$('hrSub').textContent = C.state.city ? C.state.city.name : '';
    var pk = C.$('hrPick');
    if (full || !pk.firstChild) { var sl = pk.scrollLeft; pk.innerHTML = pickerHtml(i); pk.scrollLeft = sl; }
    else Array.prototype.forEach.call(pk.children, function (b) { var on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    C.$('hrTop').innerHTML = topHtml(i);
    C.$('hrLead').innerHTML = leadHtml(i);
    C.$('hrChartBox').innerHTML = chartHtml(i);
    C.$('hrDetail').innerHTML = detailHtml(i);
  }
  function centerPick() {
    var pk = C.$('hrPick'), b = pk.querySelector('.hp-b.on'); if (!b) return;
    pk.scrollLeft = b.offsetLeft - (pk.clientWidth - b.offsetWidth) / 2;
  }
  function choose(time, keepFocus) {
    if (!d() || d().hourly.time.indexOf(time) < 0) return;
    P.time = time; paint(false);
    var b = C.$('hrPick').querySelector('.hp-b.on'); if (b && keepFocus) { b.focus({ preventScroll: true }); }
    if (b) { var pk = C.$('hrPick'); if (b.offsetLeft < pk.scrollLeft || b.offsetLeft + b.offsetWidth > pk.scrollLeft + pk.clientWidth) centerPick(); }
  }
  function open(time, opener) {
    if (!d() || !d().hourly || d().hourly.time.indexOf(time) < 0) return;
    document.dispatchEvent(new CustomEvent('hd2:sheet', { detail: 'hr' }));   // aynı anda tek alt panel
    P.time = time; P.cityId = C.cityId(C.state.city); if (opener) P.opener = opener;
    C.$('hrBody').innerHTML = '<header class="sh-head"><div class="sh-title"><h2 id="hrTitle"></h2><p id="hrSub"></p></div><button type="button" class="sh-x" data-close aria-label="Kapat">' + C.uiIcon('close', 20) + '</button></header>' +
      '<div id="hrTop"></div><div class="hp" id="hrPick" role="group" aria-label="Saat seç"></div><div id="hrLead"></div><div id="hrChartBox"></div><div id="hrDetail"></div>';
    paint(true);
    if (P.wrap.hidden) {
      P.wrap.hidden = false; void P.wrap.offsetWidth; P.wrap.classList.add('open'); P.open = true;
      document.documentElement.classList.add('lock');
      C.app.setAttribute('aria-hidden', 'true'); if ('inert' in C.app) C.app.inert = true;
    }
    centerPick();
    var f = P.wrap.querySelector('.hp-b.on'); if (f) f.focus({ preventScroll: true });
  }
  document.addEventListener('hd2:sheet', function (e) { if (e.detail !== 'hr') close(true); });
  function close(silent) {
    if (P.wrap.hidden) return;
    P.wrap.classList.remove('open'); P.open = false;
    document.documentElement.classList.remove('lock');
    C.app.removeAttribute('aria-hidden'); if ('inert' in C.app) C.app.inert = false;
    var done = function () { if (!P.open) { P.wrap.hidden = true; P.wrap.querySelector('.sheet').style.transform = ''; } };
    if (C.reduceMotion() || silent) done(); else setTimeout(done, 260);
    if (!silent && P.opener && document.contains(P.opener)) P.opener.focus();
  }
  // Uygulama yeni veri/hava kalitesi çizdiğinde: aynı şehir → yerinde yenile; başka şehir → eski şehrin verisi kalmasın, kapat
  function sync() {
    if (!P.open || !C) return;
    if (!d() || !C.state.city || C.cityId(C.state.city) !== P.cityId) { close(true); return; }
    paint(true);
  }

  function bind() {
    P.wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]') || e.target.classList.contains('sheet-bg')) { close(); return; }
      var dtl = e.target.closest('[data-dt]'); if (dtl && window.HDDetail) { var tm = P.time, op = P.opener; close(true); window.HDDetail.open(dtl.dataset.dt, op, tm); return; }
      var pb = e.target.closest('.hp-b'); if (pb) { choose(pb.dataset.t, false); return; }
      var tb = e.target.closest('.hr-tab'); if (tb) { P.tab = tb.dataset.tab; var i = selIndex(); C.$('hrChartBox').innerHTML = chartHtml(i); var nt = P.wrap.querySelector('.hr-tab.on'); if (nt) nt.focus({ preventScroll: true }); return; }
    });
    // grafiğe dokunma/sürükleme → saat seçer
    var drag = false;
    function pickFromChart(e) {
      var svg = e.target.closest && e.target.closest('.hr-chart'); if (!svg) return;
      var rc = svg.getBoundingClientRect(), W = +svg.dataset.w, L = +svg.dataset.l, step = +svg.dataset.step, n = +svg.dataset.n;
      var k = Math.floor(((e.clientX - rc.left) / rc.width * W - L) / step); k = Math.max(0, Math.min(n - 1, k));
      var idx = +svg.dataset.from + k, r = winRange(); if (idx < r[0]) idx = r[0]; if (idx > r[1]) idx = r[1];
      var t = d().hourly.time[idx]; if (t !== P.time) choose(t, false);
    }
    P.wrap.addEventListener('pointerdown', function (e) { if (e.target.closest('.hr-chart')) { drag = true; pickFromChart(e); } });
    P.wrap.addEventListener('pointermove', function (e) { if (drag) pickFromChart(e); });
    var endDrag = function () { drag = false; }; P.wrap.addEventListener('pointerup', endDrag); P.wrap.addEventListener('pointercancel', endDrag);
    document.addEventListener('keydown', function (e) {
      if (P.wrap.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target === e.target.closest('[data-dt]') && window.HDDetail) { e.preventDefault(); var tm2 = P.time, op2 = P.opener; close(true); window.HDDetail.open(e.target.dataset.dt, op2, tm2); return; }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.closest && e.target.closest('.hp')) {
        var h = d().hourly, i = h.time.indexOf(P.time), r = winRange(), n = i + (e.key === 'ArrowRight' ? 1 : -1);
        if (n >= r[0] && n <= r[1]) { e.preventDefault(); choose(h.time[n], true); }
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
    var grip = C.$('hrGrip'), panel = P.wrap.querySelector('.sheet'), y0 = null, dy = 0;
    grip.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; panel.style.transition = 'none'; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; });
    function end() { if (y0 == null) return; y0 = null; panel.style.transition = ''; if (dy > 90) close(); else panel.style.transform = ''; }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  }

  window.HDHourly = {
    init: function (ctx) { C = ctx; P.wrap = C.$('hrSheet'); P.body = C.$('hrBody'); if (P.wrap) bind(); },
    open: open, close: function () { close(); }, sync: sync,
    _state: function () { return { open: P.open, time: P.time, tab: P.tab, cityId: P.cityId }; }
  };
})();
