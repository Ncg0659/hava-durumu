/* EYRIVO Geçmişe Yolculuk (0.8.x geliştirme): "Bu takvim günü son 10 yılda nasıldı?" kartı + paneli.
   Veri: Open-Meteo Historical Weather (Archive) API, ERA5 yeniden analizi (CC BY 4.0, anahtarsız, ücretsiz).
   - TEK istek: konum başına (Y-10)-01-01 … (Y-1)-12-31 aralığı alınır; seçili takvim günü istemcide süzülür.
     Bu yüzden gün değiştirmek ağ isteği atmaz. Yalnızca 6 günlük alan istenir (sıcaklık en yüksek/düşük, yağış, kar, rüzgâr, hava kodu).
   - Önbellek: koordinat (2 ondalık) başına, 30 gün (yıl başında 1 gün). Çevrimdışıyken eldeki kayıt "Önbellekten gösteriliyor" ile gösterilir.
   - Eksik/null değerler 0'a ÇEVRİLMEZ. Eksik yıl atlanır, panel çökmez. 29 Şubat yalnızca artık yıllardan gelir (28 Şubat/1 Mart ile doldurulmaz).
   - Dil: "rekor"/"iklim normali" yok; yalnızca "son 10 yılın en sıcak 5 Kasım'ı" gibi örneklem içi ifadeler.
   Saf kısım (ayrıştırma, süzme, özet, karşılaştırma, grafik SVG'si) tarayıcısız test edilebilir (module.exports). */
'use strict';
(function (g) {
  var ENDPOINT = 'https://archive-api.open-meteo.com/v1/archive';
  var DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,weather_code';
  var YEARS = 10, TTL = 30 * 86400000, TTL_EARLY = 86400000, MAX_ENTRIES = 3, BACKOFF = 2 * 60000;
  var MIN_SUPER = 3;     // en sıcak/en soğuk gibi üstünlük ifadeleri için en az yıl
  var MIN_CMP = 5;       // "bugün – ortalama" karşılaştırması için en az yıl
  var WET_MM = 0.1, SNOW_CM = 0.1, SAME_DELTA = 1;
  var KEYS = { x: 'temperature_2m_max', n: 'temperature_2m_min', p: 'precipitation_sum', s: 'snowfall_sum', w: 'wind_speed_10m_max', c: 'weather_code' };
  var LIM = { x: [-90, 60], n: [-90, 60], p: [0, 1500], s: [0, 500], w: [0, 400], c: [0, 99] };
  var FIELDS = ['x', 'n', 'p', 's', 'w', 'c'];
  var MON = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var ACC = ['ı', 'ı', 'ı', 'ı', 'ı', 'ı', 'u', 'u', 'ü', 'i', 'ı', 'ı'];   // Ocak'ı … Temmuz'u … Eylül'ü … Ekim'i
  var MDAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];             // Şubat = 29 (takvim günü seçimi)
  var CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function dim(y) { return isLeap(y) ? 366 : 365; }
  // Yıl içindeki gün sırası; o yılda olmayan gün (artık olmayan yılda 29 Şubat) → -1
  function dayIdx(y, m, d) {
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= MDAYS[m - 1])) return -1;
    if (m === 2 && d === 29 && !isLeap(y)) return -1;
    return CUM[m - 1] + d - 1 + (m > 2 && isLeap(y) ? 1 : 0);
  }
  function rangeFor(todayStr) {
    var Y = +String(todayStr || '').slice(0, 4);
    if (!(Y > 1950 && Y < 2200)) return null;
    return { y0: Y - YEARS, y1: Y - 1, start: (Y - YEARS) + '-01-01', end: (Y - 1) + '-12-31' };
  }
  function buildUrl(lat, lon, rng) {
    return ENDPOINT + '?latitude=' + (+lat).toFixed(2) + '&longitude=' + (+lon).toFixed(2) + '&start_date=' + rng.start + '&end_date=' + rng.end + '&daily=' + DAILY + '&timezone=auto';
  }
  function blank(y) { var o = {}, n = dim(y), i; FIELDS.forEach(function (f) { o[f] = []; for (i = 0; i < n; i++) o[f].push(null); }); return o; }

  // API yanıtı → küçük, saklanabilir kayıt. Yapı bozuksa null; geçerli ama veri yoksa Y = {}.
  function parse(json, rng) {
    var d = json && json.daily, Y = {}, i, f, t, y, m, dd, idx, o, arr, v;
    if (!d || !Array.isArray(d.time) || !rng) return null;
    for (i = 0; i < d.time.length; i++) {
      t = d.time[i];
      if (typeof t !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t)) continue;
      y = +t.slice(0, 4); m = +t.slice(5, 7); dd = +t.slice(8, 10);
      if (y < rng.y0 || y > rng.y1) continue;
      idx = dayIdx(y, m, dd); if (idx < 0) continue;
      o = Y[y] || (Y[y] = blank(y));
      for (f = 0; f < FIELDS.length; f++) {
        arr = d[KEYS[FIELDS[f]]]; v = Array.isArray(arr) ? num(arr[i]) : null;
        if (v !== null && (v < LIM[FIELDS[f]][0] || v > LIM[FIELDS[f]][1])) v = null;   // makul olmayan değer yok sayılır (0 yapılmaz)
        o[FIELDS[f]][idx] = v;
      }
    }
    Object.keys(Y).forEach(function (k) {
      var yo = Y[k], ok = false, j;
      for (j = 0; j < yo.x.length && !ok; j++) if (yo.x[j] !== null || yo.n[j] !== null) ok = true;
      if (!ok) delete Y[k];
    });
    return { v: 1, y0: rng.y0, y1: rng.y1, Y: Y };
  }
  function usableRec(r) { return !!(r && r.v === 1 && typeof r.y0 === 'number' && typeof r.y1 === 'number' && r.Y && typeof r.Y === 'object'); }

  // Seçili takvim günü için yıl satırları (yeni → eski). Artık olmayan yıllar "notLeap", verisi olmayanlar "missing".
  function forDate(rec, m, d) {
    var rows = [], missing = [], notLeap = [], y, idx, o;
    if (!usableRec(rec)) return { rows: rows, missing: missing, notLeap: notLeap, span: 0 };
    for (y = rec.y1; y >= rec.y0; y--) {
      idx = dayIdx(y, m, d);
      if (idx < 0) { notLeap.push(y); continue; }
      o = rec.Y[y];
      if (!o || (num(o.x[idx]) === null && num(o.n[idx]) === null)) { missing.push(y); continue; }
      rows.push({ year: y, x: num(o.x[idx]), n: num(o.n[idx]), p: num(o.p[idx]), s: num(o.s[idx]), w: num(o.w[idx]), c: num(o.c[idx]) });
    }
    return { rows: rows, missing: missing, notLeap: notLeap, span: rec.y1 - rec.y0 + 1 };
  }

  // En iyi (strict) değer; eşitlikte en yeni yıl kalır (satırlar yeni → eski)
  function best(rows, key, better) {
    var b = null;
    rows.forEach(function (r) { var v = r[key]; if (v === null) return; if (b === null || better(v, b.v)) b = { year: r.year, v: v }; });
    return b;
  }
  function summarize(rows) {
    var xs = rows.filter(function (r) { return r.x !== null; }), ps = rows.filter(function (r) { return r.p !== null; }), ss = rows.filter(function (r) { return r.s !== null; });
    var sum = 0, snowTot = 0, wet = 0, snow = 0;
    xs.forEach(function (r) { sum += r.x; });
    ps.forEach(function (r) { if (r.p >= WET_MM) wet++; });
    ss.forEach(function (r) { if (r.s >= SNOW_CM) { snow++; snowTot += r.s; } });
    var hot = best(rows, 'x', function (a, b) { return a > b; }), cold = best(rows, 'x', function (a, b) { return a < b; });
    var wetY = best(rows.filter(function (r) { return r.p !== null && r.p >= WET_MM; }), 'p', function (a, b) { return a > b; });
    return {
      n: rows.length, nx: xs.length, avg: xs.length ? sum / xs.length : null,
      hot: hot, cold: cold && hot && cold.year !== hot.year ? cold : null,
      wettest: wetY, windiest: best(rows, 'w', function (a, b) { return a > b; }),
      pKnown: ps.length, wetCount: wet, dryCount: ps.length - wet,
      sKnown: ss.length, snowCount: snow, snowTotal: snowTot
    };
  }
  // Bugünün (tahmin) en yüksek sıcaklığı ↔ son N yılın aynı gün ortalaması. Veri yetersizse null.
  function compareToday(todayX, rows) {
    var xs = rows.filter(function (r) { return r.x !== null; }), s = 0, avg, diff;
    if (num(todayX) === null || xs.length < MIN_CMP) return null;
    xs.forEach(function (r) { s += r.x; }); avg = s / xs.length; diff = todayX - avg;
    var rd = Math.round(Math.abs(diff));
    return { n: xs.length, avg: avg, today: todayX, diff: rd, kind: Math.abs(diff) < SAME_DELTA || rd === 0 ? 'same' : (diff > 0 ? 'warmer' : 'colder') };
  }
  function t0(v) { var r = Math.round(v); if (r === 0) r = 0; return r + '°'; }
  function dec(v) { return (Math.round(v * 10) / 10).toString().replace('.', ','); }
  function mmText(v) { return v < WET_MM ? 'Yağış yok' : dec(v) + ' mm'; }
  function spanText(n) { return n === YEARS ? 'Son ' + YEARS + ' yıl' : n + ' yıllık veri'; }
  function dateText(m, d) { return d + ' ' + MON[m - 1]; }
  function dateAcc(m, d) { return dateText(m, d) + '’' + ACC[m - 1]; }
  function cmpText(c) {
    if (!c) return '';
    var yr = c.n === YEARS ? 'Son ' + YEARS + ' yıl' : 'Veri olan ' + c.n + ' yıl';
    if (c.kind === 'same') return yr + ' ortalamasına yakın.';
    return yr + ' ortalamasından ' + c.diff + '° daha ' + (c.kind === 'warmer' ? 'sıcak.' : 'soğuk.');
  }
  function precipSentence(sm) {
    if (!sm.pKnown) return '';
    var yr = sm.pKnown === YEARS ? 'Son ' + YEARS + ' yılda' : 'Veri olan ' + sm.pKnown + ' yılda';
    return sm.wetCount ? yr + ' ' + sm.wetCount + ' kez yağış görüldü.' : yr + ' yağış görülmedi.';
  }
  // Ana ekran kartı metni: yalnızca bugün için veri varsa; yoksa null (kart gizlenir)
  function cardModel(rec, todayStr) {
    var m = +String(todayStr).slice(5, 7), d = +String(todayStr).slice(8, 10), Y = +String(todayStr).slice(0, 4);
    var f = forDate(rec, m, d); if (!f.rows.length) return null;
    var sm = summarize(f.rows), last = null, first = null, i;
    for (i = 0; i < f.rows.length; i++) { if (f.rows[i].x !== null) { if (!first) first = f.rows[i]; if (f.rows[i].year === Y - 1) last = f.rows[i]; } }
    var l1 = last ? 'Bugün geçen yıl en yüksek ' + t0(last.x) + ' idi' : first ? 'Son kayıt: ' + first.year + ' · ' + t0(first.x) : 'Geçmiş yılların verisi hazır';
    var l2 = sm.nx >= MIN_SUPER && sm.hot ? (f.rows.length === YEARS ? 'Son ' + YEARS + ' yılın' : 'Verisi olan ' + f.rows.length + ' yılın') + ' en sıcak ' + dateAcc(m, d) + ': ' + t0(sm.hot.v) + ' · ' + sm.hot.year : '';
    return { l1: l1, l2: l2, small: dateText(m, d) + ' · ' + spanText(f.rows.length), n: f.rows.length };
  }

  // Tek sade grafik: yılın günlük en yüksek sıcaklığı (yıl yıl), ortalama kesikli çizgi, bugün ayrı işaret. Eksik yıl boş kalır.
  function chartSvg(rows, rec, todayX) {
    var W = 320, H = 156, L = 30, R = 8, T = 16, B = 26, years = [], y, by = {}, vals = [], hasT = num(todayX) !== null;
    for (y = rec.y0; y <= rec.y1; y++) years.push(y);
    rows.forEach(function (r) { if (r.x !== null) { by[r.year] = r.x; vals.push(r.x); } });
    if (!vals.length) return '';
    var avg = 0; vals.forEach(function (v) { avg += v; }); avg /= vals.length;
    var all = vals.slice(); if (hasT) all.push(todayX);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (hi - lo < 8) { var mid = (hi + lo) / 2; lo = mid - 4; hi = mid + 4; }
    var pad = (hi - lo) * 0.14; lo -= pad; hi += pad;
    var slots = years.length + (hasT ? 1 : 0), step = (W - L - R) / slots;
    function X(i) { return L + step * (i + 0.5); }
    function Yy(v) { return T + (hi - v) / (hi - lo) * (H - T - B); }
    var gs = '', i, ticks = [lo + pad, (lo + hi) / 2, hi - pad];
    ticks.forEach(function (v) { gs += '<line class="hy-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Yy(v).toFixed(1) + '" y2="' + Yy(v).toFixed(1) + '"/><text class="ct" x="' + (L - 5) + '" y="' + (Yy(v) + 3.5).toFixed(1) + '" text-anchor="end">' + t0(v) + '</text>'; });
    gs += '<line class="hy-avg" x1="' + L + '" x2="' + (W - R) + '" y1="' + Yy(avg).toFixed(1) + '" y2="' + Yy(avg).toFixed(1) + '"/>';
    var seg = [], line = '';
    years.forEach(function (yr, k) {
      var v = by[yr];
      if (v === undefined) { if (seg.length > 1) line += '<polyline class="hy-line" points="' + seg.join(' ') + '"/>'; seg = []; return; }
      seg.push(X(k).toFixed(1) + ',' + Yy(v).toFixed(1));
    });
    if (seg.length > 1) line += '<polyline class="hy-line" points="' + seg.join(' ') + '"/>';
    gs += line;
    var hiV = Math.max.apply(null, vals), loV = Math.min.apply(null, vals), hiDone = false, loDone = false;
    years.forEach(function (yr, k) {
      var v = by[yr], lab = '';
      if (v !== undefined) {
        gs += '<circle class="hy-dot" cx="' + X(k).toFixed(1) + '" cy="' + Yy(v).toFixed(1) + '" r="3.4"/>';
        if (v === hiV && !hiDone) { hiDone = true; lab = '<text class="hy-val" x="' + X(k).toFixed(1) + '" y="' + (Yy(v) - 7).toFixed(1) + '" text-anchor="middle">' + t0(v) + '</text>'; }
        else if (v === loV && !loDone && loV !== hiV) { loDone = true; lab = '<text class="hy-val" x="' + X(k).toFixed(1) + '" y="' + (Yy(v) + 15).toFixed(1) + '" text-anchor="middle">' + t0(v) + '</text>'; }
        gs += lab;
      }
      gs += '<text class="ct" x="' + X(k).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">’' + String(yr).slice(2) + '</text>';
    });
    if (hasT) {
      var k2 = years.length;
      gs += '<circle class="hy-today" cx="' + X(k2).toFixed(1) + '" cy="' + Yy(todayX).toFixed(1) + '" r="4.6"/><text class="hy-val" x="' + X(k2).toFixed(1) + '" y="' + (Yy(todayX) - 8).toFixed(1) + '" text-anchor="middle">' + t0(todayX) + '</text>' +
        '<text class="ct hy-tl" x="' + X(k2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">Bugün</text>';
    }
    var aria = 'Günlük en yüksek sıcaklık, ' + years[0] + ' ile ' + years[years.length - 1] + ' arası, ' + vals.length + ' yıl; ortalama ' + t0(avg) + (hasT ? '; bugünün tahmini ' + t0(todayX) : '');
    return '<svg class="hy-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + aria + '">' + gs + '</svg>';
  }
  function ttlFor(todayStr, now) { var m = +todayStr.slice(5, 7), d = +todayStr.slice(8, 10); return m === 1 && d <= 15 ? TTL_EARLY : TTL; }
  function fresh(e, todayStr, now) {
    var rng = rangeFor(todayStr);
    return !!(e && rng && usableRec(e.rec) && e.rec.y1 === rng.y1 && typeof e.t === 'number' && e.t <= now + 60000 && now - e.t < ttlFor(todayStr, now));
  }
  function stepDay(m, d, step) { var x = new Date(Date.UTC(2024, m - 1, d + step)); return { m: x.getUTCMonth() + 1, d: x.getUTCDate() }; }
  function clampDay(m, d) { return Math.min(d, MDAYS[m - 1]); }

  var pure = {
    rangeFor: rangeFor, buildUrl: buildUrl, parse: parse, forDate: forDate, summarize: summarize, compareToday: compareToday, cmpText: cmpText, precipSentence: precipSentence,
    cardModel: cardModel, chartSvg: chartSvg, dayIdx: dayIdx, isLeap: isLeap, fresh: fresh, ttlFor: ttlFor, stepDay: stepDay, clampDay: clampDay, mmText: mmText, t0: t0, dateAcc: dateAcc, dateText: dateText,
    usableRec: usableRec, ENDPOINT: ENDPOINT, DAILY: DAILY, YEARS: YEARS, TTL: TTL, MIN_CMP: MIN_CMP, MIN_SUPER: MIN_SUPER, MON: MON, MDAYS: MDAYS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ---------------- Arayüz ----------------
  var KEY = 'hd2:hist';
  var C = null, P = { wrap: null, body: null, dyn: null, open: false, opener: null, k: '', m: 1, d: 1 };
  var mem = {}, busy = {}, failAt = {}, st = {}, timer = 0;

  function curCity() { return C && C.state.city; }
  function keyOf(c) { return c && typeof c.lat === 'number' && typeof c.lon === 'number' ? c.lat.toFixed(2) + ',' + c.lon.toFixed(2) : ''; }
  function curKey() { return keyOf(curCity()); }
  function todayStr() { var d = C && C.state.data; return d && d.current && typeof d.current.time === 'string' ? d.current.time.slice(0, 10) : ''; }
  function todayX() {
    var d = C && C.state.data, td = todayStr();
    return d && d.daily && d.daily.time && d.daily.time[0] === td && d.daily.temperature_2m_max ? num(d.daily.temperature_2m_max[0]) : null;
  }
  function getRec(k) {
    var e = mem[k], all;
    if (!e) { all = C.store(KEY) || {}; e = all[k]; if (e && usableRec(e.rec) && typeof e.t === 'number') mem[k] = e; else e = null; }
    return e || null;
  }
  function putRec(k, rec) {
    var e = { t: Date.now(), rec: rec }, all = C.store(KEY) || {}, ids;
    mem[k] = e; all[k] = e;
    ids = Object.keys(all).sort(function (a, b) { return ((all[b] && all[b].t) || 0) - ((all[a] && all[a].t) || 0); });
    ids.slice(MAX_ENTRIES).forEach(function (x) { delete all[x]; });
    C.store(KEY, all);
  }
  function offlineNote(e) {
    var td = todayStr();
    return (navigator.onLine === false || !fresh(e, td, Date.now())) ? ' · Önbellekten gösteriliyor · Son güncelleme ' + C.esc(C.stamp(e.t)) : '';
  }

  // ---------- Ana ekran kartı ----------
  function dtGo() { return '<i class="dt-go" aria-hidden="true">' + C.uiIcon('right', 14) + '</i>'; }
  function cardHtml() {
    var e = getRec(curKey()), td = todayStr(), m = e && td ? cardModel(e.rec, td) : null, esc = C.esc;
    if (!m) return '';
    var label = 'Geçmişe Yolculuk: ' + m.l1 + (m.l2 ? '. ' + m.l2 : '') + '. Ayrıntıları aç';
    return '<div class="drive hist" data-hist role="button" tabindex="0" aria-haspopup="dialog" aria-label="' + esc(label) + '">' +
      '<span class="drive-i">' + C.uiIcon('history', 20) + '</span><span class="drive-b"><b>Geçmişe Yolculuk</b>' +
      '<span class="hy-l">' + esc(m.l1) + '</span>' + (m.l2 ? '<span class="hy-l">' + esc(m.l2) + '</span>' : '') +
      '<small>' + esc(m.small) + offlineNote(e) + '</small></span>' + dtGo() + '</div>';
  }
  function fill() {
    var h = C && C.$('histCard');
    if (h) {
      var html = cardHtml();
      if (h.getAttribute('data-h') !== html) { h.innerHTML = html; h.setAttribute('data-h', html); }
      h.hidden = !html;
    }
    if (P.open) paint();
  }

  // ---------- Panel ----------
  function head() {
    return '<header class="sh-head"><span class="sh-sp" aria-hidden="true"></span><div class="sh-title"><h2 id="hyTitle">Geçmişe Yolculuk</h2><p id="hySub"></p></div>' +
      '<button type="button" class="sh-x" data-close aria-label="Kapat">' + C.uiIcon('close', 20) + '</button></header>';
  }
  function pickHtml() {
    var mo = '', dy = '', i;
    for (i = 0; i < 12; i++) mo += '<option value="' + (i + 1) + '"' + (i + 1 === P.m ? ' selected' : '') + '>' + MON[i] + '</option>';
    for (i = 1; i <= MDAYS[P.m - 1]; i++) dy += '<option value="' + i + '"' + (i === P.d ? ' selected' : '') + '>' + i + '</option>';
    return '<div class="hy-pick"><button type="button" class="hy-st" data-hy-step="-1" aria-label="Önceki gün">' + C.uiIcon('left', 18) + '</button>' +
      '<select id="hyD" aria-label="Gün">' + dy + '</select><select id="hyM" aria-label="Ay">' + mo + '</select>' +
      '<button type="button" class="hy-st" data-hy-step="1" aria-label="Sonraki gün">' + C.uiIcon('right', 18) + '</button>' +
      '<button type="button" class="hy-now" data-hy-today hidden>Bugün</button></div>';
  }
  function isToday() { var td = todayStr(); return !!td && +td.slice(5, 7) === P.m && +td.slice(8, 10) === P.d; }
  function syncPick() {
    var d = C.$('hyD'), m = C.$('hyM'), n = C.$('hySub'), now = P.body.querySelector('[data-hy-today]'), i, html = '';
    if (m && +m.value !== P.m) m.value = String(P.m);
    if (d) {
      if (d.options.length !== MDAYS[P.m - 1]) { for (i = 1; i <= MDAYS[P.m - 1]; i++) html += '<option value="' + i + '">' + i + '</option>'; d.innerHTML = html; }
      d.value = String(P.d);
    }
    if (now) now.hidden = isToday();
    if (n) n.textContent = dateText(P.m, P.d) + ' · ' + (C.cityTitle ? C.cityTitle(curCity()) : curCity().name);
  }
  var STAT = {
    busy: 'Geçmiş veriler alınıyor…', offline: 'Geçmiş hava verisi çevrimdışıyken kullanılamıyor.',
    empty: 'Bu konum ve tarih için geçmiş hava verisi bulunamadı.', error: 'Geçmiş veriler şu an alınamadı.'
  };
  function statusHtml(k) {
    var s = busy[k] ? 'busy' : navigator.onLine === false ? 'offline' : st[k] === 'empty' ? 'empty' : 'error';
    return '<p class="ob-empty hy-st-msg">' + STAT[s] + '</p>' + (s === 'error' || s === 'empty' ? '<button type="button" class="hy-retry" data-hy-retry>Tekrar dene</button>' : '');
  }
  function row(r) {
    var esc = C.esc, info = r.c !== null ? C.describe(r.c, true) : null, extra = [];
    if (r.p !== null) extra.push(mmText(r.p));
    if (r.s !== null && r.s >= SNOW_CM) extra.push('Kar ' + dec(r.s) + ' cm');
    var temps = r.x !== null && r.n !== null ? t0(r.x) + ' <i>/ ' + t0(r.n) + '</i>' : r.x !== null ? t0(r.x) + ' <i>/ –</i>' : '– <i>/ ' + t0(r.n) + '</i>';
    return '<li class="hy-row"><b class="hy-y">' + r.year + '</b><span class="hy-t">' + temps + '</span><span class="hy-c">' + (info ? esc(info.text) : '') + (extra.length ? '<small>' + esc(extra.join(' · ')) + '</small>' : '') + '</span></li>';
  }
  function tile(label, val, sub) { return '<div class="hy-tile"><span>' + label + '</span><b>' + val + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }
  function dynHtml(k, e) {
    var f = forDate(e.rec, P.m, P.d), rows = f.rows, esc = C.esc, html = offlineNote(e), sm, tx, cmp, facts = '';
    html = (html || busy[k]) ? '<p class="hy-cache">' + (busy[k] ? 'Güncelleniyor…' : esc(html.replace(/^ · /, ''))) + '</p>' : '';
    if (!rows.length) return html + '<p class="ob-empty">' + STAT.empty + '</p>' + notesHtml(f, e);
    sm = summarize(rows); tx = isToday() ? todayX() : null; cmp = tx !== null ? compareToday(tx, rows) : null;
    html += '<h3 class="hy-h">' + spanText(rows.length) + '</h3>';
    if (sm.nx >= MIN_SUPER) {
      html += '<div class="hy-sum">' + tile('En sıcak', sm.hot.year + ' · ' + t0(sm.hot.v)) + (sm.cold ? tile('En soğuk', sm.cold.year + ' · ' + t0(sm.cold.v)) : '') +
        (sm.wettest ? tile('En yağışlı', sm.wettest.year + ' · ' + dec(sm.wettest.v) + ' mm') : (sm.pKnown >= MIN_SUPER ? tile('Yağış', 'Görülmedi') : '')) +
        tile('Ortalama', t0(sm.avg), 'gündüz en yüksek') + '</div>';
    } else html += '<p class="hy-few">Karşılaştırma için en az ' + MIN_SUPER + ' yıllık veri gerekir; eldeki yıllar aşağıda.</p>';
    var ps = precipSentence(sm); if (ps) html += '<p class="hy-sent">' + esc(ps) + '</p>';
    if (sm.snowCount) facts += '<li><span>Kar görülen yıl</span><b>' + sm.snowCount + ' / ' + sm.sKnown + '<small>toplam ' + dec(sm.snowTotal) + ' cm</small></b></li>';
    if (sm.windiest && sm.nx >= MIN_SUPER) facts += '<li><span>En rüzgârlı</span><b>' + sm.windiest.year + ' · ' + Math.round(sm.windiest.v) + ' km/s</b></li>';
    if (facts) html += '<ul class="pol-facts hy-facts">' + facts + '</ul>';
    if (cmp) html += '<div class="hy-cmp"><div class="hy-pair">' + tile('Bugün', t0(cmp.today), 'en yüksek (tahmin)') + tile(cmp.n === YEARS ? '10 yıl ort.' : cmp.n + ' yıl ort.', t0(cmp.avg), 'en yüksek') + '</div><p>' + esc(cmpText(cmp)) + '</p></div>';
    var svg = sm.nx >= 2 ? chartSvg(rows, e.rec, tx) : '';
    if (svg) html += '<div class="hy-chartbox"><h3 class="hy-h">Günlük en yüksek sıcaklık</h3>' + svg + '<p class="hy-leg"><span class="k-avg"></span>Ortalama ' + t0(sm.avg) + (tx !== null ? ' <span class="k-today"></span>Bugün (tahmin)' : '') + '</p></div>';
    html += '<ul class="hy-list" aria-label="Yıllara göre">' + rows.map(row).join('') + '</ul>';
    return html + notesHtml(f, e);
  }
  function notesHtml(f, e) {
    var n = '';
    if (P.m === 2 && P.d === 29) n += '<p>29 Şubat yalnızca artık yıllarda bulunduğu için daha az geçmiş veri var.</p>';
    if (f.missing.length) n += '<p>Veri alınamayan yıl: ' + f.missing.slice().sort().join(', ') + '. Eksik yıllar atlandı.</p>';
    n += '<p>Veri: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> Ge\u00e7mi\u015f Hava (ERA5 yeniden analizi, yakla\u015f\u0131k 25 km). \u0130stasyon \u00f6l\u00e7\u00fcm\u00fc de\u011fildir. Bu \u00f6zet yaln\u0131zca son 10 y\u0131l\u0131n se\u00e7ili g\u00fcn\u00fcn\u00fc g\u00f6sterir; uzun d\u00f6nem ortalamas\u0131 de\u011fildir ve tek bir g\u00fcn\u00fcn de\u011ferleri y\u0131ldan y\u0131la \u00e7ok de\u011fi\u015febilir.</p>';
    return '<div class="pol-info hy-notes">' + n + '</div>';
  }
  function paint() {
    if (!P.open || !P.dyn) return;
    var k = P.k, e = getRec(k);
    syncPick();
    P.dyn.innerHTML = e ? dynHtml(k, e) : statusHtml(k);
  }
  function open(opener) {
    if (!P.wrap) return;
    var td = todayStr(); if (!td || !curCity()) return;
    document.dispatchEvent(new CustomEvent('hd2:sheet', { detail: 'hist' }));
    if (opener) P.opener = opener;
    P.k = curKey(); P.m = +td.slice(5, 7); P.d = +td.slice(8, 10);
    if (!P.open) {
      P.wrap.hidden = false; void P.wrap.offsetWidth; P.wrap.classList.add('open'); P.open = true;
      document.documentElement.classList.add('lock');
      C.app.setAttribute('aria-hidden', 'true'); if ('inert' in C.app) C.app.inert = true;
    }
    P.body.innerHTML = head() + pickHtml() + '<div id="hyDyn" aria-live="polite"></div>';
    P.dyn = C.$('hyDyn');
    paint();
    var x = P.body.querySelector('.sh-x'); if (x) x.focus({ preventScroll: true });
    var e = getRec(P.k); if (!e || !fresh(e, td, Date.now())) ensure(!e);
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
  document.addEventListener('hd2:sheet', function (ev) { if (ev.detail !== 'hist') close(true); });

  // ---------- Veri (tembel; ana hava verisini bloklamaz) ----------
  function ensure(force) {
    var city = curCity(), td = todayStr(), k = keyOf(city), rng = rangeFor(td), e;
    if (!city || !k || !rng || typeof fetch !== 'function') return;
    e = getRec(k);
    if (!force && e && fresh(e, td, Date.now())) return;
    if (navigator.onLine === false || busy[k]) { if (P.open && P.k === k) paint(); return; }
    if (!force && failAt[k] && Date.now() - failAt[k] < BACKOFF) return;
    busy[k] = 1; delete st[k];
    var ac = typeof AbortController === 'function' ? new AbortController() : null, to = ac ? setTimeout(function () { ac.abort(); }, 25000) : 0;
    if (P.open && P.k === k) paint();
    fetch(buildUrl(city.lat, city.lon, rng), ac ? { signal: ac.signal } : undefined)
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) {
        var rec = parse(j, rng);
        if (!rec) throw new Error('yanıt');
        if (!Object.keys(rec.Y).length) { st[k] = 'empty'; failAt[k] = Date.now(); return; }   // boş yanıt önbelleğe yazılmaz
        putRec(k, rec); delete failAt[k];
      })
      .catch(function () { failAt[k] = Date.now(); st[k] = 'error'; })
      .then(function () {
        clearTimeout(to); delete busy[k];
        if (curKey() === k) fill();   // başka konuma geçildiyse bu (geç gelen) sonuç ekrana yazılmaz; yalnızca önbelleğe girer
        else if (P.open && P.k === k) close(true);
      });
  }
  function sync() {
    if (!C) return;
    if (P.open && curKey() !== P.k) close(true);   // konum değişti: eski konumun paneli kapanır
    fill();
    clearTimeout(timer); timer = setTimeout(function () { ensure(false); }, 2200);   // ana ekran çizildikten sonra, boşta
  }

  function bind() {
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('[data-hist]');
      if (t && !P.wrap.contains(t)) open(t);
    });
    document.addEventListener('keydown', function (ev) {
      var t = ev.target.closest && ev.target.closest('[data-hist]');
      if (t && (ev.key === 'Enter' || ev.key === ' ') && !P.wrap.contains(t)) { ev.preventDefault(); open(t); }
    });
    P.wrap.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-close]') || ev.target.classList.contains('sheet-bg')) { close(); return; }
      var s = ev.target.closest('[data-hy-step]');
      if (s) { var x = stepDay(P.m, P.d, +s.getAttribute('data-hy-step')); P.m = x.m; P.d = x.d; paint(); return; }
      if (ev.target.closest('[data-hy-today]')) { var td = todayStr(); P.m = +td.slice(5, 7); P.d = +td.slice(8, 10); paint(); return; }
      if (ev.target.closest('[data-hy-retry]')) { delete failAt[P.k]; ensure(true); }
    });
    P.wrap.addEventListener('change', function (ev) {
      var id = ev.target && ev.target.id;
      if (id === 'hyM') { P.m = +ev.target.value; P.d = clampDay(P.m, P.d); paint(); }
      else if (id === 'hyD') { P.d = +ev.target.value; paint(); }
    });
    document.addEventListener('keydown', function (ev) {
      if (P.wrap.hidden) return;
      if (ev.key === 'Escape') { close(); return; }
      if (ev.key === 'Tab') {
        var fo = Array.prototype.filter.call(P.wrap.querySelectorAll('button:not([disabled]), a[href], select'), function (b) { return b.offsetParent !== null; });
        if (!fo.length) return;
        var first = fo[0], last = fo[fo.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    });
    var grip = C.$('hyGrip'), panel = P.wrap.querySelector('.sheet'), y0 = null, dy = 0;
    grip.addEventListener('pointerdown', function (ev) { y0 = ev.clientY; dy = 0; panel.style.transition = 'none'; grip.setPointerCapture(ev.pointerId); });
    grip.addEventListener('pointermove', function (ev) { if (y0 == null) return; dy = Math.max(0, ev.clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; });
    function end() { if (y0 == null) return; y0 = null; panel.style.transition = ''; if (dy > 90) close(); else panel.style.transform = ''; }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
    g.addEventListener('online', function () { sync(); });
    g.addEventListener('offline', function () { fill(); });
  }

  g.HDHistory = {
    init: function (ctx) { C = ctx; P.wrap = C.$('hySheet'); P.body = C.$('hyBody'); if (P.wrap) bind(); },
    sync: sync, open: open, close: function () { close(); },
    _pure: pure,
    _state: function () { var e = C && getRec(curKey()); return { open: P.open, m: P.m, d: P.d, cached: !!e, busy: Object.keys(busy).length, st: JSON.stringify(st) }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
