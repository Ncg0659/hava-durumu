/* EYRIVO astronomi (0.8, Yıldız Gözlem) — SAF YEREL HESAP: Güneş/Ay konumu, alacakaranlık, Ay evresi/aydınlanma, Ay doğuş-batış.
   DOM, ağ ve depolama yok; tarayıcısız test edilebilir (module.exports). Harici astronomi API'si KULLANILMAZ (anahtar/lisans/ağ gerekmez, çevrimdışı çalışır).
   Yöntem: Paul Schlyter "How to compute planetary positions" düşük duyarlıklı Güneş ve Ay elemanları (Ay için başlıca düzeltme terimleriyle) +
   Meeus "Astronomical Algorithms" Böl. 48 (aydınlanan kesir). Beklenen duyarlık: Güneş ~1', Ay ~2' (doğuş/batış ve alacakaranlık için birkaç dakika).
   Bu bir gözlemevi hesabı değildir; günlük kullanım içindir. Zaman: UTC milisaniye (Date.now()). Enlem kuzey +, boylam doğu +. */
'use strict';
(function (g) {
  var RAD = Math.PI / 180, DEG = 180 / Math.PI;
  function rev(x) { x = x % 360; return x < 0 ? x + 360 : x; }
  function sin(d) { return Math.sin(d * RAD); }
  function cos(d) { return Math.cos(d * RAD); }
  function dayNum(ms) { return ms / 86400000 + 2440587.5 - 2451543.5; }   // Schlyter günü (2000 Ocak 0.0'dan)
  function obliq(d) { return 23.4393 - 3.563e-7 * d; }
  function kepler(Mdeg, e) {
    var E = Mdeg + e * DEG * sin(Mdeg) * (1 + e * cos(Mdeg)), k;
    for (k = 0; k < 6; k++) { var dE = (E - e * DEG * sin(E) - Mdeg) / (1 - e * cos(E)); E -= dE; if (Math.abs(dE) < 1e-7) break; }
    return E;
  }
  function toEq(lon, lat, r, ecl) {   // ekliptik (derece) → ekvatoral {ra, dec derece, r}
    var xg = r * cos(lon) * cos(lat), yg = r * sin(lon) * cos(lat), zg = r * sin(lat);
    var ye = yg * cos(ecl) - zg * sin(ecl), ze = yg * sin(ecl) + zg * cos(ecl);
    return { ra: rev(Math.atan2(ye, xg) * DEG), dec: Math.atan2(ze, Math.sqrt(xg * xg + ye * ye)) * DEG };
  }
  function lst(ms, lonE) { return rev(280.46061837 + 360.98564736629 * (ms / 86400000 + 2440587.5 - 2451545.0) + lonE); }
  function altOf(eq, ms, lat, lon) {
    var H = lst(ms, lon) - eq.ra;
    var s = sin(lat) * sin(eq.dec) + cos(lat) * cos(eq.dec) * cos(H);
    return Math.asin(Math.max(-1, Math.min(1, s))) * DEG;
  }

  // ---- Güneş ----
  function sunEcl(ms) {
    var d = dayNum(ms), w = 282.9404 + 4.70935e-5 * d, e = 0.016709 - 1.151e-9 * d, M = rev(356.0470 + 0.9856002585 * d);
    var E = kepler(M, e), xv = cos(E) - e, yv = Math.sqrt(1 - e * e) * sin(E);
    return { lon: rev(Math.atan2(yv, xv) * DEG + w), r: Math.sqrt(xv * xv + yv * yv), d: d };
  }
  function sunAlt(ms, lat, lon) {   // geometrik yükseklik (kırılma yok; eşikler buna göre seçilir)
    var s = sunEcl(ms), eq = toEq(s.lon, 0, s.r, obliq(s.d));
    return altOf(eq, ms, lat, lon);
  }

  // ---- Ay ----
  function moonRaw(ms) {
    var d = dayNum(ms);
    var N = rev(125.1228 - 0.0529538083 * d), inc = 5.1454, w = rev(318.0634 + 0.1643573223 * d), a = 60.2666, e = 0.0549, M = rev(115.3654 + 13.0649929509 * d);
    var E = kepler(M, e), xv = a * (cos(E) - e), yv = a * Math.sqrt(1 - e * e) * sin(E), v = Math.atan2(yv, xv) * DEG, r = Math.sqrt(xv * xv + yv * yv);
    var xh = r * (cos(N) * cos(v + w) - sin(N) * sin(v + w) * cos(inc)), yh = r * (sin(N) * cos(v + w) + cos(N) * sin(v + w) * cos(inc)), zh = r * sin(v + w) * sin(inc);
    var lon = rev(Math.atan2(yh, xh) * DEG), lat = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)) * DEG; r = Math.sqrt(xh * xh + yh * yh + zh * zh);
    var Ms = rev(356.0470 + 0.9856002585 * d), ws = 282.9404 + 4.70935e-5 * d, Ls = Ms + ws, Lm = M + w + N, D = rev(Lm - Ls), F = rev(Lm - N);
    lon += -1.274 * sin(M - 2 * D) + 0.658 * sin(2 * D) - 0.186 * sin(Ms) - 0.059 * sin(2 * M - 2 * D) - 0.057 * sin(M - 2 * D + Ms) + 0.053 * sin(M + 2 * D) +
      0.046 * sin(2 * D - Ms) + 0.041 * sin(M - Ms) - 0.035 * sin(D) - 0.031 * sin(M + Ms) - 0.015 * sin(2 * F - 2 * D) + 0.011 * sin(M - 4 * D);
    lat += -0.173 * sin(F - 2 * D) - 0.055 * sin(M - F - 2 * D) - 0.046 * sin(M + F - 2 * D) + 0.033 * sin(F + 2 * D) + 0.017 * sin(2 * M + F);
    r += -0.58 * cos(M - 2 * D) - 0.46 * cos(2 * D);
    return { lon: rev(lon), lat: lat, r: r, d: d };
  }
  // Ay: {alt (topocentrik, derece), illum (0–1), elong (0–360, Ay−Güneş boylamı), waxing}
  function moon(ms, lat, lon) {
    var m = moonRaw(ms), s = sunEcl(ms), ecl = obliq(m.d), eq = toEq(m.lon, m.lat, m.r, ecl);
    var geo = altOf(eq, ms, lat, lon), par = Math.asin(1 / m.r) * DEG, alt = geo - par * cos(geo);
    var el = rev(m.lon - s.lon), cpsi = cos(m.lat) * cos(m.lon - s.lon), psi = Math.acos(Math.max(-1, Math.min(1, cpsi))) * DEG;
    var dist = m.r * 6371.0, R = s.r * 149597870.7;
    var inc = Math.atan2(R * sin(psi), dist - R * cpsi) * DEG;   // faz açısı (Meeus 48.3)
    return { alt: alt, illum: (1 + cos(inc)) / 2, elong: el, waxing: el < 180 };
  }
  function phaseName(m) {
    var k = m.illum;
    if (k >= 0.97) return 'Dolunay';
    if (k <= 0.03) return 'Yeni Ay';
    var q = Math.round(m.elong / 45) % 8;   // 0 yeni … 4 dolunay
    return ['Yeni Ay', 'Büyüyen hilal', 'İlk dördün', 'Büyüyen şişkin Ay', 'Dolunay', 'Küçülen şişkin Ay', 'Son dördün', 'Küçülen hilal'][q];
  }

  // ---- Eşik geçişleri ----
  // fn(ms) değeri eşiği ne zaman geçiyor? [t0,t1] aralığında {t, dir:'up'|'down'} listesi (adım stepMs, ikili aramayla incelenir)
  function crossings(fn, t0, t1, thr, stepMs) {
    var out = [], t = t0, prev = fn(t0) - thr, cur, tn;
    while (t < t1) {
      tn = Math.min(t + stepMs, t1); cur = fn(tn) - thr;
      if ((prev < 0) !== (cur < 0) && prev !== cur) {
        var lo = t, hi = tn, flo = prev;
        for (var k = 0; k < 22; k++) { var mid = (lo + hi) / 2, fm = fn(mid) - thr; if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid; }
        out.push({ t: Math.round((lo + hi) / 2), dir: cur > prev ? 'up' : 'down' });
      }
      prev = cur; t = tn;
    }
    return out;
  }
  var LEVELS = [['astronomical', -18], ['nautical', -12], ['civil', -6]];
  // Verilen ana göre "gözlem gecesi": now'dan sonra biten ilk karanlık aralık. Takvim gününe değil Güneş'e bağlıdır
  // (01:00'de hâlâ o gecenin kalanı; öğlen bakınca gelecek gece). Dönüş: {start, end, level, thr, inNow} ya da null (uç enlem: yeterince karanlık olmuyor).
  function night(nowMs, lat, lon) {
    var f = function (t) { return sunAlt(t, lat, lon); }, i, t0 = nowMs - 20 * 3600000, t1 = nowMs + 30 * 3600000;
    for (i = 0; i < LEVELS.length; i++) {
      var thr = LEVELS[i][1], cr = crossings(f, t0, t1, thr, 600000), s = null, k;
      for (k = 0; k < cr.length; k++) {
        if (cr[k].dir === 'down') s = cr[k].t;
        else if (cr[k].dir === 'up' && s !== null && cr[k].t > nowMs) return { start: s, end: cr[k].t, level: LEVELS[i][0], thr: thr };
      }
      if (cr.length && cr[0].dir === 'up' && cr[0].t > nowMs) {   // aralık t0'dan önce başlamış (çok uzun gece)
        return { start: t0, end: cr[0].t, level: LEVELS[i][0], thr: thr };
      }
    }
    return null;
  }
  // Ay doğuş/batış (topocentrik merkez yüksekliği −0,833° ≈ üst kenar + kırılma). [t0,t1] içindeki olaylar + başlangıçta ufuk üstünde mi?
  function moonEvents(t0, t1, lat, lon) {
    var f = function (t) { return moon(t, lat, lon).alt; };
    return { upAtStart: f(t0) > -0.833, upAtEnd: f(t1) > -0.833, events: crossings(f, t0, t1, -0.833, 600000).map(function (c) { return { t: c.t, type: c.dir === 'up' ? 'rise' : 'set' }; }) };
  }
  // Güneş doğuş/batış (−0,833°)
  function sunEvents(t0, t1, lat, lon) {
    return crossings(function (t) { return sunAlt(t, lat, lon); }, t0, t1, -0.833, 600000).map(function (c) { return { t: c.t, type: c.dir === 'up' ? 'rise' : 'set' }; });
  }

  var API = { sunAlt: sunAlt, moon: moon, phaseName: phaseName, night: night, moonEvents: moonEvents, sunEvents: sunEvents, crossings: crossings, LEVELS: LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  g.ASTRO = API;
})(typeof window !== 'undefined' ? window : globalThis);
