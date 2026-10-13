// meteo.js (basınç trendi, fırtına/dolu riski, Beaufort, özet): uygulama ve Worker ortak mantığı
import test from 'node:test'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const M = createRequire(import.meta.url)('../../meteo.js');
const none = { cape: null, li: null, cin: null, frz: null, code: null, precip: null, gust: null, dp3: null };
const X = (o) => Object.assign({}, none, o);

test('basınç: yükselen / stabil / düşen / eksik geçmiş', () => {
  const ser = (f) => Array.from({ length: 30 }, (_, i) => f(i));
  let t = M.pressureTrend(ser((i) => 1000 + i * 1.5), 20); assert.equal(t.cls, 'rise-strong'); assert.equal(t.label, 'Belirgin yükseliyor'); assert.match(t.sentence, /Son 6 saatte basınç 9 hPa yükseldi/);
  t = M.pressureTrend(ser((i) => 1000 + i * 0.4), 20); assert.equal(t.cls, 'rise'); assert.equal(t.label, 'Hafif yükseliyor');
  t = M.pressureTrend(ser((i) => 1013 + (i % 2) * 0.2), 20); assert.equal(t.cls, 'steady'); assert.match(t.sentence, /yaklaşık sabit/);
  t = M.pressureTrend(ser((i) => 1020 - i * 0.4), 20); assert.equal(t.cls, 'fall'); assert.equal(t.label, 'Hafif düşüyor');
  t = M.pressureTrend(ser((i) => 1020 - i * 1.3), 20); assert.equal(t.cls, 'fall-strong'); assert.match(t.sentence, /Son 6 saatte basınç 8 hPa düştü/);
  // eksik geçmiş: yalnızca 4 saat geriye gidilebilir → 3 saatlik değişim kullanılır, 6/12 yok
  t = M.pressureTrend(ser((i) => 1020 - i * 0.6), 4); assert.equal(t.d6, null); assert.equal(t.d12, null); assert.equal(t.cls, 'fall'); assert.match(t.sentence, /Son 3 saatte/);
  t = M.pressureTrend(ser((i) => 1000), 2); assert.equal(t.ok, false); assert.equal(t.cls, null); assert.match(t.sentence, /yeterli değil/);
  t = M.pressureTrend(undefined, 5); assert.equal(t.ok, false);
  t = M.pressureTrend([null, null, null, null, null, null, 1000, null], 7); assert.equal(t.ok, false, 'null 0 sayılmaz');
});

test('dolu riski: düşük / orta / yüksek / eksik veri', () => {
  assert.equal(M.hailRisk(X({ cape: 100, li: 3, cin: -10, frz: 4200, code: 1, precip: 0, gust: 20, dp3: 0.2 })).label, 'Düşük');
  const mid = M.hailRisk(X({ cape: 1500, li: -4, cin: -30, frz: 3500, code: 95, precip: 1, gust: 35, dp3: -1 })); assert.equal(mid.label, 'Orta');
  const hi = M.hailRisk(X({ cape: 2500, li: -6, cin: -20, frz: 2800, code: 96, precip: 6, gust: 70, dp3: -3 })); assert.equal(hi.label, 'Yüksek'); assert.equal(hi.confidence, 'Yüksek');
  assert.ok(hi.reasons.length >= 1 && hi.reasons.length <= 2);
  const nodata = M.hailRisk(X({})); assert.equal(nodata.known, false); assert.equal(nodata.label, 'Veri yok');
  // yalnızca hava kodu / yalnızca yağış-rüzgâr: kararsızlık verisi olmadan "Düşük" denmez
  assert.equal(M.hailRisk(X({ code: 1, precip: 0, gust: 20 })).label, 'Veri yok');
  assert.equal(M.hailRisk(X({ code: 96 })).label, 'Orta', 'dolulu fırtına kodu tek başına en çok Orta');
});
test('dolu riski: CAPE yüksek ama diğer sinyaller zayıf → otomatik Yüksek olmaz', () => {
  const r1 = M.hailRisk(X({ cape: 3500, li: -2, cin: -10, frz: 4300, code: 3, precip: 0, gust: 15, dp3: 0 })); assert.notEqual(r1.label, 'Yüksek'); assert.ok(r1.level <= 1);
  const r2 = M.hailRisk(X({ cape: 3500 })); assert.equal(r2.label, 'Düşük'); assert.equal(r2.confidence, 'Düşük');
  // gök gürültüsü kodu olmadan her şey güçlü olsa bile Yüksek verilmez (tetikleyici şart)
  assert.ok(M.hailRisk(X({ cape: 3000, li: -7, cin: -5, frz: 2500, code: 3, precip: 9, gust: 90, dp3: -4 })).level <= 1);
  // güçlü CIN (engel) riski düşürür
  const open = M.hailRisk(X({ cape: 1800, li: -4, cin: -10, frz: 3000, code: 95, precip: 3, gust: 50, dp3: -2 })).score, capped = M.hailRisk(X({ cape: 1800, li: -4, cin: -300, frz: 3000, code: 95, precip: 3, gust: 50, dp3: -2 })).score;
  assert.ok(capped < open);
});
test('fırtına riski: düşük / orta / yüksek', () => {
  assert.equal(M.stormRisk(X({ cape: 50, li: 2, code: 2, precip: 0, gust: 15, dp3: 0 })).label, 'Düşük');
  assert.equal(M.stormRisk(X({ cape: 1200, li: -3, code: 95, precip: 1, gust: 35, dp3: -1 })).label, 'Orta');
  const hi = M.stormRisk(X({ cape: 2200, li: -5, code: 95, precip: 8, gust: 75, dp3: -3 })); assert.equal(hi.label, 'Yüksek'); assert.ok(hi.reasons.length);
  assert.equal(M.stormRisk(X({ code: 95 })).label, 'Orta', 'gök gürültüsü kodu en az Orta');
  assert.equal(M.stormRisk(X({})).label, 'Veri yok');
  // CAPE tek başına Yüksek yapmaz
  assert.notEqual(M.stormRisk(X({ cape: 4000 })).label, 'Yüksek');
});
test('Beaufort, yön, görüş, donma seviyesi', () => {
  assert.equal(M.beaufort(0).n, 0); assert.equal(M.beaufort(30).n, 5); assert.equal(M.beaufort(75).n, 9); assert.equal(M.beaufort(28.9).n, 4); assert.equal(M.beaufort(29).n, 5); assert.equal(M.beaufort(200).n, 12); assert.equal(M.beaufort(null), null);
  assert.equal(M.dir(0).long, 'Kuzey'); assert.equal(M.dir(200).long, 'Güney'); assert.equal(M.dir(315).short, 'KB'); assert.equal(M.dir(null), null);
  assert.equal(M.visibilityText(24000), 'Görüş iyi.'); assert.equal(M.visibilityText(2000), 'Görüş azalmış.'); assert.equal(M.visibilityText(null), '');
  assert.equal(M.freezingText(1400), 'Donma seviyesi 1.400 m.'); assert.equal(M.freezingText(undefined), '');
});
test('saat özeti: kısa, eksik dizilerle çökmez', () => {
  const h = { time: Array(30).fill(0), weather_code: Array(30).fill(1), wind_speed_10m: Array(30).fill(10), precipitation_probability: Array(30).fill(5) };
  assert.match(M.hourSummary(h, 20), /Yağış ihtimali düşük/);
  assert.equal(M.hourSummary({}, 3), 'Hava sakin görünüyor.');
  const w = Object.assign({}, h, { wind_speed_10m: h.wind_speed_10m.map((v, i) => (i >= 18 ? 40 : v)) }); assert.match(M.hourSummary(w, 20), /Rüzgâr güçleniyor/);
  const st = Object.assign({}, h, { cape: Array(30).fill(1800), lifted_index: Array(30).fill(-4), weather_code: Array(30).fill(95), wind_gusts_10m: Array(30).fill(60), precipitation: Array(30).fill(5) });
  assert.match(M.hourSummary(st, 20), /fırtına riski/); assert.ok(M.hourSummary(st, 20).split('. ').length <= 3);
});
