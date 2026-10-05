/* Kural tabanlı yorumlar: hava kalitesi sınıfları, günlük özet, aktivite önerileri.
   Hiçbir dış servis / yapay zekâ çağrısı yok; yalnızca Open-Meteo'dan gelen sayılar yorumlanır.
   Saf fonksiyonlar: DOM'a dokunmaz. */
'use strict';
(function (global) {
  function r(n) { var x = Math.round(n); return x === 0 ? 0 : x; }
  function dg(n) { var x = r(n); return (x < 0 ? '\u2212' + (-x) : x) + '°'; }
  function hh(s) { return +s.slice(11, 13); }
  function hm(s) { return s.slice(11, 16); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function mins(s) { return hh(s) * 60 + (+s.slice(14, 16)); }

  // Hava durumu kodu grupları (WMO)
  function codeWet(c) { return (c >= 51 && c <= 67) || (c >= 80 && c <= 82); }
  function codeSnow(c) { return (c >= 71 && c <= 77) || c === 85 || c === 86; }
  function codeStorm(c) { return c >= 95; }
  function codePrecip(c) { return codeWet(c) || codeSnow(c) || codeStorm(c); }

  // ---------- Hava kalitesi (Avrupa Hava Kalitesi Endeksi, EEA 2024 sınıfları) ----------
  var AQ_LABEL = ['Çok iyi', 'İyi', 'Orta', 'Kötü', 'Çok kötü', 'Aşırı kötü'];
  var AQ_COLOR = ['#4fe3d8', '#5ad28f', '#f0d94a', '#ff6b5e', '#c2335f', '#9b4fc0'];
  var AQ_SENTENCE = [
    'Hava çok temiz; dışarıda vakit geçirmek için çok uygun.',
    'Bugün dışarıda vakit geçirmek için uygun.',
    'Genel olarak kabul edilebilir; hassas kişiler uzun ve yoğun eforu azaltabilir.',
    'Hassas kişiler için riskli; yoğun dış mekân eforundan kaçın.',
    'Dışarıda uzun kalmaktan ve yoğun egzersizden kaçın.',
    'Mümkünse dışarı çıkma; çıkarsan efor yapma.'
  ];
  // Her kirletici için sınıf eşikleri (µg/m³): değer eşiğe eşit/büyükse bir üst sınıf
  var POLL = [
    { key: 'pm2_5', name: 'PM2.5', th: [5, 15, 50, 90, 140] },
    { key: 'pm10', name: 'PM10', th: [15, 45, 120, 195, 270] },
    { key: 'ozone', name: 'Ozon (O₃)', th: [60, 100, 120, 160, 180] },
    { key: 'nitrogen_dioxide', name: 'Azot dioksit (NO₂)', th: [10, 25, 60, 100, 150] },
    { key: 'sulphur_dioxide', name: 'Kükürt dioksit (SO₂)', th: [20, 40, 125, 190, 275] },
    { key: 'carbon_monoxide', name: 'Karbon monoksit (CO)', th: null }
  ];
  var POLLEN = [
    ['alder_pollen', 'Kızılağaç'], ['birch_pollen', 'Huş'], ['grass_pollen', 'Çimen'],
    ['mugwort_pollen', 'Pelin otu'], ['olive_pollen', 'Zeytin'], ['ragweed_pollen', 'Ambrozya']
  ];
  function eaqiLevel(v) { return v < 20 ? 0 : v < 40 ? 1 : v < 60 ? 2 : v < 80 ? 3 : v < 100 ? 4 : 5; }
  function pollLevel(th, v) { var k = 0; while (k < th.length && v >= th[k]) k++; return k; }

  // cur: Open-Meteo air-quality "current" nesnesi. Veri yoksa null döner.
  function airQuality(cur) {
    if (!cur || typeof cur.european_aqi !== 'number') return null;
    var v = r(cur.european_aqi), lvl = eaqiLevel(v), comps = [], top = { lvl: -1 }, i, p, val, l;
    for (i = 0; i < POLL.length; i++) {
      p = POLL[i]; val = cur[p.key];
      if (typeof val !== 'number') continue;
      l = p.th ? pollLevel(p.th, val) : -1;
      comps.push({ key: p.key, name: p.name, val: val, level: l, label: l >= 0 ? AQ_LABEL[l] : '', color: l >= 0 ? AQ_COLOR[l] : '' });
      if (l > top.lvl && p.key !== 'carbon_monoxide') top = { lvl: l, name: p.name };
    }
    var pollen = [], any = false;
    for (i = 0; i < POLLEN.length; i++) {
      val = cur[POLLEN[i][0]];
      if (typeof val === 'number') { any = true; if (val > 0) pollen.push({ name: POLLEN[i][1], val: val }); }
    }
    return {
      value: v, level: lvl, label: AQ_LABEL[lvl], color: AQ_COLOR[lvl], sentence: AQ_SENTENCE[lvl],
      us: typeof cur.us_aqi === 'number' ? r(cur.us_aqi) : null,
      main: (lvl >= 2 && top.lvl >= 2) ? top.name : '', comps: comps, pollen: pollen, pollenKnown: any
    };
  }

  // ---------- Günlük özet ----------
  function tempWord(t) { return t < 0 ? 'dondurucu' : t < 8 ? 'soğuk' : t < 15 ? 'serin' : t < 22 ? 'ılık' : t < 29 ? 'sıcak' : 'çok sıcak'; }
  function part(h) { return h < 11 ? 'sabah' : h < 13 ? 'öğle saatlerinde' : h < 18 ? 'öğleden sonra' : 'akşam'; }
  function uvWord(u) { return u >= 11 ? 'aşırı' : u >= 8 ? 'çok yüksek' : 'yüksek'; }
  function dayRange(h, day) {
    var a = -1, b = -1, i;
    for (i = 0; i < h.time.length; i++) if (h.time[i].slice(0, 10) === day) { if (a < 0) a = i; b = i; }
    return [a, b];
  }
  function maxIn(arr, i0, i1) { var best = { v: -1e9, i: i0 }, i; for (i = i0; i <= i1; i++) if (arr[i] > best.v) best = { v: arr[i], i: i }; return best; }
  function minIn(arr, i0, i1) { var best = { v: 1e9, i: i0 }, i; for (i = i0; i <= i1; i++) if (arr[i] < best.v) best = { v: arr[i], i: i }; return best; }
  function sumIn(arr, i0, i1) { var s = 0, i; for (i = i0; i <= i1; i++) s += arr[i] || 0; return s; }

  // o: { h, dl, j, nowIdx (bugün için), curTemp, aq }  -> metin
  function daySummary(o) {
    var h = o.h, dl = o.dl, j = o.j, day = dl.time[j], rg = dayRange(h, day), a = rg[0], b = rg[1];
    if (a < 0) return '';
    var isNow = typeof o.nowIdx === 'number' && o.nowIdx >= a && o.nowIdx <= b;
    var now = isNow ? o.nowIdx : a + 6, nowH = isNow ? hh(h.time[now]) : 6;
    var nowMin = isNow ? mins(h.time[now]) : 360;
    var T = h.temperature_2m, items = [], night = isNow && nowH >= 21, mode;
    mode = night ? 'night' : (isNow && nowH >= 17) ? 'evening' : (isNow && nowH >= 11) ? 'midday' : 'morning';

    // 1) Sıcaklık seyri
    var cur, s, pk, mn;
    if (mode === 'morning') {
      cur = (isNow && nowH >= 6 && typeof o.curTemp === 'number') ? o.curTemp : T[a + 8];
      pk = maxIn(T, a + 11, Math.min(b, a + 18));
      mn = minIn(T, a + 6, Math.min(b, a + 20));
      if (pk.v - cur >= 3) s = (isNow && nowH >= 6 ? 'Şu an' : 'Sabah') + ' hava ' + tempWord(cur) + ' (' + dg(cur) + '); ' + part(hh(h.time[pk.i])) + ' ' + dg(pk.v) + ' civarına ısınacak.';
      else if (cur - pk.v >= 3) s = 'Sabah ' + dg(cur) + '; gün içinde ' + dg(pk.v) + ' civarına düşecek.';
      else s = 'Gün boyu hava ' + tempWord((pk.v + mn.v) / 2) + ', sıcaklık ' + dg(mn.v) + ' ile ' + dg(pk.v) + ' arasında kalacak.';
    } else if (mode === 'midday') {
      cur = o.curTemp;
      pk = maxIn(T, now, Math.min(b, a + 18));
      if (pk.i > now && pk.v - cur >= 1) s = 'Şu an ' + dg(cur) + '; saat ' + pad(hh(h.time[pk.i])) + ':00 civarında ' + dg(pk.v) + ' ile günün en sıcağı yaşanacak.';
      else s = 'Şu an günün en sıcak saatlerinde (' + dg(cur) + ').';
    } else if (mode === 'evening') {
      cur = o.curTemp; mn = minIn(T, now, b);
      if (cur - mn.v >= 2) s = 'Akşam hava ' + tempWord(cur) + ' (' + dg(cur) + '); gece ' + dg(mn.v) + ' civarına düşecek.';
      else s = 'Akşam ve gece hava ' + tempWord(cur) + ', ' + dg(cur) + ' civarında kalacak.';
    } else {
      cur = o.curTemp; mn = minIn(T, now, b);
      s = cur - mn.v >= 2 ? 'Gece sıcaklık ' + dg(mn.v) + ' civarına düşecek.' : 'Gece hava ' + tempWord(cur) + ' kalacak (' + dg(cur) + ').';
    }
    items.push({ k: 'temp', o: 0, p: 100, s: s });

    // 2) Gün batımından sonra serinleme
    if (dl.sunset && dl.sunset[j] && mode !== 'night' && mins(dl.sunset[j]) > nowMin) {
      var si = Math.min(b, a + Math.round(mins(dl.sunset[j]) / 60)), drop = T[si] - T[Math.min(b, si + 3)];
      if (drop >= 4) items.push({ k: 'sunset', o: 1, p: 45, s: 'Gün batımı ' + hm(dl.sunset[j]) + '; ardından hava hızla serinleyecek.' });
      else if (drop >= 2) items.push({ k: 'sunset', o: 1, p: 40, s: 'Gün batımından (' + hm(dl.sunset[j]) + ') sonra hava serinleyecek.' });
    }

    // 3) Yağış
    var f0 = isNow ? now : a, i, hot = [], first = -1, last = -1, pmax = 0, snowy = false, stormy = false, pw;
    for (i = f0; i <= b; i++) {
      pw = h.precipitation_probability[i] || 0;
      if (pw > pmax) pmax = pw;
      hot[i] = pw >= 40 || codePrecip(h.weather_code[i]);
      if (hot[i]) {
        if (first < 0) first = i;
        if (codeSnow(h.weather_code[i])) snowy = true;
        if (codeStorm(h.weather_code[i])) stormy = true;
      }
    }
    var coldDay = (isNow ? o.curTemp : T[a + 14]) <= 2;
    var noun = snowy ? 'kar' : stormy ? 'gök gürültülü sağanak' : coldDay ? 'yağış' : 'yağmur';
    var wetNow = isNow && codePrecip(h.weather_code[now]), rs, rp = 60;
    if (wetNow) {
      var end = -1; for (i = now + 1; i <= b; i++) if (!hot[i]) { end = i; break; }
      rs = 'Şu an ' + (snowy ? 'kar yağıyor' : 'yağış var') + (end > 0 ? '; yaklaşık ' + pad(hh(h.time[end])) + ':00 sıralarında dinmesi bekleniyor.' : ' ve gün boyu sürebilir.');
      rp = 95;
    } else if (first >= 0) {
      last = first; while (last + 1 <= b && (hot[last + 1] || hot[last + 2])) last++;
      while (!hot[last]) last--;
      var pm = maxIn(h.precipitation_probability, first, last).v, span = last - first + 1, pct = pm >= 40 ? ' (%' + r(pm) + ')' : '';
      if (span >= 14) rs = 'Gün boyu aralıklı ' + noun + ' bekleniyor' + pct + '.';
      else if (first === last) rs = 'Saat ' + pad(hh(h.time[first])) + ':00 civarında ' + noun + ' görülebilir' + pct + '.';
      else rs = pad(hh(h.time[first])) + ':00–' + pad(hh(h.time[last])) + ':00 arasında ' + noun + (pm >= 40 ? ' ihtimali yüksek' + pct : ' görülebilir') + '.';
      rp = 90;
    } else if (pmax >= 20) rs = 'Yağış ihtimali düşük (%' + r(pmax) + ').';
    else rs = (coldDay ? 'Yağış' : 'Yağmur') + ' beklenmiyor.';
    if (!(mode === 'night' && rp < 90 && !(pmax >= 20))) items.push({ k: 'rain', o: 2, p: rp, s: rs });

    // 4) Rüzgâr
    var w = maxIn(h.wind_speed_10m, f0, b);
    if (w.v >= 40) items.push({ k: 'wind', o: 3, p: 80, s: 'Rüzgâr çok kuvvetli, en fazla ' + r(w.v) + ' km/sa.' });
    else if (w.v >= 28 && mode !== 'night') items.push({ k: 'wind', o: 3, p: 35, s: 'Rüzgâr kuvvetli, en fazla ' + r(w.v) + ' km/sa.' });

    // 5) UV
    var uvm = dl.uv_index_max ? dl.uv_index_max[j] : 0;
    if (h.uv_index && uvm >= 6 && mode !== 'night' && mode !== 'evening' && !wetNow && !stormy) {
      var u0 = -1, u1 = -1; for (i = Math.max(a, f0); i <= b; i++) if (h.uv_index[i] >= 6) { if (u0 < 0) u0 = i; u1 = i; }
      if (u0 >= 0) items.push({ k: 'uv', o: 4, p: 50, s: 'UV seviyesi ' + uvWord(uvm) + ' (' + r(uvm) + '): ' + pad(hh(h.time[u0])) + ':00–' + pad(hh(h.time[u1]) + 1) + ':00 arasında güneşten korun.' });
    }

    // 6) Hava kalitesi (yalnız bugün; verisi varsa ve orta üstüyse)
    if (isNow && o.aq && o.aq.level >= 2) {
      var aqs = o.aq.level === 2 ? 'Hava kalitesi orta (' + o.aq.value + ').'
        : o.aq.level === 3 ? 'Hava kalitesi kötü (' + o.aq.value + '); yoğun dış mekân eforundan kaçın.'
        : 'Hava kalitesi çok kötü (' + o.aq.value + '); mümkünse dışarıda uzun kalma.';
      items.push({ k: 'aq', o: 5, p: o.aq.level >= 3 ? 85 : 30, s: aqs });
    }

    // Gece: yarının kısa özeti
    if (mode === 'night' && dl.time[j + 1]) {
      var yp = dl.precipitation_probability_max[j + 1] || 0;
      items.push({ k: 'tom', o: 1.5, p: 95, s: 'Yarın ' + dg(dl.temperature_2m_min[j + 1]) + ' ile ' + dg(dl.temperature_2m_max[j + 1]) + ' arasında; ' +
        (yp < 20 ? 'yağış beklenmiyor.' : 'yağış ihtimali %' + r(yp) + '.') });
    }

    // En önemli en fazla 3 ek cümle; sıcaklık hep var. Okuma sırası: o
    var rest = items.slice(1).sort(function (x, y) { return y.p - x.p; }).slice(0, 3);
    var out = [items[0]].concat(rest).sort(function (x, y) { return x.o - y.o; });
    return out.map(function (x) { return x.s; }).join(' ');
  }

  // ---------- Aktivite önerileri ----------
  var LEVEL = ['Uygun', 'İdare eder', 'Uygun değil'];
  // x: { feels, wind, p (yağış ihtimali, sonraki 3 saat), wet, snow, storm, ice, isDay, uv, aqi (EAQI düzeyi 0-5 | null) }
  function worst(parts) {
    var best = [0, ''], i; for (i = 0; i < parts.length; i++) if (parts[i][0] > best[0]) best = parts[i];
    return best;
  }
  function tband(f, a, b, c, d) {
    if (f < a) return [2, 'Çok soğuk']; if (f < b) return [1, 'Hava serin'];
    if (f > d) return [2, 'Çok sıcak']; if (f > c) return [1, 'Hava sıcak'];
    return [0, ''];
  }
  function rainPart(x, l1, l2) {
    if (x.storm) return [2, 'Fırtına'];
    if (x.wet || x.snow) return [2, x.snow ? 'Kar var' : 'Yağış var'];
    if (x.p >= l2) return [2, 'Yağış ihtimali %' + r(x.p)];
    if (x.p >= l1) return [1, 'Yağış ihtimali %' + r(x.p)];
    return [0, ''];
  }
  function windPart(x, l1, l2) { return x.wind >= l2 ? [2, 'Rüzgâr kuvvetli'] : x.wind >= l1 ? [1, 'Rüzgâr var'] : [0, '']; }
  function aqPart(x, l1, l2) {
    if (x.aqi == null) return [0, ''];
    return x.aqi >= l2 ? [2, 'Hava kalitesi kötü'] : x.aqi >= l1 ? [1, 'Hava kalitesi orta'] : [0, ''];
  }
  function activities(x) {
    var defs = [
      { id: 'coffee', name: 'Kahve / dışarıda oturma', short: 'Dışarıda kahve', icon: 'coffee', ok: 'Keyifli bir hava',
        parts: [tband(x.feels, 8, 15, 29, 34), rainPart(x, 25, 50), windPart(x, 20, 32), aqPart(x, 60, 80), x.uv >= 8 && x.isDay ? [1, 'UV çok yüksek'] : [0, '']] },
      { id: 'walk', name: 'Yürüyüş', short: 'Yürüyüş', icon: 'walk', ok: 'Yürümek için güzel',
        parts: [tband(x.feels, -2, 6, 28, 33), rainPart(x, 30, 60), windPart(x, 32, 48), aqPart(x, 60, 80), x.ice ? [1, 'Buzlanma riski'] : [0, ''], x.uv >= 8 && x.isDay ? [1, 'UV çok yüksek'] : [0, '']] },
      { id: 'bike', name: 'Bisiklet', short: 'Bisiklet', icon: 'bike', ok: 'Rüzgâr ve sıcaklık uygun',
        parts: [tband(x.feels, 2, 9, 28, 33), rainPart(x, 25, 50), windPart(x, 22, 32), aqPart(x, 60, 80), x.ice ? [2, 'Buzlanma riski'] : [0, ''], !x.isDay ? [1, 'Hava karanlık'] : [0, '']] },
      { id: 'run', name: 'Koşu', short: 'Koşu', icon: 'run', ok: 'Koşu için rahat hava',
        parts: [tband(x.feels, -4, 3, 22, 29), rainPart(x, 35, 60), windPart(x, 35, 50), aqPart(x, 40, 60), x.ice ? [1, 'Buzlanma riski'] : [0, ''], !x.isDay ? [1, 'Hava karanlık'] : [0, '']] },
      { id: 'picnic', name: 'Piknik', short: 'Piknik', icon: 'basket', ok: 'Piknik havası',
        parts: [tband(x.feels, 12, 18, 29, 33), rainPart(x, 20, 40), windPart(x, 20, 30), aqPart(x, 60, 80), !x.isDay ? [2, 'Gece'] : [0, ''], x.uv >= 8 ? [1, 'UV çok yüksek'] : [0, '']] }
    ];
    var list = defs.map(function (d, i) {
      var w = worst(d.parts);
      return { id: d.id, name: d.short, icon: d.icon, lvl: w[0], label: LEVEL[w[0]], why: w[0] ? w[1] : d.ok, order: i };
    });
    list.sort(function (p, q) { return p.lvl - q.lvl || p.order - q.order; });
    var best = list[0].lvl, home = { id: 'home', name: 'Evde kal', icon: 'home', lvl: 0, label: 'Önerilir', why: x.storm ? 'Fırtına var' : 'Dışarısı pek elverişli değil', order: 9 };
    var pick = list.slice(0, 3);
    if (best >= 2) pick.unshift(home);
    else if (best === 1) pick.push(home);
    else pick.push(list[3]);
    return pick;
  }

  global.Insights = {
    dg: dg,
    airQuality: airQuality, daySummary: daySummary, activities: activities,
    AQ_LABEL: AQ_LABEL, AQ_COLOR: AQ_COLOR, LEVEL: LEVEL, eaqiLevel: eaqiLevel,
    codeWet: codeWet, codeSnow: codeSnow, codeStorm: codeStorm, codePrecip: codePrecip, tempWord: tempWord
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Insights;
})(typeof window !== 'undefined' ? window : globalThis);
