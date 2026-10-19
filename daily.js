'use strict';
/* EYRIVO günlük yaşam zekâsı (0.7.1): Konfor Endeksi, aktivite endeksleri, giyim özeti, evcil hayvan konforu, "Bugün Senin İçin" seçimi.
   Saf fonksiyonlar (DOM/ağ yok): mevcut Open-Meteo verisinden hesaplanır, ek istek yok. LLM/yapay zekâ yok — her puan kurala ve eşiğe bağlıdır.
   Kurallar:
   - Eksik/geçersiz değer (null/undefined/NaN/±Infinity) 0 sayılmaz: o sinyal hesaba katılmaz; çekirdek veri (sıcaklık) yoksa puan üretilmez (null).
   - Çıktılar olasılık/tahmin dilindedir; tıbbi, veterinerlik ya da kesinlik iddiası yoktur.
   - Tüm eşikler aşağıdaki CFG içindedir. */
(function (g) {
  var req = typeof require === 'function' && typeof module !== 'undefined';
  var E = g.EAQI || (req ? require('./eaqi.js') : null);
  var M = g.METEO || (req ? require('./meteo.js') : null);

  var CFG = {
    comfort: {
      ideal: [18, 25],              // hissedilen sıcaklık °C: bu aralıkta ceza yok
      coldPer: 0.45, coldMax: 9,    // ideal alt sınırın altında her °C için ceza / üst sınır
      hotPer: 0.7, hotMax: 8,      // ideal üst sınırın üstünde
      humHot: { tempFrom: 24, rhFrom: 65, max: 2 },    // sıcakta yüksek nem (bunaltıcılık)
      humDry: { rhBelow: 25, max: 0.8 },               // çok kuru hava
      humCold: { tempBelow: 8, rhFrom: 85, max: 0.5 }, // soğukta nemli (üşütücü)
      wind: { from: 20, per: 0.1, max: 3 },         // km/sa: ortalama rüzgâr
      gust: { from: 45, per: 0.04, max: 1.5 },
      rain: { base: 1, perMm: 0.6, max: 3, popFrom: 60, popPen: 0.8 },
      uv: { high: 6, veryHigh: 8, pHigh: 0.5, pVery: 1 }
    },
    act: {
      severeRainMm: 4,      // mm/sa ve üstü: "şiddetli yağış"
      extremeHot: 36, extremeCold: -12,   // hissedilen °C: bunun dışında dışarıda aktivite önerilmez
      aqBlock: 3,           // EAQI düzeyi ≥ 3 (Kötü): olumlu dış mekân önerisi yok
      cap: 2,               // engellenen etkinliğin en yüksek puanı
      homeMin: 7,           // ana ekranda önerilmek için en düşük puan
      golden: { before: 60, after: 15 }   // gün batımından önceki/sonraki dakika: altın saat (≈)
    },
    pet: { heatCaution: 28, heatNo: 36, coldCaution: -5, coldNo: -12, gustCaution: 50, gustNo: 70, groundUv: 5, groundTemp: 28, groundTempAny: 32, rainMm: 0.5, rainNoMm: 4 },
    outfit: { swing: 10, eveDrop: 4, windy: 28, gust: 45, lateHour: 19 },
    home: { max: 3 }
  };

  // ---------- Yardımcılar ----------
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function at(a, i) { return a && i >= 0 && i < a.length ? num(a[i]) : null; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function score(v) { return clamp(Math.round(v), 0, 10); }
  function deg(v) { var n = Math.round(v); return (n === 0 ? 0 : n) + '°'; }
  function mm(h) { return +h.slice(11, 13) * 60 + +h.slice(14, 16); }
  function aqLevel(a) { a = num(a); return a === null || !E ? null : E.level(a); }

  // ---------- Girdi hazırlama ----------
  // d: Open-Meteo yanıtı ({current, hourly, daily, elevation}); start: şu anki saat indeksi; aq: {value}|null.
  // Dönüş: düz nesne (tüm alanlar null olabilir). Hata fırlatmaz.
  function fromData(d, start, aq) {
    var x = { temp: null, feels: null, rh: null, wind: null, gust: null, precip: null, pop: null, uv: null, code: null, isDay: null, cloud: null, vis: null,
      aqi: null, stormLvl: 0, hailLvl: 0, ice: false, hour: null, nowMin: null, sunsetMin: null, sunriseMin: null, eveMin: null, dayMin: null, dayMax: null,
      popMax24: null, precipSum24: null, hoursAhead: 0, soil: null };
    try {
      if (!d || typeof d !== 'object') return x;
      var c = d.current || {}, h = d.hourly || {}, dl = d.daily || {}, s = typeof start === 'number' && start >= 0 ? start : 0;
      x.temp = num(c.temperature_2m); x.feels = num(c.apparent_temperature); x.rh = num(c.relative_humidity_2m);
      x.wind = num(c.wind_speed_10m); x.gust = num(c.wind_gusts_10m); x.precip = num(c.precipitation); x.code = num(c.weather_code);
      x.isDay = c.is_day === 1 ? true : c.is_day === 0 ? false : null; x.cloud = num(c.cloud_cover);
      if (typeof c.time === 'string' && c.time.length >= 16) { x.hour = +c.time.slice(11, 13); x.nowMin = mm(c.time); }
      if (x.gust === null) x.gust = at(h.wind_gusts_10m, s);
      if (x.precip === null) x.precip = at(h.precipitation, s);
      if (x.cloud === null) x.cloud = at(h.cloud_cover, s);
      x.pop = at(h.precipitation_probability, s); x.uv = at(h.uv_index, s); x.vis = at(h.visibility, s);
      if (x.rh === null) x.rh = at(h.relative_humidity_2m, s);
      if (x.temp === null) x.temp = at(h.temperature_2m, s);
      if (x.feels === null) x.feels = at(h.apparent_temperature, s);
      x.soil = at(h.soil_temperature_0cm, s);
      var n = h.time ? h.time.length : 0, k, fe = [], pm = null, ps = 0, ph = 0;
      for (k = s; k < Math.min(s + 24, n); k++) {
        var p = at(h.precipitation_probability, k), m = at(h.precipitation, k);
        if (p !== null && (pm === null || p > pm)) pm = p;
        if (m !== null) { ps += m; ph++; }
      }
      x.hoursAhead = Math.max(0, Math.min(24, n - s));
      x.popMax24 = pm; x.precipSum24 = ph ? ps : null;
      for (k = s; k < Math.min(s + 10, n); k++) { var f = at(h.apparent_temperature, k); if (f !== null) fe.push(f); }
      if (fe.length) x.eveMin = Math.min.apply(null, fe);
      var dmx = num(dl.apparent_temperature_max && dl.apparent_temperature_max[0]), dmn = num(dl.apparent_temperature_min && dl.apparent_temperature_min[0]);
      if (dmx === null) dmx = num(dl.temperature_2m_max && dl.temperature_2m_max[0]); if (dmn === null) dmn = num(dl.temperature_2m_min && dl.temperature_2m_min[0]);
      x.dayMax = dmx; x.dayMin = dmn;
      if (dl.sunset && typeof dl.sunset[0] === 'string') x.sunsetMin = mm(dl.sunset[0]);
      if (dl.sunrise && typeof dl.sunrise[0] === 'string') x.sunriseMin = mm(dl.sunrise[0]);
      if (M && h.time && s < n) { var rk = M.risksAt(h, s); if (rk.storm && rk.storm.known) x.stormLvl = rk.storm.level; if (rk.hail && rk.hail.known) x.hailLvl = rk.hail.level; }
      var cd = x.code; x.ice = cd === 56 || cd === 57 || cd === 66 || cd === 67 || (x.temp !== null && x.temp <= 1 && ((x.precip !== null && x.precip >= 0.1) || (cd !== null && ((cd >= 51 && cd <= 67) || (cd >= 71 && cd <= 77) || (cd >= 80 && cd <= 86))) || (x.rh !== null && x.rh >= 85 && x.pop !== null && x.pop >= 30)));
      var aqv = aq && typeof aq === 'object' ? num(aq.value) : null; x.aqi = aqv;
    } catch (e) { /* kısmi sonuç döner */ }
    return x;
  }

  // Ortak "efektif" okuma: hissedilen yoksa sıcaklık kullanılır (not düşülür)
  function feelsOf(x) { var f = num(x.feels); return f !== null ? f : num(x.temp); }
  function wetNow(x) {
    var p = num(x.precip), c = num(x.code);
    return (p !== null && p >= 0.1) || (c !== null && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95));
  }
  function stormNow(x) { var c = num(x.code); return (c !== null && c >= 95) || (num(x.stormLvl) || 0) >= 2; }
  function hailNow(x) { var c = num(x.code); return c === 96 || c === 99 || (num(x.hailLvl) || 0) >= 2; }
  // Dış mekân için sert engeller (olumlu aktivite önerisi bastırılır). Dönüş: ilk neden metni ya da ''.
  function hardBlock(x) {
    var A = CFG.act, f = feelsOf(x), p = num(x.precip), c = num(x.code), aq = aqLevel(x.aqi);
    if (hailNow(x)) return 'Dolu riski';
    if (stormNow(x)) return 'Fırtına riski';
    if ((p !== null && p >= A.severeRainMm) || c === 65 || c === 82 || c === 75 || c === 86) return 'Şiddetli yağış';
    if (aq !== null && aq >= A.aqBlock) return 'Hava kalitesi kötü';
    if (f !== null && f >= A.extremeHot) return 'Aşırı sıcak';
    if (f !== null && f <= A.extremeCold) return 'Aşırı soğuk';
    if (x.ice) return 'Buzlanma riski';
    return '';
  }

  // =====================================================================================================
  //  KONFOR ENDEKSİ (0–10)
  // =====================================================================================================
  // x: fromData çıktısı biçiminde. Dönüş: { score, text, label, reasons[], kind } ya da null (çekirdek veri yoksa).
  function comfort(x) {
    if (!x || typeof x !== 'object') return null;
    var C = CFG.comfort, f = feelsOf(x), t = num(x.temp);
    if (f === null) return null;
    var pen = [], total = 0;
    function add(kind, v, text) { if (v > 0) { v = r1(v); pen.push({ kind: kind, v: v, text: text }); total += v; } }
    if (f < C.ideal[0]) add('cold', Math.min(C.coldMax, (C.ideal[0] - f) * C.coldPer), 'Hissedilen ' + deg(f) + ', serin');
    else if (f > C.ideal[1]) add('hot', Math.min(C.hotMax, (f - C.ideal[1]) * C.hotPer), 'Hissedilen ' + deg(f) + ', sıcak');
    var rh = num(x.rh), T = t !== null ? t : f;
    if (rh !== null) {
      if (T >= C.humHot.tempFrom && rh > C.humHot.rhFrom) add('humid', Math.min(C.humHot.max, (rh - C.humHot.rhFrom) / 35 * C.humHot.max), 'Nem yüksek (%' + Math.round(rh) + ')');
      else if (rh < C.humDry.rhBelow) add('dry', Math.min(C.humDry.max, (C.humDry.rhBelow - rh) / 25 * C.humDry.max), 'Hava kuru (%' + Math.round(rh) + ')');
      else if (T <= C.humCold.tempBelow && rh > C.humCold.rhFrom) add('humid', Math.min(C.humCold.max, (rh - C.humCold.rhFrom) / 15 * C.humCold.max), 'Soğukta nemli hava');
    }
    var w = num(x.wind), gu = num(x.gust);
    if (w !== null && w > C.wind.from) add('wind', Math.min(C.wind.max, (w - C.wind.from) * C.wind.per), 'Rüzgâr ' + Math.round(w) + ' km/sa');
    if (gu !== null && gu > C.gust.from) add('wind', Math.min(C.gust.max, (gu - C.gust.from) * C.gust.per), 'Sert hamleler');
    var pm = num(x.precip), pp = num(x.pop);
    if (pm !== null && pm >= 0.1) add('rain', Math.min(C.rain.max, C.rain.base + pm * C.rain.perMm), 'Yağış var');
    else if (wetNow(x)) add('rain', C.rain.base, 'Yağış var');
    else if (pp !== null && pp >= C.rain.popFrom) add('rain', C.rain.popPen, 'Yağış ihtimali yüksek');
    if (hailNow(x)) add('storm', 4, 'Dolu riski');
    else if (stormNow(x)) add('storm', 3, 'Fırtına riski');
    var uv = num(x.uv);
    if (uv !== null && x.isDay !== false) {
      if (uv >= C.uv.veryHigh) add('uv', C.uv.pVery, 'UV çok yüksek');
      else if (uv >= C.uv.high) add('uv', C.uv.pHigh, 'UV yüksek');
    }
    var sc = score(10 - total);
    pen.sort(function (a, b) { return b.v - a.v; });
    var top = pen[0] ? pen[0].kind : '', reasons = pen.slice(0, 2).map(function (p) { return p.text; });
    if (!reasons.length) reasons = ['Sıcaklık, nem ve rüzgâr dengeli'];
    var label;
    if (sc >= 8) label = f < 15 ? 'Serin ve rahat' : f >= 23 ? 'Ilık ve rahat' : 'Ferah ve rahat';
    else if (sc >= 5) label = { cold: 'Serin', hot: 'Sıcak', humid: 'Nemli', dry: 'Kuru hava', wind: 'Rüzgârlı', rain: 'Yağışlı', uv: 'Güneş sert' }[top] || 'Genel olarak rahat';
    else if (sc >= 3) label = top === 'hot' || top === 'humid' ? (pen.some(function (p) { return p.kind === 'humid'; }) ? 'Bunaltıcı' : 'Çok sıcak') : top === 'cold' ? 'Soğuk' : top === 'wind' ? 'Çok rüzgârlı' : top === 'rain' ? 'Islak ve rahatsız' : 'Rahatsız edici';
    else label = top === 'hot' ? 'Aşırı sıcak' : top === 'cold' ? 'Dondurucu' : 'Zor koşullar';
    if (top === 'storm' && sc < 8) label = 'Fırtınalı';
    return { score: sc, label: label, text: sc + '/10 · ' + label, reasons: reasons, kind: top, estimated: num(x.feels) === null };
  }

  // =====================================================================================================
  //  AKTİVİTE ENDEKSLERİ (0–10)
  // =====================================================================================================
  var ACT = [
    { id: 'walk', name: 'Yürüyüş', icon: 'walk' },
    { id: 'coffee', name: 'Dışarıda kahve', icon: 'coffee' },
    { id: 'sport', name: 'Açık hava sporu', icon: 'dumbbell' },
    { id: 'photo', name: 'Fotoğraf / altın saat', icon: 'camera' },
    { id: 'carwash', name: 'Araç yıkama', icon: 'car' }
  ];
  function actLabel(sc) { return sc >= 8 ? 'Çok uygun' : sc >= 6 ? 'Uygun' : sc >= 4 ? 'İdare eder' : 'Uygun değil'; }
  // uyum: [alt, üst] hissedilen aralığında 10, dışına çıktıkça `per` puan düşer
  function fit(f, lo, hi, per) { return f < lo ? (lo - f) * per : f > hi ? (f - hi) * per : 0; }

  function activities(x) {
    if (!x || typeof x !== 'object') return [];
    var f = feelsOf(x); if (f === null) return [];
    var A = CFG.act, block = hardBlock(x), w = num(x.wind), gu = num(x.gust), pp = num(x.pop), rh = num(x.rh), uv = num(x.uv), aq = aqLevel(x.aqi), wet = wetNow(x), dark = x.isDay === false;
    var out = [];
    function mk(a, sc, why, extraBlock, own) {   // own: yalnızca kendi engelini uygula (araç yıkama dışarı çıkma koşullarına bağlı değildir)
      var gb = own ? (/^(Fırtına|Dolu|Şiddetli|Buzlanma)/.test(block) ? block : '') : block;
      var blocked = !!(gb || extraBlock), s = score(sc), reason = gb || extraBlock || why;
      if (blocked) s = Math.min(s, A.cap);
      out.push({ id: a.id, name: a.name, icon: a.icon, score: s, label: actLabel(s), why: reason, blocked: blocked });
    }
    function common(sc, rainW) {   // yağış / rüzgâr / hava kalitesi ortak cezaları + en etkili neden
      var why = '', worst = 0;
      function pen(v, t) { sc -= v; if (v > worst) { worst = v; why = t; } }
      if (wet) pen(rainW, 'Yağış var'); else if (pp !== null && pp >= 60) pen(rainW * 0.5, 'Yağış ihtimali yüksek');
      if (w !== null && w > 22) pen(Math.min(3, (w - 22) / 8), 'Rüzgâr kuvvetli');
      if (gu !== null && gu > 45) pen(Math.min(2, (gu - 45) / 15), 'Sert hamleler');
      if (aq !== null && aq === 2) pen(1, 'Hava kalitesi orta');
      return { sc: sc, why: why };
    }
    var x1;
    // Yürüyüş
    x1 = common(10 - fit(f, 12, 24, 0.5) - (dark ? 1.5 : 0), 5);
    mk(ACT[0], x1.sc, x1.why || (f < 12 ? 'Hava serin' : f > 24 ? 'Hava sıcak' : dark ? 'Hava karanlık' : 'Hava yürümeye uygun'));
    // Dışarıda kahve
    x1 = common(10 - fit(f, 16, 27, 0.6) - (dark ? 1 : 0) - (uv !== null && uv >= 8 && !dark ? 1 : 0), 6);
    mk(ACT[1], x1.sc, x1.why || (f < 16 ? 'Dışarıda biraz serin' : f > 27 ? 'Dışarıda sıcak' : 'Dışarıda oturmak güzel'));
    // Açık hava sporu
    var heatPen = f > 22 ? (f - 22) * 0.6 : 0, humPen = rh !== null && f > 24 && rh > 70 ? Math.min(1.5, (rh - 70) / 20) : 0;
    x1 = common(10 - fit(f, 8, 20, 0.5) - heatPen * (f > 24 ? 1 : 0.5) - humPen - (dark ? 1.5 : 0) - (aq === 2 ? 1 : 0), 6);
    mk(ACT[2], x1.sc, x1.why || (f > 24 ? 'Sıcakta efor zorlaşır' : f < 8 ? 'Soğukta ısınmak gerekir' : 'Efor için rahat hava'));
    // Fotoğraf / altın saat
    var cl = num(x.cloud), vis = num(x.vis), nm = num(x.nowMin), ss = num(x.sunsetMin), sr = num(x.sunriseMin), gold = false, toGold = null, ps;
    if (dark) ps = 1;
    else {
      ps = 5;   // gündüz: ışık var ama altın saat değil
      if (cl !== null) ps += cl >= 20 && cl <= 70 ? 1.5 : cl > 90 ? -1.5 : 0;
      if (nm !== null && ss !== null) {
        var d0 = ss - nm;
        if (d0 <= A.golden.before && d0 >= -A.golden.after) { gold = true; ps = 8 + (cl !== null && cl >= 15 && cl <= 75 ? 1.5 : cl !== null && cl > 90 ? -2 : 0.5); }
        else if (d0 > A.golden.before && d0 <= 240) toGold = d0 - A.golden.before;
      }
      if (!gold && nm !== null && sr !== null && nm >= sr && nm <= sr + 60) { gold = true; ps = 8 + (cl !== null && cl >= 15 && cl <= 75 ? 1 : 0); }
    }
    if (vis !== null && vis < 4000) ps -= 2;
    if (wet) ps -= 3; else if (pp !== null && pp >= 70) ps -= 1;
    mk(ACT[3], ps, dark ? 'Hava karanlık' : gold ? 'Altın saat (yaklaşık) · ışık yumuşak' : toGold !== null && toGold > 0 ? 'Altın saate yaklaşık ' + Math.round(toGold / 15) * 15 + ' dk' : cl !== null && cl > 90 ? 'Gökyüzü kapalı' : 'Işık normal');
    // Araç yıkama
    if (x.hoursAhead >= 6 || wet || (pp !== null && pp >= 50)) {
      var cs = 10, cwhy = 'Önümüzdeki saatler kuru görünüyor', pm24 = num(x.popMax24), ps24 = num(x.precipSum24);
      if (wet) { cs -= 7; cwhy = 'Yağış var'; }
      else if ((ps24 !== null && ps24 >= 0.5) || (pm24 !== null && pm24 >= 50)) { cs -= pm24 !== null && pm24 >= 70 ? 6 : 4; cwhy = 'Yakında yağış ihtimali var'; }
      if (f <= 2) { cs -= 4; cwhy = 'Donma riski: yıkama önerilmez'; }
      if (gu !== null && gu >= 45) { cs -= 2; if (cs >= 8) cwhy = 'Rüzgâr toz kaldırabilir'; }
      mk(ACT[4], cs, cwhy, f <= -5 ? 'Aşırı soğuk' : '', true);
    }
    return out;
  }
  // Ana ekranda önerilecek olumlu aktiviteler (engelsiz, yüksek puanlı). En çok n.
  function topActivities(acts, n) {
    return (acts || []).filter(function (a) { return !a.blocked && a.score >= CFG.act.homeMin; }).sort(function (a, b) { return b.score - a.score; }).slice(0, n === undefined ? 3 : n);
  }

  // =====================================================================================================
  //  GİYİM (kısa, işlevsel — cinsiyet/beden/stil varsayımı yok)
  // =====================================================================================================
  // x: fromData çıktısı. opt.rain=false → yağış cümlesi eklenmez (ana ekranda şemsiye çipi zaten var).
  // base: ADVICE.clothing(...) sonucu (varsa) — {key,text,short}. Dönüş: {key,text,short,parts[]} ya da null.
  function outfit(x, base, opt) {
    if (!x || typeof x !== 'object') return base || null;
    var O = CFG.outfit, f = feelsOf(x); if (f === null) return base || null;
    opt = opt || {};
    var parts = [], key = base ? base.key : '', short = base ? base.short : '';
    if (f <= -5) { parts.push('Kalın mont, bere ve eldiven'); key = key || 'cold'; short = short || 'Kalın giyin'; }
    else if (f <= 3) { parts.push('Kalın mont'); key = key || 'cold'; short = short || 'Kalın giyin'; }
    else if (f <= 10) { parts.push('Mont giy'); key = key || 'coat'; short = short || 'Mont giy'; }
    else if (f <= 17) { parts.push(f <= 14 ? 'Ceket ya da kalın bir üstlük' : 'İnce bir üstlük yeterli'); key = key || 'layer'; short = short || 'Üstlük yeterli'; }
    else if (f >= 30) { parts.push('Hafif ve açık renkli giyin'); }
    else if (f >= 25) parts.push('Hafif giyin');
    var hour = num(x.hour), eve = num(x.eveMin), w = num(x.wind), gu = num(x.gust), extra = [];
    if (hour !== null && hour < O.lateHour && eve !== null && f > 12 && f - eve >= O.eveDrop) extra.push('akşam serinleyecek, yanına ek katman al');
    var wind = (w !== null && w >= O.windy) || (gu !== null && gu >= O.gust);
    if (wind && f < 24) extra.push('rüzgâr kesici iyi olur');
    var dmx = num(x.dayMax), dmn = num(x.dayMin);
    if (dmx !== null && dmn !== null && dmx - dmn >= O.swing && !extra.length) extra.push('gün içinde sıcaklık değişiyor, katmanlı giyin');
    if (opt.rain !== false) {
      if (wetNow(x) || (num(x.pop) !== null && x.pop >= 60)) extra.push('su geçirmez bir dış katman ya da şemsiye al');
    }
    if (opt.chip && !base && !extra.length) return null;   // ana ekran çipi: yalnızca gerçek bir ihtiyaç varsa (yeni çip eklenmez)
    if (base && base.key) { var bk = base.key; if (/^eve/.test(bk)) extra = extra.filter(function (e) { return !/akşam/.test(e); }); if (bk === 'windy') extra = extra.filter(function (e) { return !/rüzgâr/.test(e); }); }
    if (!parts.length && !extra.length) return base || null;
    var text = parts.concat(extra.slice(0, 2)).map(function (s, i) { return i ? s : s.charAt(0).toLocaleUpperCase('tr') + s.slice(1); }).join(' · ');
    if (!parts.length) text = text.charAt(0).toLocaleUpperCase('tr') + text.slice(1);
    // base varsa onun metni korunur; yalnızca ek sinyaller eklenir (mevcut çip davranışı bozulmaz)
    if (base && base.text) { var ex = extra.slice(0, 1); text = ex.length ? base.text.replace(/[.]$/, '') + ' · ' + ex[0] : base.text; }
    return { key: key || (extra.length ? 'extra' : 'mild'), text: text, short: short || (extra[0] ? (/akşam/.test(extra[0]) ? 'Akşam için üstlük' : /rüzgâr/.test(extra[0]) ? 'Rüzgâr kesici' : /katmanlı/.test(extra[0]) ? 'Katmanlı giyin' : 'Su geçirmez') : ''), parts: parts.concat(extra) };
  }

  // =====================================================================================================
  //  EVCİL HAYVAN KONFORU (açık hava uygunluğu — tahmini risk, ölçüm değil)
  // =====================================================================================================
  // Zemin ısınma tahmini: gündüz, sıcaklık ve UV'ye bağlı bir RİSK sınıfı; asfalt sıcaklığı ölçümü/değeri sunulmaz.
  function groundHeatRisk(x) {
    var P = CFG.pet, t = num(x.temp), uv = num(x.uv), cl = num(x.cloud), day = x.isDay !== false;
    if (t === null) return 0;
    var sunny = uv !== null ? uv >= P.groundUv : (cl !== null ? cl < 50 : false);
    if (t >= P.groundTempAny + 4) return 2;                       // çok sıcak havada gece geç saatlere kadar zemin sıcak kalabilir
    if (day && sunny && t >= P.groundTemp + 4) return 2;
    if (day && sunny && t >= P.groundTemp) return 1;
    if (t >= P.groundTempAny) return 1;
    return 0;
  }
  function pet(x) {
    if (!x || typeof x !== 'object') return null;
    var P = CFG.pet, f = feelsOf(x); if (f === null) return null;
    var lvl = 0, why = [], p = num(x.precip), gu = num(x.gust), w = num(x.wind), aq = aqLevel(x.aqi);
    function up(l, t) { if (l > lvl) lvl = l; if (why.indexOf(t) < 0) why.push(t); }
    if (stormNow(x)) up(2, 'Fırtına riski var');
    if (hailNow(x)) up(2, 'Dolu riski var');
    if (f >= P.heatNo) up(2, 'Hava çok sıcak');
    else if (f >= P.heatCaution) up(1, 'Hava sıcak: sabah erken ya da akşam geç saatleri seç');
    if (f <= P.coldNo) up(2, 'Hava çok soğuk');
    else if (f <= P.coldCaution) up(1, 'Hava soğuk: yürüyüşü kısa tut');
    if (x.ice) up(1, 'Buzlanma olabilir: zemin kaygan');
    var gr = groundHeatRisk(x);
    if (gr === 2) up(1, 'Zemin sıcaklığı tahmini yüksek olabilir');
    else if (gr === 1) up(1, 'Zemin ısınmış olabilir (tahmini risk): elinin tersiyle yokla');
    if ((p !== null && p >= P.rainNoMm) || num(x.code) === 65 || num(x.code) === 82) up(2, 'Şiddetli yağış var');
    else if (wetNow(x)) up(1, 'Yağış var: ıslanma ve kaygan zemin');
    if (gu !== null && gu >= P.gustNo) up(2, 'Rüzgâr çok sert');
    else if ((gu !== null && gu >= P.gustCaution) || (w !== null && w >= 40)) up(1, 'Rüzgâr kuvvetli');
    if (aq !== null && aq >= 3) up(1, 'Hava kalitesi kötü: dışarıda kısa kal');
    var title = lvl === 0 ? '🐾 Yürüyüş için uygun' : lvl === 1 ? '🐾 Yürüyüşte dikkatli ol' : '🐾 Şu an uzun yürüyüş için uygun değil';
    if (lvl === 0) why = ['Sıcaklık, yağış ve rüzgâr uygun görünüyor'];
    return { level: lvl, title: title, reasons: why.slice(0, 3), groundRisk: gr, note: 'Tahmini değerlendirmedir; hava verisinden hesaplanır. Veteriner tavsiyesi değildir.' };
  }

  // =====================================================================================================
  //  "BUGÜN SENİN İÇİN" — ana ekran seçimi
  // =====================================================================================================
  var OUTDOOR_POS = { walk: 1, dog: 1, run: 1, bike: 1, coffee: 1, picnic: 1, sport: 1, sun: 1 };
  // tiles: ADVICE.life().tiles (varsa); x: girdi; acts: activities(x). En çok CFG.home.max öğe; aynı iletiyi tekrarlamaz.
  // Dönüş: [{id, icon, name, label, why, lvl, score?, home?}]
  function pick(tiles, x, acts) {
    var max = CFG.home.max, block = x ? hardBlock(x) : '', out = [], seen = {};
    tiles = Array.isArray(tiles) ? tiles : [];
    var famOf = { walk: 'stroll', dog: 'stroll', run: 'sport', sport: 'sport', bike: 'cycle', coffee: 'coffee', picnic: 'picnic', vent: 'vent', sun: 'sun', photo: 'sun', carwash: 'carwash', home: 'home' };
    function push(t) { var fam = famOf[t.id] || t.id; if (seen[fam]) return false; seen[fam] = 1; out.push(t); return true; }
    var byId = {}; (acts || []).forEach(function (a) { byId[a.id] = a; });
    // Zorunlu kutular (kırpılmaz): "Evde kal" ve havalandırma/hava kalitesi/polen uyarısı ya da önerisi (advice.js kararı). Kalanlar sırayla, toplam en çok `max`.
    var must = {}; tiles.forEach(function (t, i) { if (t && (t.home || t.id === 'vent')) must[i] = 1; });
    var nMust = Object.keys(must).length, room = Math.max(0, max - nMust), keep = {};
    var famSeen = {};
    tiles.forEach(function (t, i) { if (t && must[i]) famSeen[famOf[t.id] || t.id] = 1; });
    tiles.forEach(function (t, i) {
      if (!t || must[i]) { if (t) keep[i] = 1; return; }
      if (block && t.lvl === 0 && OUTDOOR_POS[t.id]) return;   // sert engel: olumlu dış mekân önerisi gösterilmez
      var fam = famOf[t.id] || t.id; if (famSeen[fam]) return;   // aynı aileden ikinci öneri yer harcamaz
      if (room > 0) { keep[i] = 1; famSeen[fam] = 1; room--; }
    });
    tiles.forEach(function (t, i) {
      if (!t || !keep[i]) return;
      if (block && t.lvl === 0 && !t.home && OUTDOOR_POS[t.id]) return;
      var o = { id: t.id, icon: t.icon, name: t.name, label: t.label, why: t.why, lvl: t.lvl, home: !!t.home };
      var a = byId[t.id === 'sun' ? 'photo' : t.id];
      if (a && !a.blocked && t.lvl === 0) o.score = a.score;
      push(o);
    });
    // boş yer varsa ve hava gerçekten uygunsa: yüksek puanlı yeni etkinlikler (altın saat, araç yıkama) — çelişmeyecek şekilde
    if (!block && out.length < max && !out.some(function (o) { return o.home || o.lvl >= 2; })) {
      topActivities(acts, 6).forEach(function (a) {
        if (out.length >= max || (a.id !== 'photo' && a.id !== 'carwash')) return;
        push({ id: a.id, icon: a.icon, name: a.name, label: a.label, why: a.why, lvl: 0, score: a.score, home: false });
      });
    }
    return out;
  }

  // =====================================================================================================
  //  DİNAMİK RENK TONU — gökyüzü temasının üstüne çok hafif bir ton katmanı (marka paleti değişmez; rastgelelik yok)
  // =====================================================================================================
  // Aynı girdi → aynı çıktı. Dönüş: { c: '#rrggbb', o: 0..0.14 } (o=0: ton yok). Kaynak: sıcaklık, bulut, yağış, sis, gün ışığı, gün batımı/doğumu yakınlığı.
  var TINT = { max: 0.14, sunGlow: { before: 60, after: 30, o: 0.12 }, dusk: { from: 30, to: 100, o: 0.08 }, dawn: { before: 20, after: 60, o: 0.09 },
    hot: { from: 28, per: 0.012, max: 0.1 }, cold: { from: 4, per: 0.012, max: 0.1 }, fog: { vis: 2000, o: 0.1 }, overcast: { cloud: 90, o: 0.06 } };
  function tint(x) {
    var none = { c: '#000000', o: 0 };
    if (!x || typeof x !== 'object') return none;
    var best = none, T = TINT;
    function cand(c, o) { if (o > best.o) best = { c: c, o: Math.round(clamp(o, 0, T.max) * 1000) / 1000 }; }
    var nm = num(x.nowMin), ss = num(x.sunsetMin), sr = num(x.sunriseMin), t = num(x.temp), cl = num(x.cloud), vis = num(x.vis), code = num(x.code);
    var wet = wetNow(x), shade = cl !== null && cl >= 85 ? 0.5 : 1;
    if (nm !== null && ss !== null) {
      var d = ss - nm;   // + : gün batımına kalan dakika
      if (d <= T.sunGlow.before && d >= -T.sunGlow.after) cand('#ff9d5c', T.sunGlow.o * (1 - Math.abs(d > 0 ? d / T.sunGlow.before : d / T.sunGlow.after) * 0.6) * (wet ? 0.4 : shade));
      else if (-d > T.dusk.from && -d <= T.dusk.to) cand('#4a4fb0', T.dusk.o * (1 - (-d - T.dusk.from) / (T.dusk.to - T.dusk.from) * 0.5));
    }
    if (nm !== null && sr !== null) {
      var e = nm - sr;   // + : gün doğumundan geçen dakika
      if (e >= -T.dawn.before && e <= T.dawn.after) cand('#ffb27a', T.dawn.o * (1 - Math.abs(e < 0 ? e / T.dawn.before : e / T.dawn.after) * 0.5) * (wet ? 0.4 : shade));
    }
    if (t !== null && x.isDay !== false && t >= T.hot.from) cand('#ffb347', (t - T.hot.from + 2) * T.hot.per);
    if (t !== null && t <= T.cold.from) cand('#8fc4ff', (T.cold.from - t + 2) * T.cold.per);
    if ((code === 45 || code === 48) || (vis !== null && vis < T.fog.vis)) cand('#c8d0d6', T.fog.o);
    if (cl !== null && cl >= T.overcast.cloud && !wet) cand('#9aa8b5', T.overcast.o);
    return best;
  }

  var API = {
    tint: tint, TINT: TINT, CFG: CFG, fromData: fromData, comfort: comfort, activities: activities, topActivities: topActivities, outfit: outfit, pet: pet,
    groundHeatRisk: groundHeatRisk, hardBlock: hardBlock, pick: pick, ACT: ACT
  };
  g.DAILY = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
