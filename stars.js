/* EYRIVO Yıldız Gözlem (0.8) — SAF SKOR / PENCERE / NEDEN MANTIĞI. DOM, ağ, depolama yok; tarayıcısız test edilebilir (module.exports).
   Girdi: uygulamanın mevcut Open-Meteo saatlik verisi (ek istek yok) + astro.js'ten yerel Güneş/Ay hesabı.

   SKOR NEDİR: "Meteorolojik gözlem uygunluğu" (0–10). Bilimsel olarak tek standart bir "yıldız gözlem skoru" yoktur; bu, EYRIVO'nun ürün mantığıdır.
   "Kaç yıldız göreceksin" demek DEĞİLDİR. Yerel ışık kirliliği doğrulanmış ücretsiz/anahtarsız bir kaynaktan alınamadığı için skora DAHİL DEĞİLDİR.
   Dayanak: gözlem tahminlerinde toplam bulut miktarı baskın faktördür (örn. Xu/Randall bulut şeması tabanlı GFS değerlendirmesi, arXiv:1011.3863;
   Clear Dark Sky tipi tahminler bulut + saydamlık/nem + Ay'a bakar). Ağırlıklar bu sıralamayı (bulut ≫ yağış/görüş ≫ nem/Ay) izleyen ürün seçimidir:
     saat puanı = 9 − (bulut cezası 0–8) − (yağış olasılığı cezası 0–2) − (görüş cezası 0–2) − (nem cezası 0–1) − (Ay cezası 0–3)
     (üst sınır 9: seeing/saydamlık/ışık kirliliği modellenmediği için 10/10 verilmez)
     tavanlar: yağış var ya da yağışlı hava kodu → en çok 1 · sis kodu → en çok 1 · görüş < 2 km → en çok 2 (< 1 km → 1)
   Etkin bulut = toplam bulut − 0,4 × (yalnızca YÜKSEK bulutun sayılabilen kısmı): ince sirrus yıldızları tamamen örtmez (varsayım, bilimsel eşik değil). */
'use strict';
(function (g) {
  var A = (typeof require === 'function' && typeof module !== 'undefined') ? require('./astro.js') : g.ASTRO;
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // yerel saat metni ('2026-10-25T21:00') + UTC farkı (sn) → UTC ms
  function tms(str, off) { return Date.UTC(+str.slice(0, 4), +str.slice(5, 7) - 1, +str.slice(8, 10), +str.slice(11, 13), +str.slice(14, 16) || 0) - (off || 0) * 1000; }
  function hhmm(ms, off) { var d = new Date(ms + (off || 0) * 1000); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }

  var MAXSCORE = 9;   // en yüksek skor 9: seeing, saydamlık ve yerel ışık kirliliği modellenmediği için "kusursuz" (10/10) iddiası yapılmaz
  var MAX = { cloud: 8, pop: 2, vis: 2, hum: 1, moon: 3 };
  function effCloud(total, low, mid, high) {
    if (total === null) return null;
    if (low === null || mid === null || high === null) return clamp(total, 0, 100);
    var onlyHigh = Math.max(0, Math.min(high, total) - Math.max(low, mid));
    return clamp(total - 0.4 * onlyHigh, 0, 100);
  }
  // Tek saatin puanı. h: {total, low, mid, high, vis (m), hum, precip (mm), pop, code}; mn: {alt, illum}
  function hourScore(h, mn) {
    var eff = effCloud(h.total, h.low, h.mid, h.high);
    if (eff === null) return null;
    var p = { cloud: MAX.cloud * eff / 100, pop: 0, vis: 0, hum: 0, moon: 0 }, cap = 10;
    var wet = (h.precip !== null && h.precip >= 0.1) || (h.code !== null && h.code >= 51);
    if (wet) cap = Math.min(cap, 1);
    else if (h.pop !== null) p.pop = MAX.pop * clamp((h.pop - 30) / 70, 0, 1);
    if (h.code === 45 || h.code === 48) cap = Math.min(cap, 1);
    if (h.vis !== null) {
      if (h.vis < 10000) p.vis = MAX.vis * clamp((10000 - h.vis) / 8000, 0, 1);
      if (h.vis < 2000) cap = Math.min(cap, h.vis < 1000 ? 1 : 2);
    }
    if (h.hum !== null && h.hum > 85) p.hum = MAX.hum * clamp((h.hum - 85) / 15, 0, 1);
    if (mn && mn.alt > 0) p.moon = MAX.moon * mn.illum * (0.35 + 0.65 * clamp(mn.alt / 30, 0, 1));
    var score = clamp(MAXSCORE - p.cloud - p.pop - p.vis - p.hum - p.moon, 0, cap);
    return { score: score, eff: eff, pen: p, wet: wet, fog: h.code === 45 || h.code === 48, cap: cap };
  }
  function band(score) { return score >= 8 ? 2 : score >= 5 ? 1 : 0; }   // 2 İyi · 1 Orta · 0 Zayıf
  var BAND_TXT = ['Zayıf', 'Orta', 'İyi'];

  function mean(a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  // En iyi ardışık pencere: önce 3 saatlik (kısa gecede kalan kadar) en yüksek ortalama, sonra iyi komşu saatlerle en çok 4 saate genişler.
  // Uygun: ortalama ≥ 5 ve hiçbir saat < 4. Dönüş {from, to (dahil indeksler), mean, ok} ya da null.
  function bestWindow(scores) {
    var n = scores.length; if (!n) return null;
    var L = Math.min(3, n), bi = 0, bm = -1, i;
    for (i = 0; i + L <= n; i++) { var m = mean(scores.slice(i, i + L)); if (m > bm + 1e-9) { bm = m; bi = i; } }
    var a = bi, b = bi + L - 1, grew = true;
    while (b - a + 1 < 4 && grew) {
      grew = false;
      var left = a > 0 ? scores[a - 1] : -1, right = b < n - 1 ? scores[b + 1] : -1, mm = mean(scores.slice(a, b + 1)), best = Math.max(left, right);
      if (best >= 6 && best >= mm - 1) { if (right >= left) b++; else a--; grew = true; }
    }
    var ws = scores.slice(a, b + 1), mw = mean(ws);
    return { from: a, to: b, mean: mw, ok: mw >= 5 && Math.min.apply(null, ws) >= 4 };
  }

  var MOON_TXT = { bright: 'Ay oldukça parlak.', up: 'Ay gökyüzünü aydınlatıyor.' };
  // Analiz. inp: {hourly, offset, lat, lon, now}. Dönüş: null (veri/gece yok) ya da sonuç nesnesi.
  function analyze(inp) {
    var H = inp && inp.hourly; if (!H || !H.time || !H.time.length) return null;
    var off = inp.offset || 0, now = inp.now, lat = inp.lat, lon = inp.lon;
    var nt = A.night(now, lat, lon); if (!nt) return { none: 'no-night' };
    var get = function (k, i) { return H[k] ? num(H[k][i]) : null; };
    var hours = [], i, mn;
    for (i = 0; i < H.time.length; i++) {
      var t0 = tms(H.time[i], off), t1 = t0 + 3600000, mid = t0 + 1800000;
      if (mid < nt.start || mid > nt.end || t1 <= now) continue;   // yalnızca gözlem gecesinin KALAN saatleri
      var hv = { total: get('cloud_cover', i), low: get('cloud_cover_low', i), mid: get('cloud_cover_mid', i), high: get('cloud_cover_high', i),
        vis: get('visibility', i), hum: get('relative_humidity_2m', i), precip: get('precipitation', i), pop: get('precipitation_probability', i), code: get('weather_code', i) };
      mn = A.moon(mid, lat, lon);
      var sc = hourScore(hv, mn);
      hours.push({ t: t0, label: H.time[i].slice(11, 16), v: hv, moon: mn, s: sc });
    }
    var usable = hours.filter(function (h) { return h.s; });
    if (!usable.length) return null;   // gece saati ya da bulut verisi yok
    // ardışıklık: veri boşluğu pencereyi bölmesin diye yalnızca puanı olan saatler üzerinde, zaman bitişikliği kontrol edilir
    var scores = usable.map(function (h) { return h.s.score; });
    var w = bestWindow(scores), win = usable.slice(w.from, w.to + 1);
    var contiguous = win.every(function (h, k) { return k === 0 || h.t - win[k - 1].t === 3600000; });
    if (!contiguous) w.ok = false;
    var score = Math.round(w.mean);
    // faktör ortalamaları (pencere ya da pencere uygun değilse tüm kalan gece)
    var base = w.ok ? win : usable;
    var avg = function (f) { var a = base.map(f).filter(function (x) { return x !== null; }); return a.length ? mean(a) : null; };
    var f = {
      cloud: avg(function (h) { return h.s.eff; }), vis: avg(function (h) { return h.v.vis; }), hum: avg(function (h) { return h.v.hum; }),
      pop: avg(function (h) { return h.v.pop; }), precipMm: avg(function (h) { return h.v.precip; }), wet: base.some(function (h) { return h.s.wet; }), fog: base.some(function (h) { return h.s.fog; })
    };
    var pen = { cloud: mean(base.map(function (h) { return h.s.pen.cloud; })), pop: mean(base.map(function (h) { return h.s.pen.pop; })), vis: mean(base.map(function (h) { return h.s.pen.vis; })),
      hum: mean(base.map(function (h) { return h.s.pen.hum; })), moon: mean(base.map(function (h) { return h.s.pen.moon; })) };
    // Ay (gece ortası) ve doğuş/batış
    var midNight = Math.round((nt.start + nt.end) / 2), mm = A.moon(midNight, lat, lon), ev = A.moonEvents(nt.start, nt.end, lat, lon);
    var moonInfo = { illum: mm.illum, phase: A.phaseName(mm), upAtStart: ev.upAtStart, upAtEnd: ev.upAtEnd, events: ev.events.map(function (e) { return { type: e.type, label: hhmm(e.t, off) }; }),
      winUp: base.some(function (h) { return h.moon.alt > 0; }), winMaxAlt: Math.max.apply(null, base.map(function (h) { return h.moon.alt; })) };
    // nedenler (en çok 3)
    var reasons = [], early = usable.slice(0, Math.min(2, usable.length));
    var timing = null;
    if (w.ok && w.from > 0) {
      var eM = mean(early.map(function (h) { return h.s.score; }));
      if (eM <= w.mean - 2) {
        var ws = win[0], hr = new Date(ws.t + off * 1000).getUTCHours();
        timing = (hr >= 0 && hr < 12 && ws.t > nt.start + 1) ? 'Gece yarısından sonra gökyüzü açılıyor.' : 'İlerleyen saatlerde gökyüzü açılıyor.';
      }
    }
    var cand = [];
    if (f.wet || pen.pop >= 1) cand.push([Math.max(pen.pop, f.wet ? 6 : 0), f.wet ? 'Yağış gözlemi zorlaştırıyor.' : 'Yağış ihtimali yüksek.']);
    if (f.fog) cand.push([7, 'Sis gözlemi zorlaştırıyor.']);
    if (pen.cloud >= 1.5) cand.push([pen.cloud, pen.cloud >= 4 ? 'Bulutluluk gözlemi zorlaştırıyor.' : 'Bulutluluk gökyüzünü kısmen kapatıyor.']);
    if (pen.vis >= 0.8) cand.push([pen.vis * 1.5, 'Görüş mesafesi düşük.']);
    if (pen.hum >= 0.5) cand.push([pen.hum * 1.5, 'Nem yüksek; gökyüzü bulanık görünebilir.']);
    if (pen.moon >= 1.2) cand.push([pen.moon, pen.moon >= 2 ? MOON_TXT.bright : MOON_TXT.up]);
    cand.sort(function (a, b) { return b[0] - a[0]; });
    if (timing) reasons.push(timing);
    cand.forEach(function (c) { if (reasons.length < 3 && reasons.indexOf(c[1]) < 0) reasons.push(c[1]); });
    if (!reasons.length) reasons.push(score >= 8 ? 'Bulutluluk düşük.' : 'Belirgin bir engel görünmüyor.');
    var wEnd = Math.min(win[win.length - 1].t + 3600000, nt.end);   // pencere astronomik şafağı aşmaz
    var win_ = w.ok ? { from: win[0].label, to: hhmm(wEnd, off), start: Math.max(win[0].t, nt.start), end: wEnd } : null;
    var headline = w.ok ? (score >= 8 ? 'Bu gece gökyüzü uygun. En iyi zaman ' + win_.from + '–' + win_.to + '.' : 'Gözlem için idare eder. En iyi zaman ' + win_.from + '–' + win_.to + '.')
      : 'Bu gece gözlem için uygun bir zaman görünmüyor.';
    return {
      score: score, raw: w.mean, band: band(score), label: BAND_TXT[band(score)], window: win_, headline: headline, reasons: reasons,
      night: { start: nt.start, end: nt.end, level: nt.level, startLabel: hhmm(nt.start, off), endLabel: hhmm(nt.end, off) },
      hours: usable.map(function (h) { return { label: h.label, t: h.t, score: Math.round(h.s.score), band: band(h.s.score), wet: h.s.wet, fog: h.s.fog, eff: h.s.eff, inWindow: !!(win_ && h.t >= win_.start && h.t < win_.end) }; }),
      factors: f, moon: moonInfo, pen: pen
    };
  }

  var API = { analyze: analyze, hourScore: hourScore, bestWindow: bestWindow, effCloud: effCloud, band: band, BAND_TXT: BAND_TXT, MAX: MAX, tms: tms, hhmm: hhmm };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  g.STARS = API;
})(typeof window !== 'undefined' ? window : globalThis);
