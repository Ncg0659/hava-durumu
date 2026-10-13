// Kural motoru: saf fonksiyonlar (ağ yok). Bir şehrin Open-Meteo tahmininden "gerçekten önemli" olayları çıkarır
// ve bir cihaza hangilerinin gönderileceğine karar verir. Eşikler yalnızca burada, T içinde.

import '../../eaqi.js';   // EAQI sınıfları: uygulamayla ortak tek tanım (derlemede içeriği pakete eklenir)
const EAQI = globalThis.EAQI;
import '../../meteo.js';   // basınç/dolu/fırtına risk mantığı: uygulamayla ortak (derlemede içeriği pakete eklenir)
const METEO = globalThis.METEO;

export const T = {
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
  dailyCap: 4,
  quiet: { from: 23, to: 7 },
  maxPushPerRun: 20
};

const H = 3600000;
const pad = (n) => (n < 10 ? '0' : '') + n;
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const rd = (v) => { const r = Math.round(v); return r === 0 ? 0 : r; };
const sg = (v) => { const r = rd(v); return r < 0 ? '−' + (-r) : String(r); };

// "2026-10-07T15:00" (şehrin yerel saati) → gerçek UTC ms
export function hourMs(t, offsetSec) { return Date.parse(t + ':00Z') - (offsetSec || 0) * 1000; }
export function localDate(t) { return t.slice(0, 10); }
export function localHour(t) { return +t.slice(11, 13); }

// Cihazın saat diliminde tarih + saat
export function userParts(nowMs, tz) {
  let f;
  try { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }); }
  catch (e) { f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }); }
  const p = {}; f.formatToParts(new Date(nowMs)).forEach((x) => { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, hour: +p.hour % 24 };
}

// Tahmin dizilerini (tek konum) kullanışlı hâle getir
export function prep(fc, nowMs) {
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
export function climateMean(arch, month, day) {
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
export async function evaluateCity(city, fc, aq, nowMs, getClimate) {
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
export function selectNotifications(sub, perCity, nowMs) {
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
