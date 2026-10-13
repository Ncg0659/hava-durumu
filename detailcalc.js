/* Detay ekranları için saf hesaplar (DOM/ağ yok): dünle karşılaştırma, 24 saatlik yağış toplamı, kural tabanlı kısa yorumlar,
   güneş konumu (ilk/son ışık, gün yolu) ve tarihsel veriden mevsim ortalaması. Uygulama (detail.js) kullanır; Node testleri doğrudan içe aktarır.
   İlkeler: eksik değer (null/NaN/undefined) 0 sayılmaz → o cümle/karşılaştırma hiç üretilmez; kesinlik iddiası yok; harici servis yok. */
'use strict';
(function (g) {
  var M = g.METEO || (typeof require !== 'undefined' ? require('./meteo.js') : null);
  var num = M.num, at = M.at;

  // ---------- Tüm eşikler burada ----------
  var CFG = {
    sameTemp: 1,            // °C: bu kadar farkın altı "aynı"
    sameWind: 4,            // km/sa
    sameUv: 1,              // indeks
    samePress: 1,           // hPa
    sameRain: 0.2,          // mm
    feelsGap: 1.5,          // °C: hissedilen ile gerçek sıcaklık arasındaki anlamlı fark
    humidHigh: 70, humidVeryHigh: 80, humidDry: 30,
    dewClose: 2,            // °C: sıcaklık − çiy noktası bunun altındaysa "yaklaşıyor"
    dewMuggy: 20,           // °C: çiy noktası bunun üstündeyse bunaltıcı olabilir
    fogVis: 5000, fogHum: 90, fogGap: 1.5,
    calmWind: 12,           // km/sa: tüm pencerede bunun altı "hafif"
    windChange: 8,          // km/sa: güçlenme/zayıflama için anlamlı fark
    gustNote: 50,           // km/sa: hamle notu
    dirTurn: 90,            // °: yön değişimi notu
    rainNone: 0.1,          // mm (24 saat toplamı)
    rainProbLow: 20, rainProbNote: 30,
    pressSteady: 1,
    pressureFcst: 3,        // hPa: 24 saatlik tahmini değişim notu
    precipFull: 24,         // toplam için gereken saat sayısı
    solarTolMin: 6,         // dk: hesaplanan gün doğumu/batımı API ile bu kadar uyuşmazsa ilk/son ışık gösterilmez
    clim: { years: 10, minYearsShare: 0.8, halfWin: 7, minWinShare: 0.7, minMonthDays: 0.9, minMonthYears: 5, sameDelta: 1.5 }
  };

  var MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function rd(v) { var x = Math.round(v); return x === 0 ? 0 : x; }
  function fmt1(v) { return (Math.round(v * 10) / 10).toLocaleString('tr-TR', { maximumFractionDigits: 1 }); }
  function hh(t) { return +t.slice(11, 13); }
  function hmOf(t) { return t.slice(11, 16); }

  // ---------- Gün bölümü / zaman ifadesi ----------
  function dayPart(hour) { return hour >= 5 && hour < 11 ? 'sabah' : hour < 14 && hour >= 11 ? 'öğle' : hour >= 14 && hour < 18 ? 'öğleden sonra' : hour >= 18 && hour < 22 ? 'akşam' : 'gece'; }
  // when(time, refDate): aynı takvim günü → "Öğleden sonra"; sonraki gün → "Yarın sabah"
  function when(time, refDate) {
    var p = dayPart(hh(time)), nextDay = refDate && time.slice(0, 10) > refDate;
    return nextDay ? 'Yarın ' + p : p.charAt(0).toLocaleUpperCase('tr-TR') + p.slice(1);
  }
  function whenLower(time, refDate) { var s = when(time, refDate); return s.charAt(0).toLocaleLowerCase('tr-TR') + s.slice(1); }

  // ---------- Dünkü aynı saat ----------
  // Yerel saat dizgesiyle (YYYY-MM-DDTHH:MM) k gün öncesinin aynı saati; saat dilimi/yaz saati dönüşümü yok. Yoksa -1.
  function sameHourAgo(time, i, k) {
    var t = time && time[i]; if (!t) return -1;
    var dt = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10) - (k || 1)));
    return time.indexOf(dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()) + t.slice(10, 16));
  }
  function vsYesterday(h, key, i) {
    var j = sameHourAgo(h.time, i, 1); if (j < 0) return null;
    var a = at(h[key], i), b = at(h[key], j);
    return a === null || b === null ? null : { now: a, prev: b, delta: a - b, prevIdx: j };
  }
  // Cümle: eşik altı → "yaklaşık aynı"
  function cmpText(kind, d) {
    if (!d) return '';
    var x = d.delta, a = Math.abs(x);
    if (kind === 'temp') return a < CFG.sameTemp ? 'Dünkü aynı saatle yaklaşık aynı sıcaklık.' : 'Dünkü aynı saate göre ' + rd(a) + '°C daha ' + (x > 0 ? 'sıcak.' : 'soğuk.');
    if (kind === 'feels') return a < CFG.sameTemp ? 'Hissedilen sıcaklık dünkü aynı saatle yaklaşık aynı.' : 'Hissedilen sıcaklık dünkü aynı saate göre ' + rd(a) + '°C daha ' + (x > 0 ? 'yüksek.' : 'düşük.');
    if (kind === 'wind') return a < CFG.sameWind ? 'Rüzgâr dünkü aynı saatle benzer.' : 'Rüzgâr dünkü aynı saate göre ' + rd(a) + ' km/sa daha ' + (x > 0 ? 'güçlü.' : 'zayıf.');
    if (kind === 'uv') return a < CFG.sameUv ? 'UV dünkü aynı saatle benzer.' : 'UV dünkü aynı saate göre daha ' + (x > 0 ? 'yüksek.' : 'düşük.');
    if (kind === 'press') return a < CFG.samePress ? 'Basınç dünkü aynı saatle yaklaşık aynı.' : 'Basınç dünkü aynı saate göre ' + rd(a) + ' hPa daha ' + (x > 0 ? 'yüksek.' : 'düşük.');
    if (kind === 'rain') {
      if (d.now < CFG.sameRain && d.prev < CFG.sameRain) return '';   // ikisi de yağışsız: söylenecek bir şey yok
      return a < CFG.sameRain ? 'Yağış miktarı dünkü aynı saatle benzer.' : 'Dünkü aynı saatten ' + (x > 0 ? 'daha fazla' : 'daha az') + ' yağış var.';
    }
    return '';
  }

  // ---------- Yağış toplamları ----------
  // Open-Meteo saatlik yağışı "önceki saatin toplamı"dır. Son 24 saat = (start−23 … start), gelecek 24 saat = (start+1 … start+24).
  // Bir saat bile eksikse (veya geçmiş satırlar önbellekte yoksa) toplam üretilmez: eksik veri 0 sayılmaz.
  function sumRange(arr, a, b) {
    if (a < 0 || !arr || b >= arr.length) return null;
    var s = 0; for (var i = a; i <= b; i++) { var v = at(arr, i); if (v === null) return null; s += v; }
    return s;
  }
  function precipTotals(h, start) {
    var n = CFG.precipFull;
    return {
      past: sumRange(h.precipitation, start - (n - 1), start),
      next: sumRange(h.precipitation, start + 1, start + n),
      nextRain: sumRange(h.rain, start + 1, start + n),
      nextSnow: sumRange(h.snowfall, start + 1, start + n),   // cm
      pastSnow: sumRange(h.snowfall, start - (n - 1), start)
    };
  }

  // ---------- Ortak ----------
  function extreme(arr, a, b, wantMax) {
    var best = null;
    for (var i = a; i <= b; i++) { var v = at(arr, i); if (v === null) continue; if (best === null || (wantMax ? v > best.v : v < best.v)) best = { i: i, v: v }; }
    return best;
  }
  function anyIn(arr, a, b) { for (var i = a; i <= b; i++) if (at(arr, i) !== null) return true; return false; }
  function angDiff(x, y) { return Math.abs(((x - y + 540) % 360) - 180); }

  // ---------- Kural tabanlı kısa yorumlar (pencere: a..b, a = şimdi) ----------
  function tempSummary(h, a, b) {
    var hi = extreme(h.temperature_2m, a, b, true), lo = extreme(h.temperature_2m, a, b, false), ref = h.time[a].slice(0, 10), out = [];
    if (!hi || !lo) return '';
    if (hi.v - lo.v < 2) return 'Sıcaklık önümüzdeki 24 saatte pek değişmeyecek.';
    if (hi.i > a && hi.i < b) out.push(when(h.time[hi.i], ref) + ' sıcaklık en yüksek seviyeye çıkacak.');
    else if (hi.i === a) out.push('Sıcaklık şu an en yüksek seviyede, sonra düşecek.');
    else out.push('Sıcaklık önümüzdeki saatlerde yükselecek.');
    if (hi.v - lo.v >= 4 && lo.i > a && lo.i < b) out.push(when(h.time[lo.i], ref) + ' en düşük seviyeye inecek.');
    return out.join(' ');
  }
  // Hissedilen sıcaklık açıklaması: yalnızca eldeki sinyallere dayanır; neden bilinmiyorsa neden uydurmaz
  function feelsSummary(t, f, rh, wind) {
    if (num(t) === null || num(f) === null) return '';
    var d = f - t, a = Math.abs(d), why = [];
    if (a < CFG.feelsGap) return 'Hissedilen sıcaklık gerçek sıcaklığa yakın.';
    if (d > 0) {   // daha sıcak hissediliyor
      if (num(rh) !== null && rh >= 60 && t >= 20) why.push('nem');
      if (num(wind) !== null && wind <= 10 && t >= 20) why.push('düşük rüzgâr');
      if (why.length) return (why.length === 2 ? 'Nem ve düşük rüzgâr' : why[0] === 'nem' ? 'Yüksek nem' : 'Düşük rüzgâr') + ' nedeniyle daha sıcak hissediliyor.';
      return 'Hissedilen sıcaklık gerçek sıcaklığın ' + rd(a) + '°C üzerinde.';
    }
    if (num(wind) !== null && wind >= 15 && t <= 16) why.push('rüzgâr');
    if (num(rh) !== null && rh >= 80 && t <= 8) why.push('nem');
    if (why.length) return (why.length === 2 ? 'Rüzgâr ve nem' : why[0] === 'rüzgâr' ? 'Rüzgâr' : 'Nem') + ' nedeniyle daha soğuk hissediliyor.';
    return 'Hissedilen sıcaklık gerçek sıcaklığın ' + rd(a) + '°C altında.';
  }
  function windSummary(h, a, b) {
    var ws = h.wind_speed_10m, mx = extreme(ws, a, b, true), now = at(ws, a), ref = h.time[a].slice(0, 10), out = [], gm = extreme(h.wind_gusts_10m, a, b, true), j;
    if (!mx) return '';
    if (mx.v < CFG.calmWind) out.push('Rüzgâr hafif seyredecek.');
    else if (now !== null && mx.i > a + 1 && mx.v >= now + CFG.windChange) out.push(when(h.time[mx.i], ref) + ' rüzgâr güçlenecek (en çok ' + rd(mx.v) + ' km/sa).');
    else {
      var fall = -1;
      for (j = mx.i + 1; j <= b; j++) { var v = at(ws, j); if (v !== null && v <= mx.v * 0.6 && mx.v - v >= CFG.windChange) { fall = j; break; } }
      out.push(fall >= 0 ? when(h.time[fall], ref) + ' rüzgâr zayıflıyor.' : 'Rüzgâr gün boyunca benzer seviyede.');
    }
    if (gm && gm.v >= CFG.gustNote) out.push('Hamleler ' + whenLower(h.time[gm.i], ref) + ' ' + rd(gm.v) + ' km/sa’ya çıkabilir.');
    else {
      var d0 = at(h.wind_direction_10m, a), d1 = at(h.wind_direction_10m, b);
      if (mx.v >= CFG.calmWind && d0 !== null && d1 !== null && angDiff(d0, d1) >= CFG.dirTurn) out.push('Rüzgâr yönü değişiyor: ' + M.dir(d0).long + ' → ' + M.dir(d1).long + '.');
    }
    return out.slice(0, 2).join(' ');
  }
  // UV: renk sınıfı enjekte edilir (uygulamadaki tek uvClass); r.run = en yüksek sınıfın sürdüğü ardışık saatler
  function uvSummary(h, a, b, classFn, names) {
    var mx = extreme(h.uv_index, a, b, true); if (!mx) return '';
    var K = classFn(mx.v), out = [];
    if (K === 0) return 'UV önümüzdeki 24 saatte düşük kalacak.';
    var i0 = mx.i, i1 = mx.i, v;
    while (i0 - 1 >= a && (v = at(h.uv_index, i0 - 1)) !== null && classFn(v) >= K) i0--;
    while (i1 + 1 <= b && (v = at(h.uv_index, i1 + 1)) !== null && classFn(v) >= K) i1++;
    var name = names[K].toLocaleLowerCase('tr-TR');
    out.push(i0 === i1 ? 'UV ' + hmOf(h.time[i0]) + ' civarında ' + name + '.' : 'UV ' + hmOf(h.time[i0]) + '–' + hmOf(h.time[i1]) + ' arasında ' + name + '.');
    out.push(K >= 3 ? 'Güneş kremi, şapka ve gölge tercih edilebilir.' : K === 2 ? 'Güneş kremi kullanılması önerilir.' : 'Uzun süre dışarıda kalacaksanız güneş kremi önerilir.');
    return out.join(' ');
  }
  function rainSummary(h, a, b, totals) {
    var pr = h.precipitation_probability, mx = extreme(pr, a, b, true), ref = h.time[a].slice(0, 10), out = [], j, snow = totals && totals.nextSnow;
    var maxP = mx ? mx.v : null, nowP = at(pr, a);
    if (totals && totals.next !== null && totals.next < CFG.rainNone && (maxP === null || maxP < CFG.rainProbLow)) return 'Önümüzdeki 24 saatte belirgin yağış beklenmiyor.';
    if (maxP === null) {
      if (totals && totals.next !== null) return totals.next < CFG.rainNone ? 'Önümüzdeki 24 saatte belirgin yağış beklenmiyor.' : 'Önümüzdeki 24 saatte yaklaşık ' + fmt1(totals.next) + ' mm yağış bekleniyor.';
      return '';
    }
    if (maxP >= CFG.rainProbNote) {
      if (nowP !== null && mx.i > a && nowP <= maxP - 20) {
        out.push(when(h.time[mx.i], ref) + ' yağış ihtimali artıyor (%' + rd(maxP) + ').');
        for (j = mx.i + 1; j <= b; j++) { var v = at(pr, j); if (v !== null && v <= maxP * 0.5) { out.push(when(h.time[j], ref) + ' azalıyor.'); break; } }
      } else {
        var fall = -1;
        for (j = mx.i + 1; j <= b; j++) { var w = at(pr, j); if (w !== null && w <= maxP * 0.5) { fall = j; break; } }
        out.push(fall >= 0 ? when(h.time[fall], ref) + ' yağış ihtimali azalıyor.' : 'Yağış ihtimali önümüzdeki 24 saat boyunca sürüyor.');
      }
    } else out.push('Yağış ihtimali düşük (en çok %' + rd(maxP) + ').');
    if (snow !== null && snow !== undefined && snow >= 0.1) out.push('Kar yağışı bekleniyor.');
    return out.slice(0, 2).join(' ');
  }
  function pressSummary(h, i, b) {
    var pt = M.pressureTrend(h.pressure_msl, i), out = [];
    if (!pt.ok) return pt.sentence;
    var k = pt.d6 !== null ? 6 : pt.d3 !== null ? 3 : 12, d = k === 6 ? pt.d6 : k === 3 ? pt.d3 : pt.d12;
    out.push(Math.abs(d) < CFG.pressSteady ? 'Basınç son ' + k + ' saatte stabil.' : 'Basınç son ' + k + ' saatte ' + (d < 0 ? 'düşüyor.' : 'yükseliyor.'));
    var p0 = at(h.pressure_msl, i), p1 = at(h.pressure_msl, b);
    if (p0 !== null && p1 !== null && Math.abs(p1 - p0) >= CFG.pressureFcst) out.push('Önümüzdeki 24 saatte ' + (p1 < p0 ? 'düşmesi' : 'yükselmesi') + ' bekleniyor.');
    return out.join(' ');
  }
  function fogHint(h, i) {
    var v = at(h.visibility, i), rh = at(h.relative_humidity_2m, i), t = at(h.temperature_2m, i), dp = at(h.dew_point_2m, i);
    return v !== null && rh !== null && t !== null && dp !== null && v < CFG.fogVis && rh >= CFG.fogHum && (t - dp) <= CFG.fogGap;
  }
  function visSummary(h, a, b) {
    var V = M.CFG.visibility, now = at(h.visibility, a), ref = h.time[a].slice(0, 10), out = [], j, any = anyIn(h.visibility, a, b);
    if (!any) return '';
    if (now !== null) out.push(M.visibilityText(now));
    var first = -1, decline = '';
    for (j = a + 1; j <= b; j++) { var v = at(h.visibility, j); if (v !== null && v < V.fair && (now === null || now >= V.fair)) { first = j; break; } }
    if (first >= 0) decline = when(h.time[first], ref) + ' saatlerinde görüş azalabilir.';
    else if (now !== null && now >= V.good) { var mn = extreme(h.visibility, a, b, false); if (mn && mn.v >= V.good) decline = 'Gün boyunca görüş iyi kalacak.'; }
    var fog = false; for (j = a; j <= b; j++) if (fogHint(h, j)) { fog = true; break; }
    // Sis ipucu varsa en bilgilendirici iki cümle: (azalma / gün boyu durum) + sis ipucu; yoksa: şimdiki durum + azalma
    if (fog) { if (!decline && out.length) return out[0] + ' Nem yüksek ve çiy noktası sıcaklığa çok yakın; sis oluşumuna uygun koşullar olabilir.'; return (decline ? decline + ' ' : '') + 'Nem yüksek ve çiy noktası sıcaklığa çok yakın; sis oluşumuna uygun koşullar olabilir.'; }
    if (decline) out.push(decline);
    return out.slice(0, 2).join(' ');
  }
  function humSummary(t, rh, dew) {
    var out = [];
    if (num(rh) !== null) {
      if (rh >= CFG.humidVeryHigh) out.push('Nem çok yüksek.');
      else if (rh >= CFG.humidHigh) out.push('Nem yüksek.');
      else if (rh <= CFG.humidDry) out.push('Hava kuru; daha kuru hissedilebilir.');
      else out.push('Nem rahat seviyede.');
    }
    if (num(t) !== null && num(dew) !== null) {
      if (t - dew <= CFG.dewClose) out.push('Çiy noktası sıcaklığa yaklaşıyor.');
      else if (dew >= CFG.dewMuggy && t >= 18) out.push('Çiy noktası yüksek; hava bunaltıcı hissedilebilir.');
    }
    return out.slice(0, 2).join(' ');
  }

  // ---------- Güneş (NOAA algoritması; yalnızca konum, tarih ve UTC farkı gerekir) ----------
  var RAD = Math.PI / 180;
  function solarElevation(utcMs, lat, lon) {
    var jd = utcMs / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
    var L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
    var Mm = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var C = Math.sin(Mm * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mm * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mm * RAD) * 0.000289;
    var om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * RAD);
    var eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * RAD);
    var decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lam * RAD));
    var y = Math.tan(eps * RAD / 2); y *= y;
    var eq = 4 * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(Mm * RAD) + 4 * e * y * Math.sin(Mm * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * Mm * RAD)) / RAD;
    var tm = ((utcMs % 86400000) + 86400000) % 86400000 / 60000, tst = ((tm + eq + 4 * lon) % 1440 + 1440) % 1440, ha = tst / 4 - 180;
    var cz = Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(ha * RAD);
    return 90 - Math.acos(Math.max(-1, Math.min(1, cz))) / RAD;
  }
  // dateStr (YYYY-MM-DD) günü için yerel dakikalar (0..1440) cinsinden olaylar. offSec: yerel saatin UTC farkı (saniye).
  function sunDay(dateStr, lat, lon, offSec) {
    if (num(lat) === null || num(lon) === null || num(offSec) === null) return null;
    var base = Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)) - offSec * 1000;
    var TH = { rise: -0.833, civil: -6 }, ev = { rise: null, set: null, dawn: null, dusk: null }, prev = null, m, e, mx = -91, mxm = 0, curve = [];
    for (m = 0; m <= 1440; m++) {
      e = solarElevation(base + m * 60000, lat, lon);
      if (e > mx) { mx = e; mxm = m; }
      if (m % 10 === 0) curve.push([m, Math.round(e * 100) / 100]);
      if (prev !== null) {
        var cross = function (th) { return (prev - th) * (e - th) < 0 ? m - 1 + (th - prev) / (e - prev) : null; };
        var r = cross(TH.rise), c = cross(TH.civil);
        if (r !== null) { if (e > prev) { if (ev.rise === null) ev.rise = r; } else if (ev.set === null) ev.set = r; }
        if (c !== null) { if (e > prev) { if (ev.dawn === null) ev.dawn = c; } else if (ev.dusk === null) ev.dusk = c; }
      }
      prev = e;
    }
    return { rise: ev.rise, set: ev.set, dawn: ev.dawn, dusk: ev.dusk, noon: mxm, maxElev: mx, curve: curve, len: ev.rise !== null && ev.set !== null ? ev.set - ev.rise : null };
  }
  function hmin(s) { return +s.slice(11, 13) * 60 + +s.slice(14, 16); }
  function fmtMin(m) { if (m === null || m === undefined) return '—'; var x = Math.round(m); x = ((x % 1440) + 1440) % 1440; return pad(Math.floor(x / 60)) + ':' + pad(x % 60); }
  // Open-Meteo gün doğumu/batımıyla karşılaştırılır: uyuşmazsa hesap güvenilmez sayılır, ilk/son ışık ve eğri gösterilmez
  function sunInfo(opts) {
    var d = sunDay(opts.date, opts.lat, opts.lon, opts.offSec), apiRise = opts.sunrise ? hmin(opts.sunrise) : null, apiSet = opts.sunset ? hmin(opts.sunset) : null;
    var out = { rise: apiRise, set: apiSet, len: apiRise !== null && apiSet !== null ? apiSet - apiRise : null, calc: null, trusted: false };
    if (!d || d.rise === null || d.set === null || apiRise === null || apiSet === null) return out;
    if (Math.abs(d.rise - apiRise) > CFG.solarTolMin || Math.abs(d.set - apiSet) > CFG.solarTolMin) return out;
    out.trusted = true; out.calc = d;
    out.dawn = d.dawn; out.dusk = d.dusk; out.noon = d.noon; out.maxElev = d.maxElev;
    // Dün ile gün uzunluğu farkı (aynı yöntemle, yalnızca iki gün de hesaplanabiliyorsa)
    var p = new Date(Date.UTC(+opts.date.slice(0, 4), +opts.date.slice(5, 7) - 1, +opts.date.slice(8, 10) - 1)), ps = p.getUTCFullYear() + '-' + pad(p.getUTCMonth() + 1) + '-' + pad(p.getUTCDate());
    var y = sunDay(ps, opts.lat, opts.lon, opts.offSec);
    if (y && y.len !== null && d.len !== null) out.lenDelta = d.len - y.len;
    return out;
  }
  function elevAt(calc, minute) {
    if (!calc) return null;
    var c = calc.curve, k = Math.min(c.length - 2, Math.max(0, Math.floor(minute / 10))), a = c[k], b = c[k + 1];
    return a[1] + (b[1] - a[1]) * ((minute - a[0]) / (b[0] - a[0]));
  }
  function lenText(m) { return m === null || m === undefined ? '' : Math.floor(m / 60) + ' sa ' + (Math.round(m) % 60) + ' dk'; }
  function sunSummary(info, nowMin) {
    if (!info || info.rise === null || info.set === null) return '';
    var out = [];
    if (nowMin < info.rise) out.push('Güneş ' + fmtMin(info.rise) + ' sularında doğacak.');
    else if (nowMin < info.set) out.push('Güneş ' + fmtMin(info.set) + ' sularında batacak.');
    else out.push('Güneş battı.');
    if (info.lenDelta !== undefined && info.lenDelta !== null) {
      var a = Math.abs(info.lenDelta);
      out.push(a < 0.5 ? 'Gün uzunluğu dünle aynı.' : 'Gün dünden yaklaşık ' + (a < 1.5 ? '1 dk' : rd(a) + ' dk') + ' ' + (info.lenDelta > 0 ? 'uzun.' : 'kısa.'));
    }
    return out.join(' ');
  }

  // ---------- Tarihsel (arşiv) veriden mevsim ortalaması ----------
  var CUM = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];   // artık yıl takvimi: 29 Şubat da bir dilim
  function doy(dateStr) { return CUM[+dateStr.slice(5, 7) - 1] + (+dateStr.slice(8, 10)) - 1; }
  // Open-Meteo archive daily yanıtı → küçük, saklanabilir özet (≈ 4 KB). Yetersiz/eksikse null (bölüm gizlenir).
  function climateFromArchive(json, expectYears) {
    var d = json && json.daily; if (!d || !d.time || !d.temperature_2m_max || !d.temperature_2m_min) return null;
    var n = d.time.length, i, sx = [], sn = [], cx = [], cn = [], k;
    for (k = 0; k < 366; k++) { sx.push(0); sn.push(0); cx.push(0); cn.push(0); }
    var mo = {}, years = {}, mx = [], mn = [], mc = [];
    for (k = 0; k < 12; k++) { mx.push(0); mn.push(0); mc.push(0); }
    for (i = 0; i < n; i++) {
      var t = d.time[i], x = num(d.temperature_2m_max[i]), nn = num(d.temperature_2m_min[i]), p = d.precipitation_sum ? num(d.precipitation_sum[i]) : null, m = +t.slice(5, 7) - 1, y = +t.slice(0, 4), di = doy(t);
      if (x !== null) { sx[di] += x; cx[di]++; mx[m] += x; mc[m]++; years[y] = 1; }
      if (nn !== null) { sn[di] += nn; cn[di]++; mn[m] += nn; }
      var key = y * 12 + m; if (!mo[key]) mo[key] = { m: m, s: 0, c: 0, days: 0 };
      mo[key].days++; if (p !== null) { mo[key].s += p; mo[key].c++; }
    }
    var C = CFG.clim, yrs = Object.keys(years).length;
    if (yrs < Math.max(3, Math.floor(expectYears * C.minYearsShare))) return null;
    var tx = [], tn = [], w;
    for (k = 0; k < 366; k++) {
      var ax = 0, bx = 0, an = 0, bn = 0;
      for (w = -C.halfWin; w <= C.halfWin; w++) { var q = (k + w + 366) % 366; ax += sx[q]; bx += cx[q]; an += sn[q]; bn += cn[q]; }
      var need = (2 * C.halfWin + 1) * yrs * C.minWinShare;
      tx.push(bx >= need ? Math.round(ax / bx * 10) / 10 : null);
      tn.push(bn >= need ? Math.round(an / bn * 10) / 10 : null);
    }
    var mon = [], pm = [];
    for (k = 0; k < 12; k++) pm.push({ s: 0, n: 0 });
    Object.keys(mo).forEach(function (key) { var o = mo[key], full = o.c >= o.days * C.minMonthDays; if (full) { pm[o.m].s += o.s; pm[o.m].n++; } });
    for (k = 0; k < 12; k++) mon.push({ x: mc[k] ? Math.round(mx[k] / mc[k] * 10) / 10 : null, n: mc[k] ? Math.round(mn[k] / mc[k] * 10) / 10 : null, p: pm[k].n >= C.minMonthYears ? Math.round(pm[k].s / pm[k].n * 10) / 10 : null });
    return { v: 1, years: yrs, tx: tx, tn: tn, mon: mon };
  }
  function climateNormal(cl, dateStr) {
    if (!cl || !cl.tx) return null;
    var di = doy(dateStr), x = num(cl.tx[di]), n = num(cl.tn[di]);
    return x === null || n === null ? null : { tmax: x, tmin: n };
  }
  // Bugünün (tahmin) ortalama sıcaklığı − bu dönemin ortalaması
  function climateSentence(todayMax, todayMin, nor, years) {
    if (!nor || num(todayMax) === null || num(todayMin) === null) return '';
    var d = (todayMax + todayMin) / 2 - (nor.tmax + nor.tmin) / 2, a = Math.abs(d), yr = 'son ' + (years || CFG.clim.years) + ' yılın';
    if (a < CFG.clim.sameDelta) return 'Bugün, ' + yr + ' bu dönem ortalamasına yakın.';
    return 'Bugün, ' + yr + ' bu dönem ortalamasından ' + rd(a) + '°C daha ' + (d > 0 ? 'sıcak.' : 'soğuk.');
  }

  var API = {
    CFG: CFG, MON: MON, dayPart: dayPart, when: when, sameHourAgo: sameHourAgo, vsYesterday: vsYesterday, cmpText: cmpText, precipTotals: precipTotals, sumRange: sumRange,
    extreme: extreme, tempSummary: tempSummary, feelsSummary: feelsSummary, windSummary: windSummary, uvSummary: uvSummary, rainSummary: rainSummary,
    pressSummary: pressSummary, visSummary: visSummary, humSummary: humSummary, fogHint: fogHint, solarElevation: solarElevation, sunDay: sunDay, sunInfo: sunInfo,
    elevAt: elevAt, fmtMin: fmtMin, lenText: lenText, sunSummary: sunSummary, climateFromArchive: climateFromArchive, climateNormal: climateNormal, climateSentence: climateSentence, doy: doy
  };
  g.DCALC = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
