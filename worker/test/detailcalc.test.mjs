// Paket 4 saf hesapları: dünle karşılaştırma, yağış toplamı, yorumlar, güneş, iklim özeti
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../../detailcalc.js');

const pad = (n) => String(n).padStart(2, '0');
// 3 gün saatlik: 2026-10-11 (dün), 12 (bugün), 13 (yarın); start = bugün 12:00
function mk(fn = {}, days = ['2026-10-11', '2026-10-12', '2026-10-13']) {
  const time = [];
  days.forEach((d) => { for (let h = 0; h < 24; h++) time.push(`${d}T${pad(h)}:00`); });
  const n = time.length, col = (f, dflt) => Array.from({ length: n }, (_, i) => (f ? f(i, time[i]) : dflt));
  return {
    time,
    temperature_2m: col(fn.t, 15), apparent_temperature: col(fn.f, 15), relative_humidity_2m: col(fn.rh, 50), dew_point_2m: col(fn.dp, 5),
    wind_speed_10m: col(fn.w, 10), wind_gusts_10m: col(fn.g, 15), wind_direction_10m: col(fn.wd, 200), uv_index: col(fn.uv, 0),
    precipitation: col(fn.p, 0), rain: col(fn.rain, 0), snowfall: col(fn.snow, 0), precipitation_probability: col(fn.pp, 0),
    pressure_msl: col(fn.press, 1015), visibility: col(fn.vis, 20000)
  };
}
const NOW = 24 + 12;   // bugün 12:00

test('dünkü aynı saat: doğru indeks, eksik/yok → null', () => {
  const h = mk({ t: (i) => i });
  assert.equal(D.sameHourAgo(h.time, NOW, 1), NOW - 24);
  const c = D.vsYesterday(h, 'temperature_2m', NOW);
  assert.deepEqual([c.now, c.prev, c.delta], [NOW, NOW - 24, 24]);
  assert.equal(D.vsYesterday(h, 'temperature_2m', 5), null, 'dünün verisi yoksa karşılaştırma yok');
  const h2 = mk({ t: (i) => (i === NOW - 24 ? null : 10) });
  assert.equal(D.vsYesterday(h2, 'temperature_2m', NOW), null, 'dünkü değer eksik → karşılaştırma yok (0 sayılmaz)');
  assert.equal(D.vsYesterday({ time: h.time }, 'temperature_2m', NOW), null, 'değişken hiç yok → null, çökme yok');
  assert.match(D.cmpText('temp', { delta: 3.2 }), /3°C daha sıcak/);
  assert.match(D.cmpText('temp', { delta: -2 }), /2°C daha soğuk/);
  assert.match(D.cmpText('temp', { delta: 0.4 }), /yaklaşık aynı/);
  assert.equal(D.cmpText('temp', null), '');
  assert.equal(D.cmpText('rain', { now: 0, prev: 0, delta: 0 }), '', 'ikisi de yağışsızsa cümle yok');
  assert.match(D.cmpText('rain', { now: 2, prev: 0, delta: 2 }), /daha fazla/);
});

test('24 saatlik yağış toplamı: doğru pencere; eksik saat/geçmiş yok → null', () => {
  const h = mk({ p: (i) => (i >= NOW - 23 && i <= NOW ? 0.5 : i > NOW && i <= NOW + 24 ? 1 : 0) });
  const t = D.precipTotals(h, NOW);
  assert.equal(Math.round(t.past * 10) / 10, 12, 'son 24 saat = 24 × 0,5');
  assert.equal(Math.round(t.next * 10) / 10, 24, 'gelecek 24 saat = 24 × 1');
  const h2 = mk({ p: (i) => (i === NOW - 5 ? null : 1) });
  assert.equal(D.precipTotals(h2, NOW).past, null, 'bir saat eksikse toplam üretilmez');
  assert.notEqual(D.precipTotals(h2, NOW).next, null);
  const short = mk({}, ['2026-10-12', '2026-10-13']);   // geçmiş satır yok (eski önbellek)
  assert.equal(D.precipTotals(short, 12).past, null, 'geçmiş yoksa sahte 0 yok');
  const edge = mk({}, ['2026-10-11', '2026-10-12']);
  assert.equal(D.precipTotals(edge, NOW + 20).next, null, 'gelecek yeterli değilse null');
  assert.equal(D.precipTotals({ time: h.time }, NOW).next, null);
});

test('sıcaklık / hissedilen / rüzgâr yorumları', () => {
  const h = mk({ t: (i, t) => 10 + 12 * Math.exp(-Math.pow((+t.slice(11, 13) - 15) / 4, 2)) });
  assert.match(D.tempSummary(h, NOW, NOW + 23), /en yüksek seviyeye çıkacak/);
  assert.match(D.tempSummary(mk({ t: () => 14 }), NOW, NOW + 23), /pek değişmeyecek/);
  assert.equal(D.tempSummary({ time: h.time }, NOW, NOW + 23), '');
  assert.equal(D.feelsSummary(28, 32, 70, 5), 'Nem ve düşük rüzgâr nedeniyle daha sıcak hissediliyor.');
  assert.equal(D.feelsSummary(5, 0, 60, 30), 'Rüzgâr nedeniyle daha soğuk hissediliyor.');
  assert.equal(D.feelsSummary(20, 20.5, 50, 5), 'Hissedilen sıcaklık gerçek sıcaklığa yakın.');
  assert.match(D.feelsSummary(28, 31, null, null), /3°C üzerinde/, 'neden verisi yoksa neden uydurulmaz');
  assert.equal(D.feelsSummary(null, 3, 1, 1), '');
  const w = mk({ w: (i, t) => (+t.slice(11, 13) >= 15 && t.startsWith('2026-10-12') ? 35 : 10) });
  assert.match(D.windSummary(w, NOW, NOW + 23), /rüzgâr güçlenecek/);
  const w2 = mk({ w: (i, t) => (t.startsWith('2026-10-12') ? 35 : 8) });
  assert.match(D.windSummary(w2, NOW, NOW + 23), /zayıflıyor/);
  assert.match(D.windSummary(mk({ w: () => 5 }), NOW, NOW + 23), /hafif/);
  assert.equal(D.windSummary({ time: w.time }, NOW, NOW + 23), '');
});

test('UV özeti ve yağış özeti', () => {
  const cls = (u) => (u < 3 ? 0 : u < 6 ? 1 : u < 8 ? 2 : u < 11 ? 3 : 4), names = ['Düşük', 'Orta', 'Yüksek', 'Çok yüksek', 'Aşırı'];
  const uv = mk({ uv: (i, t) => (t.startsWith('2026-10-12') && +t.slice(11, 13) >= 12 && +t.slice(11, 13) <= 15 ? 7 : 1) });
  assert.equal(D.uvSummary(uv, NOW, NOW + 23, cls, names), 'UV 12:00–15:00 arasında yüksek. Güneş kremi kullanılması önerilir.');
  assert.equal(D.uvSummary(mk({ uv: () => 0.4 }), NOW, NOW + 23, cls, names), 'UV önümüzdeki 24 saatte düşük kalacak.');
  assert.equal(D.uvSummary({ time: uv.time }, NOW, NOW + 23, cls, names), '');
  const rain = mk({ pp: (i, t) => (i < NOW + 5 ? 70 : 10), p: (i) => (i > NOW && i < NOW + 5 ? 1 : 0) });
  assert.match(D.rainSummary(rain, NOW, NOW + 23, D.precipTotals(rain, NOW)), /yağış ihtimali azalıyor/);
  const dry = mk({});
  assert.equal(D.rainSummary(dry, NOW, NOW + 23, D.precipTotals(dry, NOW)), 'Önümüzdeki 24 saatte belirgin yağış beklenmiyor.');
  const snow = mk({ pp: () => 80, p: () => 0.3, snow: () => 0.2 });
  assert.match(D.rainSummary(snow, NOW, NOW + 23, D.precipTotals(snow, NOW)), /Kar yağışı/);
  assert.equal(D.rainSummary({ time: dry.time }, NOW, NOW + 23, D.precipTotals({ time: dry.time }, NOW)), '', 'veri yoksa cümle yok');
});

test('basınç, görüş, nem yorumları', () => {
  const fall = mk({ press: (i) => 1020 - 0.5 * i });
  assert.match(D.pressSummary(fall, NOW, NOW + 23), /Basınç son 6 saatte düşüyor/);
  assert.match(D.pressSummary(mk({ press: () => 1015 }), NOW, NOW + 23), /stabil/);
  assert.equal(D.pressSummary(mk({ press: () => null }), NOW, NOW + 23), 'Basınç geçmişi yeterli değil.');
  const vis = mk({ vis: (i) => (i >= NOW + 4 ? 2500 : 20000) });
  assert.match(D.visSummary(vis, NOW, NOW + 23), /saatlerinde görüş azalabilir/);
  assert.match(D.visSummary(mk({}), NOW, NOW + 23), /Görüş iyi\. Gün boyunca görüş iyi kalacak/);
  const fog = mk({ vis: () => 800, rh: () => 97, t: () => 6, dp: () => 5.5 });
  assert.match(D.visSummary(fog, NOW, NOW + 23), /sis oluşumuna uygun koşullar olabilir/);
  assert.doesNotMatch(D.visSummary(fog, NOW, NOW + 23), /sis olacak/i);
  const nofog = mk({ vis: () => 800, rh: () => null, t: () => 6, dp: () => 5.5 });
  assert.doesNotMatch(D.visSummary(nofog, NOW, NOW + 23), /sis oluşumuna/, 'nem yoksa sis ipucu yok');
  assert.equal(D.visSummary({ time: fog.time }, NOW, NOW + 23), '');
  assert.equal(D.humSummary(20, 85, 18), 'Nem çok yüksek. Çiy noktası sıcaklığa yaklaşıyor.');
  assert.match(D.humSummary(25, 20, -2), /daha kuru hissedilebilir/);
  assert.equal(D.humSummary(null, null, null), '');
});

test('güneş: İstanbul 12 Ekim — gün doğumu/batımı ve ilk/son ışık makul, API ile uyuşmazsa gizlenir', () => {
  const lat = 41.0082, lon = 28.9784, off = 3 * 3600;
  const s = D.sunDay('2026-10-12', lat, lon, off);
  // İstanbul 12 Ekim: doğuş ≈ 07:08, batış ≈ 18:28 (gün ≈ 11 sa 20 dk) (±5 dk), öğle yüksekliği ≈ 41,6°
  assert.ok(Math.abs(s.rise - (7 * 60 + 8)) <= 6, 'doğuş ' + D.fmtMin(s.rise));
  assert.ok(Math.abs(s.set - (18 * 60 + 28)) <= 6, 'batış ' + D.fmtMin(s.set));
  assert.ok(s.dawn < s.rise && s.rise - s.dawn > 20 && s.rise - s.dawn < 40, 'ilk ışık doğuştan ~30 dk önce');
  assert.ok(s.dusk > s.set && s.dusk - s.set > 20 && s.dusk - s.set < 40);
  assert.ok(Math.abs(s.maxElev - 41.6) < 1.2, 'öğle yüksekliği ' + s.maxElev);
  const ok = D.sunInfo({ date: '2026-10-12', lat, lon, offSec: off, sunrise: '2026-10-12T07:09', sunset: '2026-10-12T18:29' });
  assert.equal(ok.trusted, true); assert.ok(ok.dawn !== null && ok.dusk !== null);
  assert.ok(ok.lenDelta < 0 && Math.abs(ok.lenDelta) < 4, 'Ekim ayında gün kısalıyor: ' + ok.lenDelta);
  const bad = D.sunInfo({ date: '2026-10-12', lat, lon, offSec: off, sunrise: '2026-10-12T09:30', sunset: '2026-10-12T18:29' });
  assert.equal(bad.trusted, false); assert.equal(bad.dawn, undefined, 'güvenilmezse ilk ışık yok'); assert.equal(bad.rise, 9 * 60 + 30, 'API değeri aynen kalır');
  assert.equal(D.sunInfo({ date: '2026-10-12', lat, lon, offSec: null, sunrise: '2026-10-12T07:09', sunset: '2026-10-12T18:29' }).trusted, false, 'UTC farkı yoksa hesap yok');
  assert.equal(D.sunInfo({ date: '2026-10-12', lat, lon, offSec: off, sunrise: null, sunset: null }).len, null);
  const polar = D.sunDay('2026-12-21', 78.2, 15.6, 3600);   // Svalbard: kutup gecesi
  assert.equal(polar.rise, null); assert.equal(polar.len, null);
  assert.equal(D.sunInfo({ date: '2026-12-21', lat: 78.2, lon: 15.6, offSec: 3600, sunrise: null, sunset: null }).trusted, false);
  assert.match(D.sunSummary(ok, 10 * 60), /^Güneş 18:29 sularında batacak\. Gün dünden yaklaşık \d+ dk kısa\.$/);
  assert.equal(D.sunSummary(ok, 20 * 60).split('.')[0], 'Güneş battı');
  assert.match(D.sunSummary(ok, 3 * 60), /^Güneş 07:09 sularında doğacak/);
  assert.equal(D.sunSummary({ rise: null, set: null }, 100), '');
});

test('iklim: arşiv özeti, doy ortalaması, eksik/yetersiz veri → null', () => {
  const time = [], tx = [], tn = [], pr = [];
  for (let y = 2016; y <= 2025; y++) for (let m = 0; m < 12; m++) {
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= dim; d++) { time.push(`${y}-${pad(m + 1)}-${pad(d)}`); tx.push(20 + m); tn.push(10 + m); pr.push(m === 9 ? 3 : 0); }
  }
  const cl = D.climateFromArchive({ daily: { time, temperature_2m_max: tx, temperature_2m_min: tn, precipitation_sum: pr } }, 10);
  assert.ok(cl && cl.years === 10);
  const nor = D.climateNormal(cl, '2026-07-15');
  assert.equal(nor.tmax, 26); assert.equal(nor.tmin, 16);
  assert.equal(cl.mon[9].x, 29); assert.equal(cl.mon[9].n, 19); assert.equal(Math.round(cl.mon[9].p), 93, 'Ekim: 31 gün × 3 mm');
  assert.equal(cl.mon[0].p, 0);
  assert.ok(JSON.stringify(cl).length < 8000, 'saklanan özet küçük: ' + JSON.stringify(cl).length);
  assert.equal(D.climateSentence(30, 20, { tmax: 26, tmin: 16 }, 10), 'Bugün, son 10 yılın bu dönem ortalamasından 4°C daha sıcak.');
  assert.equal(D.climateSentence(20, 12, { tmax: 26, tmin: 16 }, 10), 'Bugün, son 10 yılın bu dönem ortalamasından 5°C daha soğuk.');
  assert.match(D.climateSentence(26.5, 16.5, { tmax: 26, tmin: 16 }, 10), /ortalamasına yakın/);
  assert.equal(D.climateSentence(null, 3, { tmax: 1, tmin: 0 }), '');
  assert.equal(D.climateSentence(20, 10, null), '');
  assert.equal(D.climateFromArchive(null, 10), null);
  assert.equal(D.climateFromArchive({ daily: { time: time.slice(0, 400), temperature_2m_max: tx.slice(0, 400), temperature_2m_min: tn.slice(0, 400) } }, 10), null, '10 yılın ~1\'i varsa güvenilmez → null');
  assert.equal(D.climateNormal(null, '2026-07-15'), null);
  // değerleri eksik gün (null) 0 sayılmaz
  const holes = tx.map((v, i) => (i % 2 ? null : v)), cl2 = D.climateFromArchive({ daily: { time, temperature_2m_max: holes, temperature_2m_min: tn, precipitation_sum: pr.map((v, i) => (i % 2 ? null : v)) } }, 10);
  assert.equal(cl2.mon[0].x, 20, 'eksik günler ortalamayı bozmaz');
  assert.equal(cl2.mon[0].p, null, 'ayın yarısı eksikse aylık yağış ortalaması yok');
});
