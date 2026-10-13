/* Akıllı yaşam önerileri + sürüş havası — kural tabanlı, hesaplanabilir. Dış servis / yapay zekâ / ek ağ isteği YOK.
   Girdi: uygulamanın elindeki Open-Meteo saatlik dizileri (+ varsa hava kalitesi). Saf fonksiyonlar: DOM'a dokunmaz.
   TÜM eşikler aşağıdaki CFG içindedir; kodun başka yerinde sayısal eşik tanımlanmaz.
   Dil: olasılık / öneri dili. Güvenlik garantisi ya da tıbbi kesinlik iddiası yoktur.
   Eksik değer (null/undefined/NaN) hiçbir zaman "güvenli" ya da "riskli" sayılmaz: o sinyal hesaba katılmaz, sonuç "kısmi veri" olarak işaretlenir. */
'use strict';
(function (g) {
  var req = typeof require === 'function';
  var I = g.Insights || (req ? require('./insights.js') : null);
  var M = g.METEO || (req ? require('./meteo.js') : null);
  var E = g.EAQI || (req ? require('./eaqi.js') : null);

  // ---------- Tüm eşikler ----------
  var CFG = {
    drive: {
      windowH: 3,              // "şu an" = bu saat içindeki en kötü saat (anlık + yakın gelecek)
      horizonH: 12,            // saatlik görünüm ve değişim araması
      // Düzey: her sinyal 0..3 puan üretir. Riskli: tek bir ciddi sinyal (≥ riskMax) VEYA toplam ≥ riskSum. Dikkat: toplam ≥ cautionSum.
      riskMax: 3, riskSum: 4, cautionSum: 1,
      // Eşikler artan sırayla [puan 1, puan 2, puan 3] için. Yağış mm/sa (WMO: orta ≥2,5 · şiddetli ≥7,6), kar cm/sa, rüzgâr hamlesi km/sa
      rain: [2.5, 7.6, 20], rainMinProb: 30,                // olasılık bilinip bu değerin altındaysa (ve kod yağışlı değilse) miktar sayılmaz
      rainCode: { 63: 1, 81: 1, 65: 2, 82: 2 },             // miktar yoksa kodlardan
      snow: [0.3, 1, 3], snowCode: { 73: 1, 86: 1, 75: 2 },
      vis: [4000, 1000, 200],                               // metre; eşiğin ALTINDA (4 km: azalmış · 1 km: sis sınırı · 200 m: çok yoğun sis)
      fogCodes: [45, 48], fogPts: 1,                        // görüş verisi yoksa sis kodu tek başına en çok "Dikkat" yapar
      gust: [50, 70, 90], windFallback: [40, 60, 80],       // hamle verisi yoksa ortalama rüzgâr eşikleri
      ice: {
        codes: [56, 57, 66, 67],                            // donan yağmur / çise: ciddi (3)
        freezeC: 0.5,                                       // bu sıcaklık ve altında + yağış → 2
        nearC: 2, nearMinC: -2, rhFrost: 80,                // donma civarı (−2…+2 °C) ve nem yüksek/bilinmiyor → 1
        wetMm: 0.1, wetProb: 50,                            // "yağışlı" sayılma: miktar veya olasılık
        frzAboveM: 150, frzMaxC: 4                          // donma seviyesi yüzeye ≤150 m yakın + yağış + sıcaklık ≤4 °C → 1
      },
      stormPts: [0, 1, 3], hailPts: [0, 1, 3]               // METEO düzeyi (Düşük/Orta/Yüksek) → puan
          },
    life: {
      tiles: 4,
      dayHours: [6, 22],                                    // "en uygun zaman" yalnızca bu saatler arasında aranır
      minRun: 2, searchH: 10,                               // en az bu kadar saatlik uygun aralık; bu kadar saat ileriye bak
      rainStartProb: 60, rainStartMm: 0.3, rainBeforeMax: 5,// yağmur başlıyor sayılma ve "yağmurdan önce fırsat" için en çok kaç saat önce
      calm: { from: 28, to: 18, run: 3 },                   // rüzgâr ≥ from iken, to altına inen 'run' saatlik aralık → "rüzgâr zayıflıyor"
      uvLine: 6, uvStrong: 8,                               // "UV yüksek" / "çok yüksek" satırı
      extremeFeels: [-12, 38],                              // bu aralığın dışı: ciddi güvenlik riski (etkinlik önerisi bastırılır)
      goldenMin: 60, goldenRound: 15, goldenLookH: 4, goldenPrioMin: 120,// golden hour ≈ gün batımından 60 dk önce; dakika 15'e yuvarlanır ("yaklaşık"); başlangıcına ≤120 dk kala öne çıkar
      sunsetCloudOk: 75, photoCloudOk: 85, sunsetVisOk: 5000,// % bulut; gün batımı saatinde bunun altı iyi ışık
      pollenHigh: 50,                                       // tane/m³ (herhangi bir tür) — polen verisi varsa havalandırma uyarısı
      ventCold: 3, ventHot: 30, ventHumid: 90,              // dış sıcaklık °C / nem %
      ventHours: [[7, 10], [18, 20]], ventBoost: 0.25,      // alışılmış havalandırma saatlerinde 'uygun' havalandırma önerisi öne çıkar (yürüyüş/kahve önünde değil)
      wetNowMm: 0.5, stormLvlSuppress: 1,
      recentPenalty: 0.12, memTTL: 12 * 3600000, memKeep: 60,// tekrar azaltma: önceki oturumda gösterilen etkinliğe küçük ceza; metin varyasyonu
      fitGreat: 0.75,                                       // bu uyumdan sonra "keyifli" tonlu metin
      staleAfterMs: 2 * 3600000                             // veri bu kadar eskiyse kesin saatli öneri verilmez (detay ekranındaki 'Veri eski' notuyla aynı süre)
    },
    clothing: { cold: 3, cool: 10, mild: 17, eveningDrop: 4, eveningWarm: 14, eveningCold: 9, windy: 28, windyMaxFeels: 22, hot: 30, lateHour: 19 }
  };

  // ---------- Küçük yardımcılar ----------
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function at(a, i) { return a && i >= 0 && i < a.length ? num(a[i]) : null; }
  function rd(n) { var x = Math.round(n); return x === 0 ? 0 : x; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hr(t) { return +t.slice(11, 13); }
  function hhmm(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function mins(t) { return +t.slice(11, 13) * 60 + +t.slice(14, 16); }
  function cap(s) { return s ? s.charAt(0).toLocaleUpperCase('tr') + s.slice(1) : s; }
  function partOf(h) { return h < 6 ? 'gece' : h < 11 ? 'sabah' : h < 14 ? 'öğle saatlerinde' : h < 18 ? 'öğleden sonra' : h < 22 ? 'akşam' : 'gece'; }
  function partLead(h) { var p = partOf(h); return p === 'sabah' || p === 'akşam' ? cap(p) + ' saatlerinde' : cap(p); }   // bayat veri: saat yok, gün bölümü
  function partWord(h) { var p = partOf(h); return p === 'öğle saatlerinde' ? 'öğle' : p; }   // "Rüzgâr akşam zayıflıyor"
  function maxOf(list) { var m = null; list.forEach(function (v) { if (v !== null && (m === null || v > m)) m = v; }); return m; }
  function minOf(list) { var m = null; list.forEach(function (v) { if (v !== null && (m === null || v < m)) m = v; }); return m; }
  function avgOf(list) { var s = 0, n = 0; list.forEach(function (v) { if (v !== null) { s += v; n++; } }); return n ? s / n : null; }
  // eşik sayısı: artan eşiklerden kaçına ulaşıldı (0..3)
  function stepUp(v, th) { var k = 0; while (k < th.length && v >= th[k]) k++; return k; }
  function stepDown(v, th) { var k = 0; while (k < th.length && v < th[k]) k++; return k; }

  // ---------- Tekrar azaltma: oturum içinde sabit, oturumlar arasında dönen metin varyasyonu ----------
  // mem: { sid, v: {anahtar: {s, i, t}}, cur: {ids, t}, prev: {ids, t} } | null. Yalnızca BİRBİRİNE EŞ DOĞRU metinler arasında döner; koşul belirleyicidir.
  function memNew(sid) { return { sid: sid, v: {}, cur: null, prev: null }; }
  function memSession(mem, now) {   // yeni oturumda geçen oturumun gösterdiği etkinlikler 'prev' olur
    if (!mem) return;
    if (mem.sid !== mem.seen) {
      mem.seen = mem.sid;
      if (mem.cur && now - mem.cur.t <= CFG.life.memTTL) mem.prev = mem.cur;
      mem.cur = null;
    }
  }
  function variant(mem, key, arr, now) {
    if (!arr || !arr.length) return '';
    if (arr.length === 1 || !mem) return arr[0];
    var m = mem.v[key], idx;
    if (m && m.s === mem.sid) idx = m.i % arr.length;
    else idx = m ? (m.i + 1) % arr.length : 0;
    mem.v[key] = { s: mem.sid, i: idx, t: now || 0 };
    return arr[idx];
  }
  function memPrune(mem, now) {
    if (!mem) return;
    var keys = Object.keys(mem.v);
    keys.forEach(function (k) { if (now - mem.v[k].t > 3 * 86400000) delete mem.v[k]; });
    keys = Object.keys(mem.v);
    if (keys.length > CFG.life.memKeep) keys.sort(function (a, b) { return mem.v[a].t - mem.v[b].t; }).slice(0, keys.length - CFG.life.memKeep).forEach(function (k) { delete mem.v[k]; });
  }

  // =====================================================================================================
  //  SÜRÜŞ HAVASI
  // =====================================================================================================
  var DL = ['İyi', 'Dikkat', 'Riskli'];
  var PRIO = ['storm', 'hail', 'ice', 'snow', 'rain', 'vis', 'gust'];   // eşit puanda gösterim sırası: "Yoğun yağış ve düşük görüş"
  var PH = {
    storm: [null, 'fırtına riski', 'yüksek fırtına riski', 'yüksek fırtına riski'],
    hail: [null, 'dolu ihtimali', 'yüksek dolu riski', 'yüksek dolu riski'],
    ice: [null, 'buzlanma ihtimali', 'buzlanma riski', 'donan yağış (buzlanma)'],
    snow: [null, 'kar yağışı', 'yoğun kar', 'yoğun kar'],
    vis: [null, 'azalan görüş', 'düşük görüş', 'çok düşük görüş'],
    rain: [null, 'orta şiddette yağış', 'yoğun yağış', 'çok şiddetli yağış'],
    gust: [null, 'kuvvetli rüzgâr hamleleri', 'çok kuvvetli rüzgâr hamleleri', 'çok kuvvetli rüzgâr hamleleri']
  };
  var IMPROVE = { rain: 'yağış azalıyor.', snow: 'kar azalıyor.', vis: 'görüş düzeliyor.', gust: 'rüzgâr hamleleri zayıflıyor.', ice: 'buzlanma riski azalıyor.', storm: 'fırtına riski azalıyor.', hail: 'dolu riski azalıyor.' };

  // Tek saatin sinyalleri. h: saatlik diziler, i: indeks, elev: konum yüksekliği (m) | null.
  function driveHour(h, i, elev) {
    var D = CFG.drive, code = at(h.weather_code, i), mm = at(h.precipitation, i), prob = at(h.precipitation_probability, i), sn = at(h.snowfall, i);
    var t = at(h.temperature_2m, i), rh = at(h.relative_humidity_2m, i), vis = at(h.visibility, i), gust = at(h.wind_gusts_10m, i), wind = at(h.wind_speed_10m, i), frz = at(h.freezing_level_height, i);
    var sig = {}, known = { rain: false, vis: false, gust: false }, wetCode = code !== null && I.codeWet(code);

    // yağış
    var p = 0;
    if (mm !== null) { known.rain = true; p = stepUp((prob === null || prob >= D.rainMinProb || wetCode) ? mm : 0, D.rain); }
    if (code !== null) { known.rain = true; p = Math.max(p, D.rainCode[code] || 0); }
    sig.rain = p;
    // kar
    var sp = 0;
    if (sn !== null) sp = stepUp(sn, D.snow);
    if (code !== null) sp = Math.max(sp, D.snowCode[code] || 0);
    sig.snow = sp;
    var snowy = sp > 0 || (code !== null && I.codeSnow(code)), wet = wetCode || (mm !== null && mm >= D.ice.wetMm) || (prob !== null && prob >= D.ice.wetProb) || snowy;
    // buzlanma
    var ip = 0, X = D.ice;
    if (code !== null && X.codes.indexOf(code) >= 0) ip = 3;
    else if (t !== null) {
      if (t <= X.freezeC && wet) ip = 2;
      else if (t <= X.nearC && t >= X.nearMinC && (wet || rh === null || rh >= X.rhFrost)) ip = 1;
      else if (wet && t <= X.frzMaxC && elev !== null && frz !== null && frz - elev <= X.frzAboveM) ip = 1;
    }
    sig.ice = ip;
    // görüş / sis
    var vp = 0, fog = code !== null && D.fogCodes.indexOf(code) >= 0;
    if (vis !== null) { known.vis = true; vp = stepDown(vis, D.vis); }
    else if (fog) vp = D.fogPts;
    sig.vis = vp; sig.fog = fog && vp > 0;
    // rüzgâr hamlesi
    var gp = 0;
    if (gust !== null) { known.gust = true; gp = stepUp(gust, D.gust); }
    else if (wind !== null) { known.gust = true; gp = stepUp(wind, D.windFallback); }
    sig.gust = gp;
    // fırtına / dolu (meteo.js ile aynı hesap)
    var rk = M.risksAt(h, i), stp = 0, hlp = 0;
    if (rk.storm.known) stp = D.stormPts[rk.storm.level] || 0;
    if (rk.hail.known) hlp = D.hailPts[rk.hail.level] || 0;
    sig.storm = stp; sig.hail = hlp;

    var sum = 0, max = 0;
    PRIO.forEach(function (k) { sum += sig[k]; if (sig[k] > max) max = sig[k]; });
    var lvl = (max >= D.riskMax || sum >= D.riskSum) ? 2 : sum >= D.cautionSum ? 1 : 0;
    var any = known.rain || known.vis || known.gust || rk.storm.known || rk.hail.known || sp > 0 || ip > 0;
    return { i: i, sig: sig, sum: sum, max: max, lvl: lvl, known: any, partial: !(known.rain && known.vis && known.gust), knownVis: known.vis, knownGust: known.gust, knownRain: known.rain };
  }
  function reasonsOf(hr_, n) {
    var list = [];
    PRIO.forEach(function (k, order) { var p = hr_.sig[k]; if (p > 0) list.push({ k: k, pts: p, order: order, text: (k === 'vis' && hr_.sig.fog) ? (p >= 3 ? 'çok yoğun sis' : p === 2 ? 'yoğun sis' : 'sis ihtimali') : PH[k][p] }); });
    list.sort(function (a, b) { return b.pts - a.pts || a.order - b.order; });
    return list.slice(0, n || 2);
  }
  function joinReasons(rs) { return rs.length === 2 ? rs[0].text + ' ve ' + rs[1].text : rs.length ? rs[0].text : ''; }

  // Sürüş değerlendirmesi. o: { h, start, elev, stale }
  function isStale(o) { return !!o.stale || (num(o.age) !== null && o.age > CFG.life.staleAfterMs); }
  function drive(o) {
    var D = CFG.drive, h = o.h, s = o.start;
    if (!h || !h.time || s < 0 || s >= h.time.length) return null;
    var n = Math.min(D.horizonH, h.time.length - s), hours = [], k, hh;
    for (k = 0; k < n; k++) { hh = driveHour(h, s + k, num(o.elev)); hours.push(hh); }
    var win = hours.slice(0, Math.min(D.windowH, hours.length)), worst = null, wi = 0, anyKnown = false, partial = false;
    win.forEach(function (x, idx) {
      if (x.known) anyKnown = true; if (x.partial) partial = true;
      if (!worst || x.lvl > worst.lvl || (x.lvl === worst.lvl && x.sum > worst.sum)) { worst = x; wi = idx; }
    });
    if (!anyKnown) return null;   // hiç sinyal bilinmiyorsa kart gösterilmez (uydurma "İyi" yok)
    var reasons = worst.lvl > 0 ? reasonsOf(worst, 2) : [];
    var text;
    if (worst.lvl === 0) text = partial ? 'Eldeki verilere göre belirgin hava riski görünmüyor.' : 'Belirgin hava riski görünmüyor.';
    else if (wi === 0) text = cap(joinReasons(reasons)) + '.';
    else text = cap(partOf(hr(h.time[s + wi]))) + ' ' + joinReasons(reasons) + ' bekleniyor.';   // "Akşam kuvvetli rüzgâr hamleleri bekleniyor."
    var res = {
      ok: true, level: worst.lvl, label: DL[worst.lvl], maxPts: worst.max, sum: worst.sum, reasons: reasons, text: text, line: DL[worst.lvl] + ' · ' + text,
      partial: partial, missing: { vis: !win.every(function (x) { return x.knownVis; }), gust: !win.every(function (x) { return x.knownGust; }), rain: !win.every(function (x) { return x.knownRain; }) },
      start: s, worstIdx: s + wi, hours: hours.map(function (x) { return { i: x.i, time: h.time[x.i], lvl: x.lvl, sum: x.sum, max: x.max, reasons: reasonsOf(x, 2), known: x.known }; })
    };
    res.change = driveChange(res, hours, h, isStale(o), win.length);
    return res;
  }
  // Tek bir saatin sürüş durumu (detay ekranında saat seçilince)
  function driveAtHour(h, i, elev) {
    if (!h || !h.time || i < 0 || i >= h.time.length) return null;
    var x = driveHour(h, i, num(elev)), rs = x.lvl > 0 ? reasonsOf(x, 2) : [];
    return { i: i, level: x.lvl, label: DL[x.lvl], reasons: rs, known: x.known, partial: x.partial, sig: x.sig, sum: x.sum,
      text: x.lvl > 0 ? cap(joinReasons(rs)) + '.' : x.partial ? 'Eldeki verilere göre belirgin hava riski görünmüyor.' : 'Belirgin hava riski görünmüyor.' };
  }
  // Önümüzdeki saatlerde değişim: kötüleşme (daha yüksek düzey) ya da düzelme (en az 2 saat daha düşük düzey)
  function driveChange(res, hours, h, stale, winLen) {
    var base = res.level, k, j, dom = res.reasons.length ? res.reasons[0].k : null;
    function when(i) { return stale ? null : pad(hr(h.time[i])) + ':00'; }
    function lead(i) { var w = when(i); return w ? w + ' sonrası' : partLead(hr(h.time[i])); }
    for (k = winLen; k < hours.length; k++) {
      if (hours[k].known && hours[k].lvl > base) {
        var rs = reasonsOf(hours[k], 1);
        return { dir: 'worse', i: hours[k].i, lvl: hours[k].lvl, text: lead(hours[k].i) + ' sürüş koşulları kötüleşebilir.', cause: rs.length ? rs[0].text : '' };
      }
    }
    if (base > 0) {
      for (k = 1; k < hours.length; k++) {
        if (!hours[k].known || hours[k].lvl >= base) continue;
        var ok = true; for (j = k; j < Math.min(k + 2, hours.length); j++) if (hours[j].lvl >= base) ok = false;
        if (!ok) continue;
        return { dir: 'better', i: hours[k].i, lvl: hours[k].lvl, text: lead(hours[k].i) + ' ' + (IMPROVE[dom] || 'koşullar düzeliyor.'), cause: dom || '' };
      }
    }
    return { dir: 'none', i: -1, lvl: base, text: base === 0 ? 'Önümüzdeki saatlerde belirgin bir değişiklik görünmüyor.' : 'Önümüzdeki saatlerde bu koşullar sürebilir.', cause: '' };
  }

  // =====================================================================================================
  //  YAŞAM ÖNERİLERİ
  // =====================================================================================================
  var LEVEL = I.LEVEL;
  var OK_TXT = {   // düzey 0 (uygun) metinleri: her biri koşul sağlandığında doğrudur; sırayla döner
    coffee: { great: ['Dışarıda kahve için uygun', 'Keyifli bir hava', 'Dışarıda oturmak için güzel'], plain: ['Dışarıda kahve için uygun', 'Dışarıda oturulabilir'] },
    walk: { great: ['Yürüyüş için hava güzel', 'Yürümek için güzel bir hava', 'Kısa bir yürüyüş iyi gelir'], plain: ['Yürümek için uygun', 'Yürüyüş için elverişli'] },
    bike: { great: ['Rüzgâr ve sıcaklık uygun', 'Bisiklet için rahat hava'], plain: ['Bisiklet için uygun'] },
    run: { great: ['Koşu için rahat hava', 'Koşmak için uygun bir gün'], plain: ['Koşu için uygun'] },
    picnic: { great: ['Piknik havası', 'Piknik için güzel bir gün'], plain: ['Piknik için uygun'] },
    dog: { great: ['Köpek gezdirmek için rahat hava', 'Patili dostunla yürüyüşe uygun'], plain: ['Köpek gezdirmek için uygun'] },
    sport: { great: ['Açık hava sporu için uygun', 'Dışarıda antrenman için elverişli'], plain: ['Açık hava sporu için uygun'] },
    vent: { great: ['Evi havalandırmak için uygun', 'Pencereyi açıp havalandırabilirsin'], plain: ['Evi havalandırmak için uygun'] }
  };
  // ideal hissedilen aralığı (uyum puanı: 1 → ideal aralık içinde, uzaklaştıkça düşer) ve küçük tercih payı
  var IDEAL = { coffee: [16, 27, 0.15], walk: [12, 24, 0.15], bike: [14, 25, 0.05], run: [8, 19, 0.05], picnic: [20, 28, 0], dog: [8, 22, -0.05], sport: [10, 22, -0.05], vent: [12, 27, 0] };
  var FAMILY = { walk: 'stroll', dog: 'stroll', run: 'sport', sport: 'sport', bike: 'cycle', coffee: 'coffee', picnic: 'picnic', vent: 'vent', sun: 'sun' };
  var FUN = { coffee: 1, picnic: 1, sun: 1 };

  function fitOf(id, x) {
    var d = IDEAL[id]; if (!d) return 0.5;
    var f = x.feels, dist = f < d[0] ? d[0] - f : f > d[1] ? f - d[1] : 0, fit = Math.max(0, 1 - dist / 10);
    if (x.wind > 18) fit -= Math.min(0.3, (x.wind - 18) / 40);
    return Math.max(0, fit) + d[2];
  }

  // Bir saat için etkinlik girdisi: [k, k+span) penceresi (varsayılan 3 saat) — Insights.activities ile aynı anlam
  function hourX(o, k, span) {
    var h = o.h, n = Math.min(span || 3, h.time.length - k), j, F = [], W = [], G = [], P = [], V = [], SL = [], HL = [], wet = false, snow = false, storm = false, ice = false;
    for (j = k; j < k + n; j++) {
      F.push(at(h.apparent_temperature, j)); W.push(at(h.wind_speed_10m, j)); G.push(at(h.wind_gusts_10m, j)); P.push(at(h.precipitation_probability, j)); V.push(at(h.visibility, j));
      var cd = at(h.weather_code, j), mm = at(h.precipitation, j), dh = driveHour(h, j, num(o.elev));
      if (cd !== null) { if (I.codeWet(cd)) wet = true; if (I.codeSnow(cd)) snow = true; if (I.codeStorm(cd)) { storm = true; wet = true; } }
      if (mm !== null && mm >= CFG.life.wetNowMm) wet = true;
      if (dh.sig.snow > 0) snow = true;
      if (dh.sig.ice > 0) ice = true;
      var rk = M.risksAt(h, j); if (rk.storm.known) SL.push(rk.storm.level); if (rk.hail.known) HL.push(rk.hail.level);
    }
    var aq = o.aq, aqi = null;   // yakın saatlerde anlık değer; sonrası için yalnızca saatlik tahmin varsa (yoksa bilinmiyor, uydurma yok)
    if (aq) {
      if (k - o.start <= 1) aqi = num(aq.value);
      else if (aq.hourly && aq.hourly.time) { var ai = aq.hourly.time.indexOf(h.time[k]); aqi = ai >= 0 ? at(aq.hourly.eaqi, ai) : null; }
    }
    var cur = k === o.start ? o.cur : null;
    var temp = at(h.temperature_2m, k), feels = avgOf(F);
    return {
      feels: feels !== null ? feels : (cur ? cur.apparent_temperature : 15), temp: temp !== null ? temp : (cur ? cur.temperature_2m : null),
      wind: maxOf(W) !== null ? maxOf(W) : 0, gust: maxOf(G), p: maxOf(P) !== null ? maxOf(P) : 0, vis: minOf(V),
      wet: wet, snow: snow, storm: storm, ice: ice, isDay: at(h.is_day, k) === 1, uv: at(h.uv_index, k) || 0, aqi: aqi,
      stormLvl: maxOf(SL) || 0, hailLvl: maxOf(HL) || 0, rh: at(h.relative_humidity_2m, k), cloud: at(h.cloud_cover, k), hour: hr(h.time[k]), k: k
    };
  }

  // Ek etkinlikler (temel beşlisi Insights.rateAll değerlendirir)
  function extraRates(x) {
    var P = I.parts, out = [], extra = [P.visPart(x), P.riskPart(x)];
    var dogHeat = x.feels > 30 ? [2, 'Çok sıcak; sabah/akşam gezdirin'] : x.feels > 25 ? [1, 'Sıcak; asfalt ısınabilir'] : x.feels < -6 ? [2, 'Çok soğuk'] : x.feels < 2 ? [1, 'Hava soğuk'] : [0, ''];
    out.push({ id: 'dog', name: 'Köpek gezdirme', icon: 'dog', parts: [dogHeat, P.rainPart(x, 40, 70), P.windPart(x, 35, 50), P.aqPart(x, 60, 80), x.ice ? [1, 'Buzlanma riski'] : [0, '']].concat(extra) });
    out.push({ id: 'sport', name: 'Açık hava sporu', icon: 'dumbbell', parts: [P.tband(x.feels, 2, 8, 24, 30), P.rainPart(x, 30, 55), P.windPart(x, 35, 50), P.aqPart(x, 40, 60), x.ice ? [1, 'Buzlanma riski'] : [0, ''], !x.isDay ? [1, 'Hava karanlık'] : [0, '']].concat(extra) });
    return out.map(function (d) { var w = P.worst(d.parts); return { id: d.id, name: d.name, icon: d.icon, lvl: w[0], label: LEVEL[w[0]], why: w[1], aq: false }; });
  }
  // Evi havalandırma (dış sıcaklık, nem, hava kalitesi, polen, yağış, rüzgâr). Tıbbi iddia yok.
  function ventRate(x, aq) {
    var L = CFG.life, P = I.parts, aqL = x.aqi === null || x.aqi === undefined ? null : E.level(x.aqi), why = '', lvl = 0, byAq = false, pol = 0;
    if (aq && aq.pollen) aq.pollen.forEach(function (p) { if (p.val > pol) pol = p.val; });
    function up(l, w, fromAq) { if (l > lvl || (l === lvl && !why)) { lvl = l; why = w; byAq = !!fromAq; } }
    if (aqL !== null && aqL >= 3) up(2, 'Hava kalitesi nedeniyle pencereyi uzun süre açık tutmayın', true);
    else if (aqL === 2) up(1, 'Hava kalitesi orta; kısa süreli havalandırın', true);
    if (pol >= L.pollenHigh) up(1, 'Polen yoğun olabilir; kısa havalandırın', true);
    var rp = P.rainPart({ storm: x.storm, wet: x.wet, snow: x.snow, p: x.p }, 40, 70);
    if (rp[0]) up(rp[0], rp[1] + '; pencereleri kapalı tutun');
    var wp = P.windPart({ wind: x.wind, gust: x.gust }, 35, 50); if (wp[0]) up(wp[0], wp[1] === 'Rüzgâr var' ? 'Rüzgâr var; pencereleri sabitleyin' : 'Rüzgâr güçlü; pencereleri kapalı tutun');
    if (x.temp !== null && x.temp <= L.ventCold) up(1, 'Dışarısı soğuk; 5–10 dakika yeter');
    if (x.temp !== null && x.temp >= L.ventHot) up(1, 'Sıcak saatlerde kapalı tutun; sabah/akşam havalandırın');
    if (x.rh !== null && x.rh >= L.ventHumid) up(1, 'Dışarısı çok nemli; nem içeri girebilir');
    return { id: 'vent', name: 'Evi havalandır', icon: 'window', lvl: lvl, label: LEVEL[lvl], why: why, aq: byAq };
  }

  // Gün batımı / golden hour (Paket 4'teki gün batımı verisi). Kesin astronomik dakika yoksa yaklaşık dil.
  function sunTile(o, mode) {
    var L = CFG.life, dl = o.dl, h = o.h, s = o.start;
    if (!dl || !dl.sunset || !dl.sunset[0] || !o.cur) return null;
    var nowM = mins(o.cur.time), setM = mins(dl.sunset[0]), left = setM - nowM;
    if (left <= 0 || left > L.goldenLookH * 60 + L.goldenMin) return null;
    var goldM = setM - L.goldenMin, inGold = nowM >= goldM, si = h.time.indexOf(dl.sunset[0].slice(0, 13) + ':00'), sx = si >= 0 ? hourX(o, si, 1) : null;
    var rain = sx ? I.parts.rainPart({ storm: sx.storm, wet: sx.wet, snow: sx.snow, p: sx.p }, 40, 70) : [0, ''];
    var cloud = sx ? sx.cloud : null, vis = sx ? sx.vis : null, lvl = 0, why = '';
    if (rain[0]) { lvl = 2; why = rain[1]; }
    else if (!o.stale && cloud !== null && cloud > L.photoCloudOk) { lvl = 1; why = 'Gökyüzü kapalı; belirgin altın ışık beklenmez'; }
    else if (!o.stale && cloud !== null && cloud > L.sunsetCloudOk && inGold) { lvl = 1; why = 'Bulutlu; renkli gün batımı beklenmez'; }
    else if (!o.stale && vis !== null && vis < L.sunsetVisOk) { lvl = 1; why = 'Görüş azalmış; ufuk net olmayabilir'; }
    var gm = Math.round(goldM / L.goldenRound) * L.goldenRound;
    if (inGold) return { id: 'sun', name: 'Gün batımı izleme', icon: 'sunset', lvl: lvl, label: LEVEL[lvl], why: lvl ? why : 'Gün batımı ' + hhmm(setM) + ' civarı; ışık güzel', special: 'sunset', prio: true, mode: mode };
    return { id: 'sun', name: 'Fotoğraf / golden hour', icon: 'camera', lvl: lvl, label: LEVEL[lvl], why: lvl ? why : 'Golden hour yaklaşık ' + hhmm(gm) + ' civarında başlıyor', special: 'photo', prio: goldM - nowM <= L.goldenPrioMin, mode: mode };
  }

  // Uygun saat aralığı: belirli bir etkinliğin ardışık düzey-0 saatleri (en uzun; eşitse en erken)
  function bestWindow(o, id) {
    var L = CFG.life, h = o.h, best = null, run = null, k, end = Math.min(o.start + L.searchH, h.time.length - 1);
    for (k = o.start + 1; k <= end; k++) {
      var hrN = hr(h.time[k]), okh = hrN >= L.dayHours[0] && hrN <= L.dayHours[1];
      var x = okh ? hourX(o, k) : null, r = x ? rateById(o, x, id) : null;
      if (r && r.lvl === 0) { if (!run) run = { a: k, b: k }; else run.b = k; }
      else { if (run && (!best || run.b - run.a > best.b - best.a)) best = run; run = null; }
    }
    if (run && (!best || run.b - run.a > best.b - best.a)) best = run;
    if (best && best.b - best.a + 1 >= L.minRun) return best;
    return null;
  }
  function rateById(o, x, id) {
    if (id === 'dog' || id === 'sport') return extraRates(x).filter(function (r) { return r.id === id; })[0];
    if (id === 'vent') return ventRate(x, o.aq);
    return I.rateAll(x).filter(function (r) { return r.id === id; })[0];
  }
  function rangeText(o, w) {
    var h = o.h;
    if (o.stale) return partOf(hr(h.time[w.a]));
    var a = hr(h.time[w.a]), b = hr(h.time[w.b]) + 1;
    return w.b - w.a + 1 > 4 ? pad(a) + ':00 sonrası' : pad(a) + ':00–' + pad(b) + ':00';
  }

  // Tek zaman satırı. Öncelik: yağmurdan önce fırsat > rüzgâr zayıflıyor > en uygun saat > UV. Güvenlik/sürüş riski varken yok.
  function timingLine(o, mode, nowRates, mem) {
    var L = CFG.life, h = o.h, s = o.start, k, j;
    if (mode === 'danger' || mode === 'risk') return '';
    var hourNow = hr(h.time[s]), dayNow = hourNow >= L.dayHours[0] && hourNow <= L.dayHours[1];
    var x0 = hourX(o, s), walkNow = nowRates.walk;
    // 1) Yağmurdan önce kısa fırsat (kesin saat içerdiği için bayat veride yok)
    if (!o.stale && dayNow && !x0.wet) {
      var rs = -1;
      for (k = s + 1; k <= Math.min(s + L.rainBeforeMax + 1, h.time.length - 1); k++) {
        var cd = at(h.weather_code, k), mm = at(h.precipitation, k), pp = at(h.precipitation_probability, k);
        if ((cd !== null && (I.codeWet(cd) || I.codeStorm(cd))) || (mm !== null && mm >= L.rainStartMm) || (pp !== null && pp >= L.rainStartProb)) { rs = k; break; }
      }
      if (rs > s) {
        var n = 0; for (j = s; j < rs; j++) { var r1 = I.rateAll(hourX(o, j, 1)).filter(function (r) { return r.id === 'walk'; })[0]; if (r1.lvl === 0) n++; else break; }
        if (n >= 1) return n === 1 ? variant(mem, 'tl:rb1', ['Yağmur başlamadan önce kısa bir yürüyüş için uygun.', 'Yağmurdan önce kısa bir açık hava molası için fırsat var.'], o.now)
          : variant(mem, 'tl:rb2', ['Yağmurdan önce 1–2 saatlik açık hava fırsatı var.', 'Yağmur başlamadan önce birkaç saatlik açık hava fırsatı var.'], o.now);
      }
    }
    // 2) Rüzgâr zayıflıyor
    if (x0.wind >= L.calm.from && !x0.wet) {
      for (k = s + 1; k + L.calm.run - 1 <= Math.min(s + L.searchH, h.time.length - 1); k++) {
        var calm = true; for (j = k; j < k + L.calm.run; j++) { var w = at(h.wind_speed_10m, j), c2 = at(h.weather_code, j); if (w === null || w > L.calm.to || (c2 !== null && (I.codeWet(c2) || I.codeStorm(c2)))) { calm = false; break; } }
        if (calm) return 'Rüzgâr ' + partWord(hr(h.time[k])) + ' zayıflıyor; dışarı çıkmak için daha uygun.';
      }
    }
    // 3) UV yüksekse ve yürüyüşü kısıtlayan şey UV'ysa (ya da kısıt yoksa) önce UV bilgisi
    var uvMax = null, uvIdx = -1;
    for (k = s; k <= Math.min(s + 4, h.time.length - 1); k++) { var uvv = at(h.uv_index, k); if (uvv !== null && (uvMax === null || uvv > uvMax)) { uvMax = uvv; uvIdx = k; } }
    var uvOn = dayNow && x0.isDay && !x0.wet && !x0.storm && uvMax !== null && uvMax >= L.uvLine;
    if (uvOn && (!walkNow || walkNow.lvl === 0 || /UV/.test(walkNow.why))) return cap(partOf(hr(h.time[uvIdx]))) + ' UV ' + (uvMax >= L.uvStrong ? 'çok yüksek.' : 'yüksek.');
    // 4) Şimdi pek uygun değil → en uygun saat
    if (walkNow && walkNow.lvl >= 1) {
      var bw = bestWindow(o, 'walk');
      if (bw) return o.stale ? 'Yürüyüş için ' + partOf(hr(h.time[bw.a])) + ' daha uygun olabilir.' : variant(mem, 'tl:best', ['Yürüyüş için en uygun zaman ' + rangeText(o, bw) + '.', 'Dışarı çıkmak için en uygun zaman ' + rangeText(o, bw) + '.'], o.now);
    }
    if (uvOn) return cap(partOf(hr(h.time[uvIdx]))) + ' UV ' + (uvMax >= L.uvStrong ? 'çok yüksek.' : 'yüksek.');
    return '';
  }

  // Ana giriş: o = { h, dl, cur (current), start, aq, stale, elev, now (ms), mem }
  function life(o) {
    o = Object.assign({}, o, { stale: isStale(o) });
    var L = CFG.life, h = o.h, s = o.start, mem = o.mem || null;
    memSession(mem, o.now || 0);
    var dv = drive(o), x0 = hourX(o, s);
    var mode = 'ok';
    if (dv) mode = dv.level === 2 ? (dv.maxPts >= CFG.drive.riskMax ? 'danger' : 'risk') : dv.level === 1 ? 'caution' : 'ok';
    var extremeNow = x0.feels <= L.extremeFeels[0] || x0.feels >= L.extremeFeels[1];
    if (extremeNow) mode = 'danger';

    // 1) Etkinlik değerlendirmesi (şimdi)
    var rates = I.rateAll(x0).concat(extraRates(x0)), vent = ventRate(x0, o.aq), byId = {};
    var sun = sunTile(o, mode);
    rates.push(vent); if (sun) rates.push(sun);
    rates.forEach(function (r) { byId[r.id] = r; });

    // 2) Mod: güvenlik > sürüş > sağlık > yağış/rüzgâr > yaşam tarzı
    var homeWhy = extremeNow ? (x0.feels >= L.extremeFeels[1] ? 'Aşırı sıcak; mümkünse içeride kal' : 'Aşırı soğuk; mümkünse içeride kal')
      : dv && dv.reasons.length ? cap(dv.reasons[0].text) : 'Dışarısı pek elverişli değil';
    var home = { id: 'home', name: 'Evde kal', icon: 'home', lvl: 0, label: 'Önerilir', why: x0.storm ? 'Fırtına var' : homeWhy, home: true };
    var tiles, cand;

    // adaylar: aileye göre tekilleştir, uyum + sıralama
    function score(r) {
      var fit = FAMILY[r.id] && IDEAL[r.id] ? fitOf(r.id, x0) : 0.6;
      if (r.id === 'sun') fit = r.prio ? 1.3 : 0.7;
      if (r.id === 'vent') {
        var inAiring = L.ventHours.some(function (w) { return x0.hour >= w[0] && x0.hour <= w[1]; });
        fit = r.aq ? 1.2 : fitOf('vent', x0) - 0.2 + (inAiring ? L.ventBoost : 0);
      }
      var pen = 0; if (mem && mem.prev && mem.prev.ids && mem.prev.ids.indexOf(r.id) >= 0 && r.lvl === 0 && !r.aq && r.id !== 'sun') pen = L.recentPenalty;
      return { fit: fit, rank: r.lvl * 10 - fit + pen };
    }
    cand = rates.filter(function (r) {
      if (r.id === 'vent' && r.lvl === 0 && (x0.hour < 7 || x0.hour > 21 || fitOf('vent', x0) < 0.6)) return false;   // geceleri / elverişsizken "havalandır" demek gürültü
      if (r.id === 'vent' && r.lvl >= 1 && !r.aq) return false;                                                      // yalnızca hava kalitesi/polen uyarısı gösterilir
      return true;
    }).map(function (r) { var sc = score(r); r.fit = sc.fit; r.rank = sc.rank; return r; });
    var seen = {};
    cand.sort(function (a, b) { return a.rank - b.rank; });
    cand = cand.filter(function (r) { var f = FAMILY[r.id] || r.id; if (seen[f]) return false; seen[f] = 1; return true; });

    var best = cand.length ? cand[0].lvl : 2;
    if (mode === 'danger') tiles = [home];
    else if (mode === 'risk') {
      // Sürüş riskli: eğlence önerileri kalkar; kalanlar temkinli
      var safe = cand.filter(function (r) { return !FUN[r.id] && r.id !== 'bike' && r.id !== 'run' && r.id !== 'sport'; }).slice(0, 1).map(function (r) {
        return Object.assign({}, r, { lvl: Math.max(1, r.lvl), label: LEVEL[Math.max(1, r.lvl)], why: r.lvl >= 1 ? r.why : 'Kısa ve dikkatli ol' });
      });
      tiles = [home].concat(safe);
    } else if (best >= 2) tiles = [home].concat(cand.slice(0, 3));
    else if (best === 1) tiles = cand.slice(0, 3).concat([home]);
    else {
      tiles = cand.filter(function (r) { return r.lvl === 0; }).slice(0, L.tiles);
      // havalandırma: alışılmış saatlerde (ve geçen oturumda gösterilmediyse) uygunsa mutlaka bir yer bulur — her sabah aynı kutucuk olmasın diye dönüşümlü
      var ventC = cand.filter(function (r) { return r.id === 'vent' && r.lvl === 0; })[0];
      var ventAiring = L.ventHours.some(function (w) { return x0.hour >= w[0] && x0.hour <= w[1]; }), ventShownBefore = mem && mem.prev && mem.prev.ids && mem.prev.ids.indexOf('vent') >= 0;
      if (ventC && ventAiring && !ventShownBefore && tiles.indexOf(ventC) < 0) { if (tiles.length >= L.tiles) tiles.pop(); tiles.push(ventC); }
      // uygun öneri azsa (ör. yüksek UV'de yürüyüş/kahve 'idare eder') ızgara boş kalmasın: en iyi 'idare eder' olanlarla tamamlanır
      cand.forEach(function (r) { if (tiles.length < L.tiles && r.lvl === 1 && !r.aq && tiles.indexOf(r) < 0) tiles.push(r); });
    }
    if (mode === 'caution') tiles = tiles.filter(function (r) { return !(FUN[r.id] && r.lvl === 0 && r.id === 'picnic'); });   // sürüş "Dikkat" iken piknik önerilmez
    // sağlık uyarısı (hava kalitesi / polen) her modda (güvenlik "Evde kal" dışında) görünür
    var healthAlert = mode === 'danger' ? null : cand.filter(function (r) { return r.aq && r.lvl >= 1; })[0];
    if (healthAlert && tiles.indexOf(healthAlert) < 0) {
      if (tiles.length >= L.tiles) { for (var q = tiles.length - 1; q >= 0; q--) if (!tiles[q].home) { tiles.splice(q, 1); break; } }
      tiles.push(healthAlert);
    }

    // 3) Metin: düzey 0 → varyasyonlu olumlu metin; düzey ≥1 → daha uygun saat (varsa)
    var greatOk = mode === 'ok';
    tiles = tiles.map(function (r) {
      if (r.home) return r;
      var t = Object.assign({}, r), txt = OK_TXT[r.id];
      if (t.lvl === 0 && txt && !t.special) {
        var pool = greatOk && r.fit >= L.fitGreat ? txt.great : txt.plain;
        t.why = variant(mem, 'tx:' + r.id + ':' + (pool === txt.great ? 'g' : 'p'), pool, o.now);
      } else if (t.lvl >= 1 && !t.aq && !t.special && (r.id === 'walk' || r.id === 'bike' || r.id === 'run' || r.id === 'dog' || r.id === 'sport' || r.id === 'coffee') && mode !== 'danger' && mode !== 'risk') {
        var bw = bestWindow(o, r.id);
        if (bw) t.why = t.why + ' · ' + (o.stale ? partOf(hr(h.time[bw.a])) + ' daha uygun' : rangeText(o, bw) + ' daha uygun');
      }
      return t;
    });
    var nowRates = {}; rates.forEach(function (r) { nowRates[r.id] = r; });
    var timing = timingLine(o, mode, nowRates, mem);

    if (mem) { mem.cur = { ids: tiles.filter(function (t) { return !t.home; }).map(function (t) { return t.id; }), t: o.now || 0 }; memPrune(mem, o.now || 0); }
    return { mode: mode, tiles: tiles.map(function (t) { return { id: t.id, name: t.name, icon: t.icon, lvl: t.lvl, label: t.label, why: t.why, home: !!t.home }; }), timing: timing, drive: dv };
  }

  // =====================================================================================================
  //  GİYİM / UV  (hero çipleri için)
  // =====================================================================================================
  // o: { feels, wind, gust, eveMin (akşama kadar en düşük hissedilen | null), hour, isDay, wetSoon }
  function clothing(o) {
    var C = CFG.clothing, f = o.feels;
    if (num(f) === null) return null;
    if (f <= C.cold) return { key: 'cold', text: 'Hava çok soğuk, kalın giyin', short: 'Kalın giyin' };
    if (f <= C.cool) return { key: 'coat', text: 'Serin, mont giymeni öneririm', short: 'Mont giy' };
    if (f >= C.hot) return null;
    var eve = num(o.eveMin);
    if (o.hour < C.lateHour && eve !== null && f > C.mild && eve <= C.eveningCold) return { key: 'eveCoat', text: 'Akşam hava serinleyecek, yanına mont al', short: 'Akşam için mont' };
    if (o.hour < C.lateHour && eve !== null && f > C.mild && f - eve >= C.eveningDrop && eve <= C.eveningWarm) return { key: 'eveLayer', text: 'Akşam serinleyecek, yanına bir üstlük al', short: 'Akşam için üstlük' };
    var windy = (num(o.wind) !== null && o.wind >= C.windy) || (num(o.gust) !== null && o.gust >= C.windy * 1.5);
    if (windy && f < C.windyMaxFeels) return { key: 'windy', text: 'Rüzgâr nedeniyle hafif bir ceket iyi olabilir', short: 'Hafif ceket' };
    if (f <= C.mild) return { key: 'layer', text: 'İnce bir üstlük yeterli', short: 'Üstlük yeterli' };
    return null;
  }
  // UV çipi: şu an ya da yakın saatlerde gerçekten yüksekse (gün boyu en yüksek değer akşam saatinde yanıltır)
  function uvNeed(o) {
    var m = Math.max(num(o.uvNow) || 0, num(o.uvSoon) || 0);
    return !!o.isDay && m >= CFG.life.uvLine;
  }

  var API = {
    CFG: CFG, DRIVE_LABEL: DL, drive: drive, driveHour: driveHour, driveAtHour: driveAtHour, life: life, clothing: clothing, uvNeed: uvNeed,
    variant: variant, memNew: memNew, partOf: partOf, hourX: hourX
  };
  g.ADVICE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
