/* Saatlik meteoroloji yorumu: basınç trendi, fırtına riski, dolu riski, Beaufort, kısa özet. Saf fonksiyonlar (DOM/ağ yok).
   Uygulama (hourly.js) ve bildirim Worker'ı (worker/src/rules.js) AYNI dosyayı kullanır; eşikler yalnızca aşağıdaki CFG içindedir.
   Girdi: Open-Meteo saatlik dizileri (h.pressure_msl, h.cape, h.lifted_index, ...). Eksik değer (null/undefined/NaN) 0 sayılmaz:
   o sinyal hesaba katılmaz ve güven seviyesi düşer. Çıktılar olasılık/risk dilidir; kesinlik iddiası yoktur. */
'use strict';
(function (g) {
  // ---------- Tüm eşikler burada ----------
  var CFG = {
    // Basınç eğilimi (hPa). Hız = 3 saatlik değişim (6 saatlik değişim /2 ile karşılaştırılır; büyük olan alınır).
    pressure: { strong3h: 3.5, mild3h: 1.0 },
    // Beaufort 1..12 alt sınırları (km/sa; 1: 1–5, 2: 6–11, 3: 12–19, 4: 20–28, 5: 29–38, 6: 39–49, 7: 50–61, 8: 62–74, 9: 75–88, 10: 89–102, 11: 103–117, 12: ≥118)
    beaufort: [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118],
    // Görüş (m)
    visibility: { good: 10000, fair: 4000, low: 1000 },
    // Her sinyal 0..1 güç üretir; risk = ağırlıklı toplam / tüm ağırlıkların toplamı (eksik sinyal skoru DÜŞÜRÜR).
    // lin: [alt, üst] arası doğrusal güç. cin: |CIN| arttıkça kararsızlık katkısı azalır (çarpan).
    cin: { from: 100, to: 300, minFactor: 0.5 },
    levels: { mid: 0.30, high: 0.55 },            // 0 Düşük · 1 Orta · 2 Yüksek
    strongSignal: 0.5,                             // "güçlü sinyal" sayılma sınırı
    minStrongForHigh: 3,                           // Yüksek için en az bu kadar güçlü sinyal
    minKnownShare: 0.2,                            // mevcut sinyal ağırlığı bunun altındaysa (veya CAPE/Kaldırma indeksi yoksa) sonuç "Veri yok"
    confidence: { high: 0.8, mid: 0.55 },          // mevcut sinyal ağırlığı payı → güven
    hail: {
      w: { cape: 3, li: 2, frz: 1, code: 4, precip: 1.5, gust: 1, dp3: 0.5 },
      cape: [500, 2500], li: [1, 6] /* -LI */, frz: [4500, 2500] /* düşük donma seviyesi = güçlü */,
      code: { 95: 0.6, 96: 1, 99: 1 }, precip: [2, 8], gust: [40, 80], dp3: [1.5, 4] /* -dP3 */
    },
    storm: {
      w: { cape: 3, li: 1.5, code: 4, precip: 1.5, gust: 2, dp3: 1 },
      cape: [500, 2500], li: [1, 6], code: { 95: 0.8, 96: 1, 99: 1 }, precip: [2, 10], gust: [40, 90], dp3: [1.5, 4]
    },
    thunderCodes: [95, 96, 99]
  };

  // ---------- Yardımcılar ----------
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function at(arr, i) { return arr && i >= 0 && i < arr.length ? num(arr[i]) : null; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function lin(v, lo, hi) { return v === null ? null : clamp01((v - lo) / (hi - lo)); }
  function r(v) { var x = Math.round(v); return x === 0 ? 0 : x; }

  // ---------- Basınç eğilimi ----------
  var P_LABEL = { 'rise-strong': 'Belirgin yükseliyor', rise: 'Hafif yükseliyor', steady: 'Stabil', fall: 'Hafif düşüyor', 'fall-strong': 'Belirgin düşüyor' };
  function delta(series, i, k) { var a = at(series, i), b = at(series, i - k); return a === null || b === null ? null : a - b; }
  function pressureClass(rate) {
    var P = CFG.pressure;
    return rate === null ? null : rate >= P.strong3h ? 'rise-strong' : rate >= P.mild3h ? 'rise' : rate <= -P.strong3h ? 'fall-strong' : rate <= -P.mild3h ? 'fall' : 'steady';
  }
  function pressureTrend(series, i) {
    var d3 = delta(series, i, 3), d6 = delta(series, i, 6), d12 = delta(series, i, 12), rate = null;
    var cand = []; if (d3 !== null) cand.push(d3); if (d6 !== null) cand.push(d6 / 2);
    if (cand.length) rate = cand.reduce(function (a, b) { return Math.abs(b) > Math.abs(a) ? b : a; });
    else if (d12 !== null) rate = d12 / 4;
    var cls = pressureClass(rate), out = { ok: cls !== null, d3: d3, d6: d6, d12: d12, rate: rate, cls: cls, label: cls ? P_LABEL[cls] : '', sentence: '' };
    if (!out.ok) { out.sentence = 'Basınç geçmişi yeterli değil.'; return out; }
    var k = d6 !== null ? 6 : d3 !== null ? 3 : 12, d = k === 6 ? d6 : k === 3 ? d3 : d12, a = Math.abs(d);
    out.sentence = a < 1 ? 'Son ' + k + ' saatte basınç yaklaşık sabit kaldı.' : 'Son ' + k + ' saatte basınç ' + r(a) + ' hPa ' + (d < 0 ? 'düştü.' : 'yükseldi.');
    return out;
  }

  // ---------- Rüzgâr ----------
  var BF_LABEL = ['Sakin', 'Çok hafif', 'Hafif', 'Yumuşak', 'Orta', 'Taze', 'Kuvvetli', 'Çok kuvvetli', 'Fırtınamsı', 'Fırtına', 'Şiddetli fırtına', 'Çok şiddetli fırtına', 'Kasırga'];
  function beaufort(kmh) {
    if (num(kmh) === null) return null;
    var n = 0, B = CFG.beaufort; while (n < B.length && kmh >= B[n]) n++;
    return { n: n, label: BF_LABEL[n] };
  }
  var DIR = ['Kuzey', 'Kuzeydoğu', 'Doğu', 'Güneydoğu', 'Güney', 'Güneybatı', 'Batı', 'Kuzeybatı'];
  var DIR_S = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
  function dir(deg) { if (num(deg) === null) return null; var k = Math.round((((deg % 360) + 360) % 360) / 45) % 8; return { long: DIR[k], short: DIR_S[k] }; }

  // ---------- Görüş / donma seviyesi ----------
  function visibilityText(m) {
    var V = CFG.visibility; if (num(m) === null) return '';
    return m >= V.good ? 'Görüş iyi.' : m >= V.fair ? 'Görüş orta.' : m >= V.low ? 'Görüş azalmış.' : 'Görüş çok düşük (sis olabilir).';
  }
  function fmtInt(n) { return String(r(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function freezingText(m) { return num(m) === null ? '' : 'Donma seviyesi ' + fmtInt(m) + ' m.'; }

  // ---------- Risk (dolu / fırtına): tek ortak hesaplayıcı ----------
  function inputs(h, i) {
    return {
      cape: at(h.cape, i), li: at(h.lifted_index, i), cin: at(h.convective_inhibition, i), frz: at(h.freezing_level_height, i),
      code: at(h.weather_code, i), precip: at(h.precipitation, i), gust: at(h.wind_gusts_10m, i), dp3: delta(h.pressure_msl, i, 3)
    };
  }
  var REASON = {
    cape: 'Atmosfer kararsız.', li: 'Atmosfer kararsız.', code: 'Gök gürültülü fırtına tahmin ediliyor.', codeHail: 'Tahmin dolu ihtimali içeriyor.',
    precip: 'Yoğun yağış bekleniyor.', gust: 'Rüzgâr hamleleri güçleniyor.', dp3: 'Basınç hızla düşüyor.', frz: 'Donma seviyesi düşük.',
    cin: 'Üst katman engelleyici; tetiklenmesi zor.'
  };
  function strengths(S, x, cinFactor) {
    var s = {};
    s.cape = x.cape === null ? null : lin(x.cape, S.cape[0], S.cape[1]) * cinFactor;
    s.li = x.li === null ? null : lin(-x.li, S.li[0], S.li[1]) * cinFactor;
    if (S.frz) s.frz = x.frz === null ? null : lin(x.frz, S.frz[0], S.frz[1]);
    s.code = x.code === null ? null : (S.code[x.code] || 0);
    s.precip = x.precip === null ? null : lin(x.precip, S.precip[0], S.precip[1]);
    s.gust = x.gust === null ? null : lin(x.gust, S.gust[0], S.gust[1]);
    s.dp3 = x.dp3 === null ? null : lin(-x.dp3, S.dp3[0], S.dp3[1]);
    return s;
  }
  function assess(S, x, kind) {
    var cinFactor = 1;
    if (x.cin !== null) { var a = Math.abs(x.cin); cinFactor = 1 - (1 - CFG.cin.minFactor) * lin(a, CFG.cin.from, CFG.cin.to); }   // CIN işareti modele göre değişebilir: büyüklük kullanılır
    var st = strengths(S, x, cinFactor), keys = Object.keys(S.w), total = 0, have = 0, sum = 0, strong = 0, parts = [], k;
    for (var j = 0; j < keys.length; j++) {
      k = keys[j]; total += S.w[k];
      if (st[k] === null || st[k] === undefined) continue;
      have += S.w[k]; sum += S.w[k] * st[k]; if (st[k] >= CFG.strongSignal) strong++;
      parts.push({ k: k, c: S.w[k] * st[k] });
    }
    var score = sum / total, share = have / total, thunder = x.code !== null && CFG.thunderCodes.indexOf(x.code) >= 0;
    // Tahmin kodu tek başına anlamlıdır: fırtına riskinde gök gürültüsü kodu, dolu riskinde "dolulu fırtına" kodu en az Orta yapar
    var codeFloor = (kind === 'storm' && thunder) || (kind === 'hail' && (x.code === 96 || x.code === 99));
    // Kararsızlık verisi (CAPE veya Kaldırma indeksi) yoksa yalnızca kod/yağış/rüzgârla "Düşük" demek yanıltıcı olur: o durumda Veri yok
    var convective = x.cape !== null || x.li !== null;
    var known = (share >= CFG.minKnownShare && convective) || codeFloor, level = 0;
    if (known) {
      level = score >= CFG.levels.high ? 2 : score >= CFG.levels.mid ? 1 : 0;
      if (level === 2) {   // Yüksek için: yeterli sayıda güçlü sinyal + tetikleyici (fırtına kodu; fırtına riskinde güçlü CAPE+hamle de olur)
        var trig = thunder || (kind === 'storm' && st.cape !== null && st.cape >= CFG.strongSignal && st.gust !== null && st.gust >= CFG.strongSignal);
        if (!trig || strong < CFG.minStrongForHigh) level = 1;
      }
      if (share < CFG.confidence.mid && level > 1) level = 1;   // veri çok eksikse Yüksek verilmez
      if (codeFloor && level < 1) level = 1;
    }
    parts.sort(function (p, q) { return q.c - p.c; });
    var reasons = [], seen = {};
    parts.forEach(function (p) {
      if (p.c <= 0 || (st[p.k] < 0.35)) return;
      var t = p.k === 'code' && kind === 'hail' && (x.code === 96 || x.code === 99) ? REASON.codeHail : REASON[p.k];
      if (t && !seen[t]) { seen[t] = 1; reasons.push(t); }
    });
    if (level > 0 && cinFactor < 0.8 && !seen[REASON.cin]) reasons.push(REASON.cin);
    return {
      level: level, label: known ? ['Düşük', 'Orta', 'Yüksek'][level] : 'Veri yok', known: known, score: score,
      instability: (st.cape !== null && st.cape >= CFG.strongSignal) || (st.li !== null && st.li >= CFG.strongSignal),
      confidence: share >= CFG.confidence.high ? 'Yüksek' : share >= CFG.confidence.mid ? 'Orta' : 'Düşük', confidenceShare: share, strong: strong, reasons: reasons.slice(0, 2)
    };
  }
  function hailRisk(x) { return assess(CFG.hail, x, 'hail'); }
  function stormRisk(x) { return assess(CFG.storm, x, 'storm'); }
  function risksAt(h, i) { var x = inputs(h, i); return { hail: hailRisk(x), storm: stormRisk(x) }; }

  // ---------- Seçilen saat için kısa özet (kural tabanlı, en çok 2 cümle) ----------
  function hourSummary(h, i) {
    var out = [], rk = risksAt(h, i), pt = pressureTrend(h.pressure_msl, i), w = at(h.wind_speed_10m, i), w3 = at(h.wind_speed_10m, i - 3);
    var gust = at(h.wind_gusts_10m, i), prob = at(h.precipitation_probability, i), vis = at(h.visibility, i);
    if (rk.storm.known && rk.storm.level >= 1) out.push(rk.storm.level === 2 ? 'Atmosfer kararsız, fırtına riski yüksek.' : 'Atmosfer kararsız, fırtına riski artmış.');
    if (rk.hail.known && rk.hail.level >= 1) out.push('Dolu riski ' + (rk.hail.level === 2 ? 'yüksek' : 'orta') + '.');
    if (pt.ok && (pt.cls === 'fall-strong' || pt.cls === 'fall')) out.push(pt.cls === 'fall-strong' ? 'Basınç belirgin düşüyor.' : 'Basınç son saatlerde düşüyor.');
    if (w !== null && w3 !== null && w - w3 >= 10) out.push('Rüzgâr güçleniyor.');
    else if (gust !== null && gust >= 50) out.push('Rüzgâr hamleleri güçlü.');
    if (vis !== null && vis < CFG.visibility.fair) out.push('Görüş azalmış.');
    if (prob !== null) { if (prob >= 60) out.push('Yağış ihtimali yüksek.'); else if (prob < 20) out.push('Yağış ihtimali düşük.'); }
    if (rk.hail.known && rk.hail.level === 0 && out.length < 2) out.push('Dolu riski düşük.');
    return out.slice(0, 2).join(' ') || 'Hava sakin görünüyor.';
  }

  var API = {
    CFG: CFG, num: num, at: at, pressureTrend: pressureTrend, pressureClass: pressureClass, beaufort: beaufort, dir: dir,
    visibilityText: visibilityText, freezingText: freezingText, inputs: inputs, hailRisk: hailRisk, stormRisk: stormRisk, risksAt: risksAt, hourSummary: hourSummary
  };
  g.METEO = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
