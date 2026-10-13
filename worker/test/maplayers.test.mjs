// Paket 6 saf hesapları: nokta kümesi, örnekleme, istek adresi, yanıt ayrıştırma, önbellek, renk/etiket, "sahte alan yok" ilkesi
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.EAQI = require('../../eaqi.js');
globalThis.Insights = require('../../insights.js');
const M = require('../../maplayers.js');

const hours = (n = 7, start = 15) => Array.from({ length: n }, (_, i) => `2026-10-12T${String((start + i) % 24).padStart(2, '0')}:00`);
function wxItem(t0 = 10) {
  const hr = { time: hours() };
  const F = ['temperature_2m', 'apparent_temperature', 'precipitation', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'];
  const cur = { time: '2026-10-12T15:15', weather_code: 3 };
  F.forEach((f, k) => { cur[f] = t0 + k; hr[f] = hours().map((_, s) => t0 + k + s); });
  return { utc_offset_seconds: 10800, current: cur, hourly: hr };
}

test('katman listesi: 7 katman, yalnızca radar karo; diğerleri noktasal (alan katmanı uydurulmaz)', () => {
  assert.deepEqual(M.LAYERS.map((l) => l.id), ['radar', 'temp', 'cloud', 'wind', 'aq', 'pressure', 'feels']);
  assert.equal(M.layer('radar').type, 'tile');
  for (const id of ['temp', 'cloud', 'wind', 'aq', 'pressure', 'feels']) { assert.equal(M.layer(id).type, 'point'); assert.ok(M.isPoint(id)); }
  assert.equal(M.isPoint('radar'), false); assert.equal(M.isPoint('nope'), false);
  for (const l of M.LAYERS) assert.ok(l.note && l.aria && l.label);
  for (const l of M.LAYERS.filter((x) => x.type === 'point')) assert.match(l.note, /noktasal|Noktasal/i, l.id);   // her noktasal katman bunu notunda söyler
});

test('buildPoints: şehir ilk, aynı yer tek nokta, favori işareti, geçersiz koordinat atılır, tavan', () => {
  const pts = M.buildPoints({ city: { name: 'İstanbul', lat: 41.0138, lon: 28.9497 }, favs: [{ name: 'Ankara', lat: 39.93, lon: 32.86 }, { name: 'İstanbul', lat: 41.0141, lon: 28.9499 }, { name: 'X', lat: NaN, lon: 3 }, { name: 'Y', lat: 95, lon: 3 }], user: { lat: 40, lon: 30 } });
  assert.deepEqual(pts.map((p) => p.role), ['city', 'fav', 'user']);
  assert.equal(pts[0].fav, true, 'şehir aynı zamanda favori');
  assert.equal(pts.length, 3);
  const many = M.buildPoints({ city: { name: 'a', lat: 41, lon: 29 }, favs: Array.from({ length: 12 }, (_, i) => ({ name: 'f' + i, lat: 30 + i, lon: 20 + i })), grid: Array.from({ length: 9 }, (_, i) => ({ lat: 50 + i * 0.5, lon: 10 + i * 0.5 })) });
  assert.ok(many.length <= M.CFG.maxPoints);
  assert.equal(many[0].role, 'city');
  assert.equal(many.filter((p) => p.role === 'fav').length, 12, 'tavan örnekleri keser, favorileri değil');
});

test('snap/snapPoint: yakın dokunuşlar aynı hücrede, uzak olanlar farklı', () => {
  const a = M.snapPoint(41.0138, 28.9497), b = M.snapPoint(41.0231, 28.9301), c = M.snapPoint(41.2, 29.4);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(M.keyOf(a.lat, a.lon), M.keyOf(b.lat, b.lon));
  assert.ok(Math.abs(M.snap(41.0138) - 41.0) < 0.026);
  assert.equal(M.snapPoint(10, 190).lon <= 180, true);
});

test('gridPoints: ≤ 9 nokta, sınırlar içinde, uzakları ayırır, tarih çizgisi, geçersiz girdi boş', () => {
  const b = { south: 40, north: 42, west: 28, east: 30 };
  const g = M.gridPoints(b, [], 0);
  assert.equal(g.length, 9);
  for (const p of g) { assert.ok(p.lat > 40 && p.lat < 42 && p.lon > 28 && p.lon < 30); }
  assert.equal(new Set(g.map((p) => p.lat + ',' + p.lon)).size, 9);
  const av = M.gridPoints(b, [{ lat: 41, lon: 29 }], 0.3);
  assert.equal(av.length, 8, 'merkeze yakın örnek atılır');
  assert.deepEqual(M.gridPoints(null), []); assert.deepEqual(M.gridPoints({ south: 99, north: 1, west: 0, east: 1 }), []);
  const dl = M.gridPoints({ south: 0, north: 10, west: 170, east: 190 }, [], 0);
  assert.ok(dl.every((p) => p.lon >= -180 && p.lon <= 180));
  const polar = M.gridPoints({ south: 80, north: 90, west: 0, east: 10 }, [], 0);
  assert.ok(polar.every((p) => p.lat <= 85));
});

test('istek adresleri: tek toplu istek, tüm hava alanları + saatlik, AQ ayrı', () => {
  const pts = [{ lat: 41.0138, lon: 28.9497 }, { lat: 39.93, lon: 32.86 }, { lat: 36.9, lon: 30.7 }];
  const u = M.wxUrl(pts), q = new URL(u).searchParams;
  assert.equal(new URL(u).origin + new URL(u).pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(q.get('latitude'), '41.0138,39.9300,36.9000'); assert.equal(q.get('longitude'), '28.9497,32.8600,30.7000');
  for (const f of ['temperature_2m', 'apparent_temperature', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'precipitation']) { assert.ok(q.get('current').includes(f), f); assert.ok(q.get('hourly').includes(f), f); }
  assert.equal(q.get('forecast_hours'), '7'); assert.equal(q.get('timezone'), 'auto'); assert.equal(q.get('wind_speed_unit'), 'kmh');
  const a = new URL(M.aqUrl(pts)); assert.equal(a.origin, 'https://air-quality-api.open-meteo.com');
  assert.ok(a.searchParams.get('current').includes('european_aqi')); assert.ok(a.searchParams.get('hourly').includes('european_aqi'));
  assert.ok(!/us_aqi/.test(M.aqUrl(pts)), 'ABD AQI kullanılmaz');
});

test('parseBundle: çok/tek nokta, adımlar, saat hizalama, eşleme güvenilmezse boş, eksik alan = yok', () => {
  const pts = [{ key: 'a' }, { key: 'b' }];
  const got = M.parseBundle([wxItem(10), wxItem(20)], pts, 'wx', 1000);
  assert.deepEqual(Object.keys(got), ['a', 'b']);
  assert.equal(got.a.vals[0].temperature_2m, 10); assert.equal(got.b.vals[0].temperature_2m, 20);
  assert.equal(got.a.vals[3].temperature_2m, 13, '+3 sa = saatlik dizinin 3. adımı');
  assert.equal(got.a.time[3], '2026-10-12T18:00'); assert.equal(got.a.time[0], '2026-10-12T15:15');
  assert.equal(got.a.off, 10800);
  const one = M.parseBundle(wxItem(5), [{ key: 'z' }], 'wx', 1); assert.equal(one.z.vals[6].temperature_2m, 11);
  assert.deepEqual(M.parseBundle([wxItem()], pts, 'wx', 1), {}, 'sayı uyuşmuyorsa hiçbir değer yazılmaz');
  assert.deepEqual(M.parseBundle(null, pts, 'wx', 1), {}); assert.deepEqual(M.parseBundle({ error: true }, [{ key: 'q' }], 'wx', 1), {});
  const it = wxItem(); delete it.hourly.cloud_cover; delete it.current.pressure_msl;
  const r = M.parseBundle(it, [{ key: 'k' }], 'wx', 1).k;
  assert.equal(r.vals[0].pressure_msl, undefined); assert.equal(r.vals[2].cloud_cover, undefined); assert.ok(r.vals[2].temperature_2m != null);
  const sh = wxItem(); sh.hourly.time = sh.hourly.time.slice(0, 3); for (const k of Object.keys(sh.hourly)) if (k !== 'time') sh.hourly[k] = sh.hourly[k].slice(0, 3);
  const r2 = M.parseBundle(sh, [{ key: 'k' }], 'wx', 1).k; assert.equal(r2.vals[6], null); assert.equal(r2.time[6], null);
  const full = wxItem(); full.hourly.time = Array.from({ length: 48 }, (_, i) => `2026-10-12T${String(i % 24).padStart(2, '0')}:00`.replace('2026-10-12', i < 24 ? '2026-10-12' : '2026-10-13'));
  for (const k of Object.keys(full.hourly)) if (k !== 'time') full.hourly[k] = Array.from({ length: 48 }, (_, i) => i);
  assert.equal(M.parseBundle(full, [{ key: 'k' }], 'wx', 1).k.vals[2].temperature_2m, 17, 'forecast_hours yok sayılsa da saat eşlemesi doğru (15+2)');
});

test('hourIndex', () => {
  assert.equal(M.hourIndex({ time: hours() }, '2026-10-12T17:45'), 2);
  assert.equal(M.hourIndex({ time: hours() }, '2026-11-01T17:45'), 0);
  assert.equal(M.hourIndex(null, '2026-10-12T17:45'), 0);
});

test('önbellek: TTL, eksik nokta listesi, tavan aşılınca en eski silinir', () => {
  const c = M.cacheNew(), pts = [{ key: 'a' }, { key: 'b' }];
  assert.equal(M.missing(c, pts, 'wx', 0).length, 2);
  M.cachePut(c, 'wx', 'a', { t: 1000 });
  assert.deepEqual(M.missing(c, pts, 'wx', 1000 + 1000).map((p) => p.key), ['b']);
  assert.equal(M.missing(c, pts, 'wx', 1000 + M.CFG.wxTtl + 1).length, 2, 'wx TTL dolunca yeniden ister');
  assert.equal(M.fresh({ t: 0 }, 'aq', M.CFG.aqTtl - 1), true); assert.equal(M.fresh({ t: 0 }, 'aq', M.CFG.aqTtl + 1), false);
  assert.ok(M.CFG.aqTtl > M.CFG.wxTtl);
  const c2 = M.cacheNew();
  for (let i = 0; i < M.CFG.cacheMax + 20; i++) M.cachePut(c2, i % 2 ? 'wx' : 'aq', 'k' + i, { t: i });
  assert.ok(c2.n <= M.CFG.cacheMax); assert.ok(!c2.aq.k0 && !c2.wx.k1, 'en eski girişler gitti'); assert.ok(c2.wx['k' + (M.CFG.cacheMax + 19)] || c2.aq['k' + (M.CFG.cacheMax + 19)]);
});

test('pill/valueFor: her katman doğru alanı okur; veri yoksa null (uydurma yok)', () => {
  const c = M.cacheNew(); M.cachePut(c, 'wx', 'a', M.parseBundle(wxItem(10), [{ key: 'a' }], 'wx', 1).a);
  const aqi = { current: { time: '2026-10-12T15:15', european_aqi: 59.6, pm2_5: 5, pm10: 9 }, hourly: { time: hours(), european_aqi: hours().map((_, i) => 40 + i * 10) }, utc_offset_seconds: 0 };
  M.cachePut(c, 'aq', 'a', M.parseBundle(aqi, [{ key: 'a' }], 'aq', 1).a);
  assert.equal(M.pill(c, 'temp', 'a', 0).text, '10°'); assert.equal(M.pill(c, 'feels', 'a', 0).text, '11°');
  assert.equal(M.pill(c, 'cloud', 'a', 0).text, '13%'); assert.equal(M.pill(c, 'pressure', 'a', 0).text, '14');
  assert.equal(M.pill(c, 'wind', 'a', 0).text, '15'); assert.equal(M.pill(c, 'wind', 'a', 0).rot, (16 + 180) % 360);
  assert.equal(M.pill(c, 'aq', 'a', 0).text, '60', 'EAQI ortak yuvarlama (59,6 → 60)'); assert.equal(M.pill(c, 'aq', 'a', 3).text, '70');
  assert.equal(M.pill(c, 'temp', 'a', 3).text, '13°');
  assert.equal(M.pill(c, 'temp', 'zz', 0), null); assert.equal(M.pill(c, 'radar', 'a', 0), null); assert.equal(M.pill(c, 'temp', 'a', 4), null, 'tanımsız adım: veri yok');
  assert.equal(M.pill(c, 'aq', 'a', 0).bg, Insights.AQ_COLOR[EAQI.level(59.6)]);
  assert.match(M.aqLabel(60), /Kötü/);
});

test('renk ölçekleri: sıcaklık tekdüze, sınırlarda kırpılır; yazı rengi kontrastlı', () => {
  const rgbv = (s) => s.match(/\d+/g).map(Number);
  assert.deepEqual(rgbv(M.tempColor(-50)), rgbv(M.tempColor(-15))); assert.deepEqual(rgbv(M.tempColor(80)), rgbv(M.tempColor(40)));
  assert.notEqual(M.tempColor(5), M.tempColor(25));
  assert.equal(M.pill(Object.assign(M.cacheNew(), { wx: { a: { t: 1, vals: { 0: { temperature_2m: 36 } }, time: {} } } }), 'temp', 'a', 0).fg, '#fff', 'koyu zeminde beyaz yazı');
  assert.equal(M.pill(Object.assign(M.cacheNew(), { wx: { a: { t: 1, vals: { 0: { temperature_2m: 22 } }, time: {} } } }), 'temp', 'a', 0).fg, '#0b1a2e', 'açık zeminde koyu yazı');
});

test('lejant: yalnızca renkli katmanlarda; AQ 6 sınıf ortak etiketlerle', () => {
  for (const id of ['temp', 'feels', 'cloud']) { const l = M.legend(id); assert.equal(l.kind, 'gradient'); assert.ok(l.css.startsWith('linear-gradient')); assert.ok(l.ticks.length >= 3); }
  const a = M.legend('aq'); assert.equal(a.kind, 'classes'); assert.deepEqual(a.items.map((i) => i.label), EAQI.LABEL); assert.deepEqual(a.items.map((i) => i.color), Insights.AQ_COLOR);
  for (const id of ['wind', 'pressure', 'radar']) assert.equal(M.legend(id), null);
});

test('rüzgâr yönü: gelen yön metni (Türkçe ek) ve ok açısı gittiği yön', () => {
  assert.equal(M.windFromText(0), 'Kuzeyden'); assert.equal(M.windFromText(180), 'Güneyden'); assert.equal(M.windFromText(90), 'Doğudan');
  assert.equal(M.windFromText(270), 'Batıdan'); assert.equal(M.windFromText(225), 'Güneybatıdan'); assert.equal(M.windFromText(315), 'Kuzeybatıdan');
  assert.equal(M.windFromText(359), 'Kuzeyden'); assert.equal(M.windFromText(-45), 'Kuzeybatıdan');
  assert.equal(M.arrowDeg(0), 180); assert.equal(M.arrowDeg(270), 90); assert.equal(M.arrowDeg(200), 20);
  assert.equal(M.pressureWord(1000), 'Alçak'); assert.equal(M.pressureWord(1013), 'Normal'); assert.equal(M.pressureWord(1030), 'Yüksek');
});

test('biçim: derece ve mm', () => {
  assert.equal(M.dg(-0.4), '0°'); assert.equal(M.dg(-3.6), '−4°'); assert.equal(M.dg(21.5), '22°');
  assert.equal(M.mm(0.24), '0,2'); assert.equal(M.mm(3), '3'); assert.equal(M.stepLabel(0), 'Şimdi'); assert.equal(M.stepLabel(3), '+3 sa');
  assert.deepEqual(M.CFG.steps, [0, 1, 2, 3, 6]); assert.equal(M.CFG.hourlyCount, 7);
});
