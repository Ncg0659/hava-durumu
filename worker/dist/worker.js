// hava-uyari Worker (tek dosya). Kaynak: worker/src/*.js — elle düzenleme, "node worker/build.mjs" ile üretilir.
// Web Push (RFC 8030) + mesaj şifreleme (RFC 8291, aes128gcm) + VAPID (RFC 8292).
// Yalnızca tarayıcı/Workers'ın yerleşik WebCrypto'su kullanılır; üçüncü taraf kod yok.

const enc = new TextEncoder();

function b64uEnc(bytes) {
  let s = ''; const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDec(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let p = 0; a.forEach((x) => { o.set(x, p); p += x.length; }); return o; };

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

// RFC 8291: gövdeyi şifrele. opts.salt / opts.asKeyPair yalnızca test için.
async function encryptPayload(plain, p256dhB64, authB64, opts = {}) {
  const uaPub = b64uDec(p256dhB64), auth = b64uDec(authB64);
  if (uaPub.length !== 65 || uaPub[0] !== 4 || auth.length < 16) throw new Error('geçersiz abonelik anahtarı');
  const as = opts.asKeyPair || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = cat(plain, new Uint8Array([2]));                       // 0x02: son (tek) kayıt
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  const rs = new Uint8Array([0, 0, 0x10, 0]);                         // kayıt boyutu 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

// ---------- VAPID ----------
async function generateVapid() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { pub: b64uEnc(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
}
async function vapidAuth(endpoint, vapid, subject, nowMs) {
  const aud = new URL(endpoint).origin, exp = Math.floor((nowMs || Date.now()) / 1000) + 12 * 3600;
  const head = b64uEnc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64uEnc(enc.encode(JSON.stringify({ aud, exp, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', vapid.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body)));   // ham r||s = JOSE biçimi
  return 'vapid t=' + head + '.' + body + '.' + b64uEnc(sig) + ', k=' + vapid.pub;
}

// İzin verilen push servisleri (kötüye kullanımı / rastgele adrese istek göndermeyi önler)
const HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
function allowedEndpoint(ep) {
  try { const u = new URL(ep); return u.protocol === 'https:' && HOSTS.some((r) => r.test(u.hostname)); } catch (e) { return false; }
}

// Bildirimi gönder. Döner: HTTP durum kodu (201 = kabul edildi, 404/410 = abonelik artık geçersiz)
async function sendPush(sub, payload, vapid, subject, o = {}) {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub.keys.p256dh, sub.keys.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      TTL: String(o.ttl ?? 3600), Urgency: o.urgency || 'normal',
      Authorization: await vapidAuth(sub.endpoint, vapid, subject, o.nowMs)
    },
    body
  });
  return res.status;
}

/* Avrupa Hava Kalitesi İndeksi (EAQI, Open-Meteo `european_aqi`) — TEK tanım.
   Uygulama (insights.js, app.js) ve bildirim Worker'ı (worker/src/rules.js) sınıfı yalnızca buradan alır; başka yerde eşik/etiket tanımlanmaz.
   Sınıf alt sınırları: 0 Çok iyi · 20 İyi · 40 Orta · 60 Kötü · 80 Çok kötü · 100 Aşırı kötü. Karşılaştırma önce yuvarlanmış tam sayıyla yapılır
   (uygulama kartı da yuvarlanmış değeri gösterir; 59,6 her iki yerde de "60 = Kötü" olur). ABD AQI (us_aqi) sınıflandırmada kullanılmaz. */
(function (g) {
  var MIN = [0, 20, 40, 60, 80, 100];
  var LABEL = ['Çok iyi', 'İyi', 'Orta', 'Kötü', 'Çok kötü', 'Aşırı kötü'];
  function round(v) { var x = Math.round(v); return x === 0 ? 0 : x; }
  function level(v) { var n = round(v), k = 0; while (k < 5 && n >= MIN[k + 1]) k++; return k; }
  function lower(s) { return s.charAt(0).toLocaleLowerCase('tr') + s.slice(1); }
  var E = { MIN: MIN, LABEL: LABEL, BAD: 3, round: round, level: level, label: function (v) { return LABEL[level(v)]; }, labelLower: function (v) { return lower(LABEL[level(v)]); } };
  g.EAQI = E;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : globalThis);

/* Saatlik meteoroloji yorumu: basınç trendi, fırtına riski, dolu riski, Beaufort, kısa özet. Saf fonksiyonlar (DOM/ağ yok).
   Uygulama (hourly.js) ve bildirim Worker'ı (worker/src/rules.js) AYNI dosyayı kullanır; eşikler yalnızca aşağıdaki CFG içindedir.
   Girdi: Open-Meteo saatlik dizileri (h.pressure_msl, h.cape, h.lifted_index, ...). Eksik değer (null/undefined/NaN) 0 sayılmaz:
   o sinyal hesaba katılmaz ve güven seviyesi düşer. Çıktılar olasılık/risk dilidir; kesinlik iddiası yoktur. */
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

// Kural motoru: saf fonksiyonlar (ağ yok). Bir şehrin Open-Meteo tahmininden "gerçekten önemli" olayları çıkarır
// ve bir cihaza hangilerinin gönderileceğine karar verir. Eşikler yalnızca burada, T içinde.


const EAQI = globalThis.EAQI;

const METEO = globalThis.METEO;

const T = {
  storm:  { codes: [95, 96, 99], minProb: 40, horizonH: 6, urgentWithinH: 2 },
  precip: { rainHourMm: 8, rain3hMm: 20, showersCode: 82, showersMm: 4, showersProb: 50, snowHourCm: 2, snowCode: [75, 86], snowCodeCm: 1, minProb: 60, horizonH: 6 },
  wind:   { sustainedKmh: 50, gustKmh: 70, horizonH: 12, urgentGustKmh: 90, urgentWithinH: 3 },
  heat:   { tmax: 37, feels: 41, feelsMinT: 33, anomaly: 6, fallbackTmax: 40, horizonH: 18 },
  cold:   { tmin: -7, feels: -15, feelsMaxT: -3, anomaly: 7, fallbackTmin: -15, horizonH: 18 },
  // UV: push yalnızca "aşırı" (≥11). 8–10 ("çok yüksek") uygulama içinde (UV kartı, öneriler) kalır.
  uv:     { extreme: 11, horizonH: 6, fromHour: 8, toHour: 16 },
  // Hava kalitesi: Avrupa Hava Kalitesi İndeksi (EAQI, Open-Meteo `european_aqi`). Sınıf sınırları BURADA TANIMLI DEĞİL:
  // uygulamayla ortak tek tanım ../../eaqi.js (EAQI.level). Push yalnızca "Kötü" ve üstü sınıf (EAQI ≥ 60) için. ABD AQI kullanılmaz.
  aqi:    { horizonH: 6 },
  // Sessiz saatte (23:00–07:00) geçebilen "ciddi" ölçütler; yalnızca bu 4 tür geçer, yalnızca önümüzdeki withinH saat içindeyse.
  night:  { types: ['storm', 'precip', 'wind', 'frost'], withinH: 3, stormCodes: [96, 99], stormProb: 60, rainHourMm: 15, rain3hMm: 35, snowHourCm: 4, gustKmh: 90, freezingProb: 50 },
  frost:  { wetMm: 0.3, wetBackH: 6, tempC: 0, fogC: -1, freezingCodes: [56, 57, 66, 67], freezingProb: 30, fogCode: 48, horizonH: 12 },
  cooldownH: { storm: 6, precip: 6, wind: 6, frost: 12, aqi: 12, heat: 20, cold: 20, uv: 72 },
  priority: ['storm', 'wind', 'precip', 'frost', 'heat', 'cold', 'aqi', 'uv'],
  dailyCap: 5,
  quiet: { from: 23, to: 7 },
  maxPushPerRun: 20
};

const H = 3600000;
const pad = (n) => (n < 10 ? '0' : '') + n;
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const rd = (v) => { const r = Math.round(v); return r === 0 ? 0 : r; };
const sg = (v) => { const r = rd(v); return r < 0 ? '−' + (-r) : String(r); };

// "2026-10-07T15:00" (şehrin yerel saati) → gerçek UTC ms
function hourMs(t, offsetSec) { return Date.parse(t + ':00Z') - (offsetSec || 0) * 1000; }
function localDate(t) { return t.slice(0, 10); }
function localHour(t) { return +t.slice(11, 13); }

// Cihazın saat diliminde tarih + saat
function userParts(nowMs, tz) {
  let f;
  try { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }); }
  catch (e) { f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }); }
  const p = {}; f.formatToParts(new Date(nowMs)).forEach((x) => { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, hour: +p.hour % 24 };
}

// Tahmin dizilerini (tek konum) kullanışlı hâle getir
function prep(fc, nowMs) {
  const h = fc && fc.hourly; if (!h || !h.time || !h.time.length) return null;
  const off = fc.utc_offset_seconds || 0, n = h.time.length, ms = h.time.map((t) => hourMs(t, off));
  let i0 = ms.findIndex((m) => m >= nowMs - 59 * 60000); if (i0 < 0) return null;
  const col = (k) => h[k] || new Array(n).fill(null);
  return {
    n, i0, ms, time: h.time, off,
    t: col('temperature_2m'), feels: col('apparent_temperature'), pr: col('precipitation'), rain: col('rain'), shw: col('showers'),
    snow: col('snowfall'), prob: col('precipitation_probability'), code: col('weather_code'),
    wind: col('wind_speed_10m'), gust: col('wind_gusts_10m'), uv: col('uv_index'),
    nowLocalDate: localDate(new Date(nowMs + off * 1000).toISOString())
  };
}

function range(d, hours) { const a = d.i0, b = Math.min(d.n, d.i0 + hours); const r = []; for (let i = a; i < b; i++) r.push(i); return r; }
function span(d, idx) {
  const a = idx[0], b = idx[idx.length - 1];
  return { a, b, from: d.time[a].slice(11, 16), to: pad((localHour(d.time[b]) + 1) % 24) + ':00', ongoing: a === d.i0 };
}
function when(d, s) { return s.ongoing ? 'Şu andan ' + s.to + ' saatine kadar' : s.from + '–' + s.to + ' arasında'; }
function eid(type, d, i) { return type + ':' + localDate(d.time[i]) + ':' + Math.floor(localHour(d.time[i]) / 6); }
function dayWord(d, i) { const dd = localDate(d.time[i]); return dd === d.nowLocalDate ? 'bugün' : 'yarın'; }
function maxBy(idx, f) { let best = null, bi = -1; idx.forEach((i) => { const v = f(i); if (v !== null && (best === null || v > best)) { best = v; bi = i; } }); return { v: best, i: bi }; }

// ---------- İklim ortalaması (aynı dönem, son 5 yıl) ----------
// arch = { start:'YYYY-MM-DD', max:[...], min:[...] } (günlük). ±7 gün penceresinin ortalaması.
function climateMean(arch, month, day) {
  if (!arch || !arch.max || !arch.start) return null;
  const doy = (m, d) => Math.floor((Date.UTC(2001, m - 1, d) - Date.UTC(2001, 0, 0)) / 86400000);   // artık yıl farkı ±1 gün: önemsiz
  const target = doy(month, day), t0 = Date.parse(arch.start + 'T00:00:00Z');
  let sx = 0, sn = 0, c = 0;
  for (let i = 0; i < arch.max.length; i++) {
    const dt = new Date(t0 + i * 86400000), dd = doy(dt.getUTCMonth() + 1, dt.getUTCDate());
    let diff = Math.abs(dd - target); if (diff > 183) diff = 365 - diff;
    if (diff <= 7 && num(arch.max[i]) !== null && num(arch.min[i]) !== null) { sx += arch.max[i]; sn += arch.min[i]; c++; }
  }
  return c >= 20 ? { max: sx / c, min: sn / c, n: c } : null;
}

// ---------- Tek şehir için olaylar ----------
// getClimate(city) → arch | null  (yalnızca mutlak eşik aşılırsa çağrılır)
async function evaluateCity(city, fc, aq, nowMs, getClimate) {
  const d = prep(fc, nowMs); if (!d) return [];
  const ev = [];
  const name = city.name;

  // 7) Gök gürültülü fırtına
  {
    const idx = range(d, T.storm.horizonH).filter((i) => T.storm.codes.includes(d.code[i]) && (num(d.prob[i]) ?? 100) >= T.storm.minProb);
    if (idx.length) {
      const s = span(d, idx);
      // Dolu: ayrı bildirim YOK. Aynı fırtına penceresinde dolu riski "Yüksek" ise (CAPE/kaldırma indeksi/CIN/donma seviyesi/kod/yağış/hamle/basınç birlikte
      // yeterince güçlü ve güven en az Orta) aynı olay tek birleşik bildirim olur; kimlik/tür aynı kaldığından dedup, cooldown, günlük sınır ve sessiz saat değişmez.
      const hail = METEO && fc.hourly ? idx.some((i) => { const hr = METEO.risksAt(fc.hourly, i).hail; return hr.known && hr.level === 2 && hr.confidence !== 'Düşük'; }) : false;
      ev.push({ type: 'storm', id: eid('storm', d, s.a), urgent: idx.some((i) => i - d.i0 <= T.night.withinH && (T.night.stormCodes.includes(d.code[i]) || (num(d.prob[i]) ?? 0) >= T.night.stormProb)),
        title: (hail ? 'Şiddetli fırtına ve dolu riski · ' : 'Fırtına uyarısı · ') + name,
        body: hail ? when(d, s) + ' fırtına ve yüksek dolu riski bekleniyor. Açık alanlardan uzak durun, aracınızı korunaklı yere alın.' : when(d, s) + ' gök gürültülü fırtına bekleniyor. Açık alanlardan uzak durun.' });
    }
  }
  // 2) Kuvvetli rüzgâr
  {
    const idx = range(d, T.wind.horizonH).filter((i) => (num(d.wind[i]) ?? 0) >= T.wind.sustainedKmh || (num(d.gust[i]) ?? 0) >= T.wind.gustKmh);
    if (idx.length) {
      const s = span(d, idx), g = maxBy(idx, (i) => num(d.gust[i])), w = maxBy(idx, (i) => num(d.wind[i]));
      ev.push({ type: 'wind', id: eid('wind', d, s.a), urgent: idx.some((i) => i - d.i0 <= T.night.withinH && Math.max(num(d.gust[i]) ?? 0, num(d.wind[i]) ?? 0) >= T.night.gustKmh),
        title: 'Kuvvetli rüzgâr · ' + name,
        body: when(d, s) + ' rüzgâr ' + rd(w.v ?? 0) + ' km/sa' + (g.v ? ', hamleler ' + rd(g.v) + ' km/sa' : '') + ' seviyesine çıkabilir. Dışarıdaki eşyaları sabitleyin.' });
    }
  }
  // 1) Kuvvetli yağış (yağmur / kar)
  {
    const r = range(d, T.precip.horizonH), rainAt = (i) => (num(d.rain[i]) ?? 0) + (num(d.shw[i]) ?? 0) || (num(d.snow[i]) ? 0 : (num(d.pr[i]) ?? 0));
    const okR = r.filter((i) => {
      const p = num(d.prob[i]) ?? 0, h1 = rainAt(i);
      const h3 = [i - 2, i - 1, i].reduce((s, k) => s + (k >= 0 ? rainAt(k) : 0), 0);
      return (p >= T.precip.minProb && (h1 >= T.precip.rainHourMm || h3 >= T.precip.rain3hMm)) ||
             (d.code[i] === T.precip.showersCode && p >= T.precip.showersProb && h1 >= T.precip.showersMm);
    });
    const okS = r.filter((i) => ((num(d.prob[i]) ?? 0) >= T.precip.minProb && (num(d.snow[i]) ?? 0) >= T.precip.snowHourCm) ||
      (T.precip.snowCode.includes(d.code[i]) && (num(d.snow[i]) ?? 0) >= T.precip.snowCodeCm));
    if (okR.length) {
      const s = span(d, okR), pk = maxBy(okR, rainAt);
      ev.push({ type: 'precip', id: eid('precip', d, s.a), title: 'Kuvvetli yağış · ' + name,
        urgent: okR.some((i) => i - d.i0 <= T.night.withinH && (rainAt(i) >= T.night.rainHourMm || [i - 2, i - 1, i].reduce((q, k) => q + (k >= 0 ? rainAt(k) : 0), 0) >= T.night.rain3hMm)),
        body: when(d, s) + ' saatte ' + rd(pk.v) + ' mm\'ye varan yoğun yağmur bekleniyor. Su baskınına dikkat edin.' });
    } else if (okS.length) {
      const s = span(d, okS), pk = maxBy(okS, (i) => num(d.snow[i]));
      ev.push({ type: 'precip', id: eid('precip', d, s.a), title: 'Yoğun kar · ' + name,
        urgent: okS.some((i) => i - d.i0 <= T.night.withinH && (num(d.snow[i]) ?? 0) >= T.night.snowHourCm),
        body: when(d, s) + ' saatte ' + (Math.round((pk.v ?? 0) * 10) / 10) + ' cm\'ye varan yoğun kar bekleniyor. Yola çıkacaksanız hazırlıklı olun.' });
    }
  }
  // 6) Don / buzlanma
  {
    const r = range(d, T.frost.horizonH);
    const fz = r.filter((i) => T.frost.freezingCodes.includes(d.code[i]) && (num(d.prob[i]) ?? 0) >= T.frost.freezingProb);
    const wetBefore = (i) => { let s = 0; for (let k = Math.max(0, i - T.frost.wetBackH); k <= i; k++) s += (num(d.rain[k]) ?? 0) + (num(d.shw[k]) ?? 0); return s; };
    const ice = r.filter((i) => num(d.t[i]) !== null && ((d.t[i] <= T.frost.tempC && wetBefore(i) >= T.frost.wetMm) || (d.code[i] === T.frost.fogCode && d.t[i] <= T.frost.fogC)));
    if (fz.length) {
      const s = span(d, fz);
      ev.push({ type: 'frost', id: eid('frost', d, s.a), title: 'Dondurucu yağmur · ' + name,
        urgent: fz.some((i) => i - d.i0 <= T.night.withinH && (num(d.prob[i]) ?? 0) >= T.night.freezingProb),
        body: when(d, s) + ' dondurucu yağmur/çise bekleniyor; yollar buz tutabilir. Mümkünse yola çıkmayın.' });
    } else if (ice.length) {
      const s = span(d, ice), mn = Math.min.apply(null, ice.map((i) => d.t[i]));
      ev.push({ type: 'frost', id: eid('frost', d, s.a), urgent: false, title: 'Buzlanma riski · ' + name,
        body: when(d, s) + ' sıcaklık ' + sg(mn) + '° civarına düşecek; ıslak yüzeyler buz tutabilir. Dikkatli olun.' });
    }
  }
  // 3a) Aşırı sıcak
  {
    const r = range(d, T.heat.horizonH), pk = maxBy(r, (i) => num(d.t[i])), fk = maxBy(r, (i) => num(d.feels[i]));
    const abs = pk.v !== null && (pk.v >= T.heat.tmax || (fk.v !== null && fk.v >= T.heat.feels && pk.v >= T.heat.feelsMinT));
    if (abs) {
      const pd = localDate(d.time[pk.i]), arch = getClimate ? await getClimate(city) : null;
      const cm = climateMean(arch, +pd.slice(5, 7), +pd.slice(8, 10));
      const pass = cm ? pk.v - cm.max >= T.heat.anomaly : pk.v >= T.heat.fallbackTmax;
      if (pass) ev.push({ type: 'heat', id: 'heat:' + pd, urgent: false, title: 'Aşırı sıcak · ' + name,
        body: dayWord(d, pk.i)[0].toUpperCase() + dayWord(d, pk.i).slice(1) + ' sıcaklık ' + sg(pk.v) + '° civarına çıkacak' + (cm ? ' (mevsim normalinin yaklaşık ' + rd(pk.v - cm.max) + '° üstünde)' : '') + '. Öğlen dışarıda uzun kalmayın, bol su için.' });
    }
  }
  // 3b) Aşırı soğuk
  {
    const r = range(d, T.cold.horizonH), mn = maxBy(r, (i) => (num(d.t[i]) === null ? null : -d.t[i])), fk = maxBy(r, (i) => (num(d.feels[i]) === null ? null : -d.feels[i]));
    const tmin = mn.v === null ? null : -mn.v, fmin = fk.v === null ? null : -fk.v;
    const abs = tmin !== null && (tmin <= T.cold.tmin || (fmin !== null && fmin <= T.cold.feels && tmin <= T.cold.feelsMaxT));
    if (abs) {
      const pd = localDate(d.time[mn.i]), arch = getClimate ? await getClimate(city) : null;
      const cm = climateMean(arch, +pd.slice(5, 7), +pd.slice(8, 10));
      const pass = cm ? cm.min - tmin >= T.cold.anomaly : tmin <= T.cold.fallbackTmin;
      if (pass) ev.push({ type: 'cold', id: 'cold:' + pd, urgent: false, title: 'Aşırı soğuk · ' + name,
        body: dayWord(d, mn.i)[0].toUpperCase() + dayWord(d, mn.i).slice(1) + ' sıcaklık ' + sg(tmin) + '° civarına düşecek' + (cm ? ' (mevsim normalinin yaklaşık ' + rd(cm.min - tmin) + '° altında)' : '') + '. Sıkı giyinin.' });
    }
  }
  // 5) Hava kalitesi (EAQI)
  if (aq && aq.hourly && aq.hourly.time && aq.hourly.european_aqi) {
    const off = aq.utc_offset_seconds ?? fc.utc_offset_seconds ?? 0, a = aq.hourly;
    const idx = []; for (let i = 0; i < a.time.length; i++) { const m = hourMs(a.time[i], off); if (m >= nowMs - 59 * 60000 && m < nowMs + T.aqi.horizonH * H && num(a.european_aqi[i]) !== null) idx.push(i); }
    const pk = maxBy(idx, (i) => a.european_aqi[i]);
    if (pk.v !== null && EAQI.level(pk.v) >= EAQI.BAD) {
      const lvl = EAQI.level(pk.v) - EAQI.BAD;   // 0 Kötü · 1 Çok kötü · 2 Aşırı kötü: tepe değere göre sınıf/id (eşik, dedup ve cooldown aynen)
      // Metin bağlama göre: ŞU ANKİ saatlik değer (uygulama kartıyla aynı) zaten Kötü+ ise mevcut durum; değilse yalnızca önümüzdeki saatler için uyarı
      let cur = null, curM = -Infinity; idx.forEach((i) => { const m = hourMs(a.time[i], off); if (m <= nowMs && m > curM) { curM = m; cur = a.european_aqi[i]; } });
      const id = 'aqi:' + localDate(a.time[pk.i]) + ':' + ['bad', 'vbad', 'xbad'][lvl];
      if (cur !== null && EAQI.level(cur) >= EAQI.BAD) {
        const cl = EAQI.level(cur) - EAQI.BAD, word = EAQI.labelLower(cur);
        ev.push({ type: 'aqi', id, urgent: false, title: word[0].toUpperCase() + word.slice(1) + ' hava kalitesi · ' + name,
          body: 'Hava kalitesi ' + word + '. ' + ['Hassassanız uzun süre dışarıda kalmayın.', 'Dışarıda uzun kalmayın.', 'Mümkünse dışarı çıkmayın.'][cl] });   // EAQI değeri bildirimde yok; uygulamada görülür
      } else {
        ev.push({ type: 'aqi', id, urgent: false, title: 'Hava kalitesi kötüleşebilir · ' + name, body: 'Önümüzdeki saatlerde hava kalitesinin kötüleşmesi bekleniyor.' });
      }
    }
  }
  // 4) UV (yalnızca aşırı, ≥11)
  {
    const idx = range(d, T.uv.horizonH).filter((i) => { const hh = localHour(d.time[i]); return hh >= T.uv.fromHour && hh <= T.uv.toHour && (num(d.uv[i]) ?? 0) >= T.uv.extreme; });
    if (idx.length) {
      const pk = maxBy(idx, (i) => num(d.uv[i]));
      ev.push({ type: 'uv', id: 'uv:' + localDate(d.time[pk.i]), urgent: false, title: 'Aşırı UV · ' + name,
        body: 'UV indeksi ' + (Math.round(pk.v * 10) / 10) + ' (aşırı). 10:00–16:00 arası güneşten korunun.' });
    }
  }
  return ev;
}

// ---------- Hangi bildirimler gönderilecek? ----------
// sub: { tz, sent:{id:ts}, last:{'<şehirNo>|<tür>':ts}, day:{d,n} }
// perCity: [{ ci, name, events:[...] }]
// döner: { send:[{title,body,tag,type,id,ci}], patch:{ sent, last, day }, skipped:[{id,why}] }
function selectNotifications(sub, perCity, nowMs) {
  const up = userParts(nowMs, sub.tz || 'UTC');
  const quiet = up.hour >= T.quiet.from || up.hour < T.quiet.to;
  const sent = Object.assign({}, sub.sent || {}), last = Object.assign({}, sub.last || {});
  let day = sub.day && sub.day.d === up.date ? { d: up.date, n: sub.day.n } : { d: up.date, n: 0 };
  Object.keys(sent).forEach((k) => { if (nowMs - sent[k] > 72 * H) delete sent[k]; });
  Object.keys(last).forEach((k) => { if (nowMs - last[k] > 96 * H) delete last[k]; });

  const cand = [];
  perCity.forEach((c) => {
    const hasStorm = c.events.some((e) => e.type === 'storm');
    c.events.forEach((e) => { if (e.type === 'precip' && hasStorm) return; cand.push(Object.assign({ ci: c.ci }, e)); });
  });
  cand.sort((a, b) => T.priority.indexOf(a.type) - T.priority.indexOf(b.type));

  const send = [], skipped = [];
  for (const e of cand) {
    const key = e.ci + '|' + e.type, fullId = e.ci + '|' + e.id;
    if (sent[fullId]) { skipped.push({ id: fullId, why: 'tekrar' }); continue; }
    if (last[key] && nowMs - last[key] < T.cooldownH[e.type] * H) { skipped.push({ id: fullId, why: 'bekleme' }); continue; }
    if (quiet && !(e.urgent && T.night.types.includes(e.type))) { skipped.push({ id: fullId, why: 'sessiz-saat' }); continue; }
    if (day.n + send.length >= T.dailyCap) { skipped.push({ id: fullId, why: 'günlük-sınır' }); continue; }
    if (send.length >= T.maxPushPerRun) { skipped.push({ id: fullId, why: 'çalıştırma-sınırı' }); continue; }
    send.push({ type: e.type, id: fullId, ci: e.ci, urgent: !!e.urgent, title: e.title, body: e.body, tag: fullId });
    sent[fullId] = nowMs; last[key] = nowMs;
  }
  day = { d: day.d, n: day.n + send.length };
  return { send, patch: { sent, last, day }, skipped };
}

// Cloudflare Worker "hava-uyari": abonelik uçları + 30 dakikada bir çalışan uyarı kontrolü.
// Gerekli bağlama: KV (adı "KV"). İsteğe bağlı değişkenler: ALLOWED_ORIGIN, MAX_SUBS, VAPID_SUBJECT.



const API_FC = 'https://api.open-meteo.com/v1/forecast';
const API_AQ = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const API_ARCH = 'https://archive-api.open-meteo.com/v1/archive';
const FC_HOURLY = 'temperature_2m,apparent_temperature,precipitation,rain,showers,snowfall,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,uv_index,pressure_msl,cape,lifted_index,convective_inhibition,freezing_level_height';   // son beşi: dolu/fırtına risk birleşimi (aynı istek)
const CHUNK = 20;                         // tek istekte en fazla 20 konum (alt istek bütçesi: 50)

const J = (obj, status, extra) => new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {}) });
const ckey = (c) => c.lat.toFixed(2) + ',' + c.lon.toFixed(2);

// ---------- KV: tek "db" anahtarı (yalnızca değişince yazılır) ----------
async function loadDb(env) { return (await env.KV.get('db', 'json')) || { v: 1, subs: {} }; }
async function saveDb(env, db) { await env.KV.put('db', JSON.stringify(db)); }
async function mutate(env, fn) { const db = await loadDb(env); if ((await fn(db)) !== false) await saveDb(env, db); return db; }
async function subId(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return b64uEnc(h.slice(0, 12));
}
const testAt = new Map();
let vapidMem = null;
async function getVapid(env) {
  if (vapidMem) return vapidMem;
  let v = await env.KV.get('vapid', 'json');
  if (!v) { v = await generateVapid(); await env.KV.put('vapid', JSON.stringify(v)); }
  return (vapidMem = v);
}
const subject = (env) => env.VAPID_SUBJECT || (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*' ? normOrigin(env.ALLOWED_ORIGIN) : 'mailto:hava@example.com');

// ---------- Girdi doğrulama ----------
function cleanCities(list) {
  if (!Array.isArray(list)) return null;
  const out = [], seen = {};
  for (const c of list.slice(0, 3)) {
    const lat = Number(c && c.lat), lon = Number(c && c.lon), name = String((c && c.name) || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
    if (!name || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const city = { name, lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
    const clean = (v) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
    const province = clean(c.province), district = clean(c.district);
    if (province && district) { city.province = province; city.district = district; }   // il/ilçe seçimi (isteğe bağlı; kurallar yalnızca koordinatı kullanır)
    if (!seen[ckey(city)]) { seen[ckey(city)] = 1; out.push(city); }
  }
  return out.length ? out : null;
}
function validTz(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return typeof tz === 'string' && tz.length < 60; } catch (e) { return false; } }

// ---------- HTTP ----------
// ALLOWED_ORIGIN yanlışlıkla sonda "/" veya repo yolu (/hava-durumu/) ile girilse de çalışsın: tarayıcının Origin başlığı yalnızca "şema://alan[:port]" olur.
// Bu yüzden ayar da yalnızca origin kısmına indirilir (yol, sorgu, sondaki eğik çizgi, büyük/küçük harf farkı atılır). "*" ve boş değer olduğu gibi kalır.
function normOrigin(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s === '*') return s;
  try { const o = new URL(s).origin; return o === 'null' ? s : o; } catch (e) { return s; }
}
function corsFor(env, req) {
  const origin = req.headers.get('Origin'), allow = normOrigin(env.ALLOWED_ORIGIN);
  const ok = !allow || allow === '*' || !origin || normOrigin(origin) === allow;
  return { ok, headers: { 'Access-Control-Allow-Origin': allow && allow !== '*' ? allow : '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } };
}

async function handleRequest(req, env, deps) {
  const d = Object.assign({ now: Date.now(), send: sendPush }, deps || {});
  const cors = corsFor(env, req), url = new URL(req.url), path = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method === 'OPTIONS') return new Response(null, { status: cors.ok ? 204 : 403, headers: cors.headers });
  if (!cors.ok) return J({ error: 'origin' }, 403, cors.headers);
  try {
    if (req.method === 'GET' && path === '/') return J({ ok: true, name: 'hava-uyari' }, 200, cors.headers);
    if (req.method === 'GET' && path === '/vapid') return J({ key: (await getVapid(env)).pub }, 200, cors.headers);
    if (req.method !== 'POST') return J({ error: 'yok' }, 404, cors.headers);

    const raw = await req.text(); if (raw.length > 8192) return J({ error: 'büyük' }, 413, cors.headers);
    let b; try { b = JSON.parse(raw); } catch (e) { return J({ error: 'json' }, 400, cors.headers); }

    if (path === '/subscribe') {
      const s = b.subscription || {}, k = s.keys || {};
      if (!allowedEndpoint(s.endpoint) || typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 120 || k.auth.length > 40) return J({ error: 'abonelik' }, 400, cors.headers);
      const cities = cleanCities(b.cities); if (!cities) return J({ error: 'şehir' }, 400, cors.headers);
      const tz = validTz(b.tz) ? b.tz : 'UTC', id = await subId(s.endpoint), max = Number(env.MAX_SUBS) || 20;
      let full = false;
      await mutate(env, (db) => {
        const cur = db.subs[id];
        if (!cur && Object.keys(db.subs).length >= max) { full = true; return false; }
        if (cur && JSON.stringify([cur.keys, cur.cities, cur.tz]) === JSON.stringify([{ p256dh: k.p256dh, auth: k.auth }, cities, tz])) return false;   // değişmedi: yazma
        db.subs[id] = Object.assign({ sent: {}, last: {}, day: { d: '', n: 0 }, created: d.now }, cur || {}, { endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth }, cities, tz, updated: d.now });
      });
      return full ? J({ error: 'dolu' }, 409, cors.headers) : J({ ok: true, id, cities: cities.map((c) => c.name) }, 200, cors.headers);
    }
    if (path === '/unsubscribe') {
      const id = await subId(String(b.endpoint || ''));
      await mutate(env, (db) => { if (!db.subs[id]) return false; delete db.subs[id]; });
      return J({ ok: true }, 200, cors.headers);
    }
    if (path === '/test') {
      const id = await subId(String(b.endpoint || '')), db = await loadDb(env), sub = db.subs[id];
      if (!sub) return J({ error: 'kayıt yok' }, 404, cors.headers);
      if (d.now - (testAt.get(id) || 0) < 60000) return J({ error: 'bekle' }, 429, cors.headers);   // bellekte tutulur: KV'ye yazılmaz
      if (testAt.size > 500) testAt.clear();
      testAt.set(id, d.now);
      const st = await d.send(sub, { title: 'Deneme bildirimi', body: 'Bildirimler bu cihazda çalışıyor. Yalnızca önemli hava olaylarında haber vereceğim.', tag: 'deneme', url: './' }, await getVapid(env), subject(env), { ttl: 600, urgency: 'high' });
      if (st === 404 || st === 410) { await mutate(env, (x) => { delete x.subs[id]; }); return J({ error: 'abonelik geçersiz' }, 410, cors.headers); }
      return J({ ok: st >= 200 && st < 300, status: st }, 200, cors.headers);
    }
    if (path === '/diag') {   // salt okunur tanılama: yalnızca çağıranın KENDİ kaydını (izlenen konumlar) döndürür; bildirim göndermez, KV'ye yazmaz
      const id = await subId(String(b.endpoint || '')), sub = (await loadDb(env)).subs[id];
      if (!sub) return J({ error: 'kayıt yok' }, 404, cors.headers);
      return J({ ok: true, tz: sub.tz, updated: sub.updated, watched: sub.cities.slice(0, 3).map((c) => ({ name: c.name, province: c.province || null, district: c.district || null, lat: c.lat, lon: c.lon })) }, 200, cors.headers);
    }
    return J({ error: 'yok' }, 404, cors.headers);
  } catch (e) {
    return J({ error: 'sunucu' }, 500, cors.headers);
  }
}

// ---------- Cron: kontrol + gönderim ----------
async function getJson(f, url) { const r = await f(url); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }
const asArray = (x) => (Array.isArray(x) ? x : [x]);

async function getClimate(env, f, city, nowMs) {
  const key = 'clim:' + ckey(city);
  const hit = await env.KV.get(key, 'json'); if (hit) return hit;
  try {
    const end = new Date(nowMs - 7 * 86400000), start = new Date(Date.UTC(end.getUTCFullYear() - 5, end.getUTCMonth(), end.getUTCDate()));
    const ymd = (x) => x.toISOString().slice(0, 10);
    const j = await getJson(f, API_ARCH + '?latitude=' + city.lat + '&longitude=' + city.lon + '&start_date=' + ymd(start) + '&end_date=' + ymd(end) + '&daily=temperature_2m_max,temperature_2m_min&timezone=auto');
    const r1 = (a) => a.map((v) => (v === null ? null : Math.round(v * 10) / 10));
    const arch = { start: ymd(start), max: r1(j.daily.temperature_2m_max), min: r1(j.daily.temperature_2m_min) };
    await env.KV.put(key, JSON.stringify(arch), { expirationTtl: 60 * 86400 });
    return arch;
  } catch (e) { return null; }   // iklim verisi yoksa kural motoru daha sıkı mutlak eşiğe döner
}

async function runCron(env, deps) {
  const d = Object.assign({ now: Date.now(), fetch: (u) => fetch(u), send: sendPush }, deps || {});
  const db = await loadDb(env), subs = Object.entries(db.subs);
  const stats = { subs: subs.length, cities: 0, sent: 0, removed: 0, skipped: [], errors: [] };
  if (!subs.length) return stats;

  // 1) Benzersiz şehirler → tahmin (tek istek / 20 konum) + hava kalitesi
  const cities = {}; subs.forEach(([, s]) => s.cities.forEach((c) => { cities[ckey(c)] = c; }));
  const list = Object.values(cities); stats.cities = list.length;
  const fcBy = {}, aqBy = {};
  for (let i = 0; i < list.length; i += CHUNK) {
    const part = list.slice(i, i + CHUNK), q = 'latitude=' + part.map((c) => c.lat).join(',') + '&longitude=' + part.map((c) => c.lon).join(',');
    try {
      const fc = asArray(await getJson(d.fetch, API_FC + '?' + q + '&hourly=' + FC_HOURLY + '&past_hours=6&forecast_hours=36&timezone=auto&wind_speed_unit=kmh'));
      part.forEach((c, k) => { fcBy[ckey(c)] = fc[k]; });
    } catch (e) { stats.errors.push('tahmin: ' + e.message); }
    try {
      const aq = asArray(await getJson(d.fetch, API_AQ + '?' + q + '&hourly=european_aqi&forecast_hours=12&timezone=auto'));
      part.forEach((c, k) => { aqBy[ckey(c)] = aq[k]; });
    } catch (e) { stats.errors.push('hava kalitesi: ' + e.message); }
  }
  if (!Object.keys(fcBy).length) return stats;   // veri yok: 30 dk sonra yeniden denenir

  // 2) Her şehir için bir kez değerlendir
  const evBy = {};
  for (const c of list) {
    const k = ckey(c); if (!fcBy[k]) continue;
    try { evBy[k] = await evaluateCity(c, fcBy[k], aqBy[k] || null, d.now, (city) => getClimate(env, d.fetch, city, d.now)); }
    catch (e) { stats.errors.push('değerlendirme ' + c.name + ': ' + e.message); evBy[k] = []; }
  }

  // 3) Her abonelik için seçim + gönderim
  const patches = {}, gone = [], vapid = await getVapid(env);
  let pushes = 0;
  for (const [id, sub] of subs) {
    const perCity = sub.cities.filter((c) => evBy[ckey(c)]).map((c) => ({ ci: ckey(c), name: c.name, events: evBy[ckey(c)] }));
    if (!perCity.length) continue;
    const sel = selectNotifications(sub, perCity, d.now);
    stats.skipped.push.apply(stats.skipped, sel.skipped);
    let delivered = [];
    for (const n of sel.send) {
      if (pushes >= T.maxPushPerRun) break;
      pushes++;
      const urgent = !!n.urgent;
      try {
        const st = await d.send(sub, { title: n.title, body: n.body, tag: n.tag, url: './' }, vapid, subject(env), { ttl: urgent ? 1800 : 3 * 3600, urgency: urgent ? 'high' : 'normal', nowMs: d.now });
        if (st === 404 || st === 410) { gone.push(id); break; }
        if (st >= 200 && st < 300) { delivered.push(n); stats.sent++; } else stats.errors.push('push ' + st);
      } catch (e) { stats.errors.push('push: ' + e.message); }
    }
    // (budama ve gün sayacı sıfırlaması bellekte yapılır; bir sonraki GERÇEK yazımla kalıcı olur, kendi başına KV'ye yazılmaz)
    // yalnızca gerçekten gönderilenler "gönderildi" sayılır; gönderilemeyen bir sonraki turda yeniden denenir
    const sent = Object.assign({}, sub.sent || {}), last = Object.assign({}, sub.last || {});
    delivered.forEach((n) => { sent[n.id] = d.now; last[n.ci + '|' + n.type] = d.now; });
    Object.keys(sent).forEach((k) => { if (d.now - sent[k] > 72 * 3600000) delete sent[k]; });
    Object.keys(last).forEach((k) => { if (d.now - last[k] > 96 * 3600000) delete last[k]; });
    const dayD = sel.patch.day.d, dayN = (sub.day && sub.day.d === dayD ? sub.day.n : 0) + delivered.length;
    if (delivered.length) patches[id] = { sent, last, day: { d: dayD, n: dayN } };   // KV yazımı: yalnızca gerçekten bildirim gittiyse
  }

  // 4) Durumu yaz (taze kopya üzerinde birleştir; yalnızca değişen varsa)
  gone.forEach(() => stats.removed++);
  await mutate(env, (fresh) => {
    let changed = false;
    gone.forEach((id) => { if (fresh.subs[id]) { delete fresh.subs[id]; changed = true; } });
    Object.entries(patches).forEach(([id, p]) => {
      const s = fresh.subs[id]; if (!s || gone.includes(id)) return;
      if (JSON.stringify([s.sent, s.last, s.day]) !== JSON.stringify([p.sent, p.last, p.day])) { s.sent = p.sent; s.last = p.last; s.day = p.day; changed = true; }
    });
    return changed ? undefined : false;
  });
  return stats;
}

const __default = {
  fetch: (req, env) => handleRequest(req, env),
  scheduled: (event, env, ctx) => { ctx.waitUntil(runCron(env)); }
};

export default __default;
