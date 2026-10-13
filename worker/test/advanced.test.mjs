// Paket 7: gelişmiş modül altyapısı (capability, önbellek, istek yönetimi, bayraklar, normalize çıktı)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.EAQI = require('../../eaqi.js');
const Core = require('../../advanced/core.js');
const Cfg = require('../../advanced/config.js');
const Cap = require('../../advanced/capability.js');
const Ens = require('../../advanced/ensemble.js');
const Flood = require('../../advanced/flood.js');
const Marine = require('../../advanced/marine.js');
const Climate = require('../../advanced/climate.js');
const Seasonal = require('../../advanced/seasonal.js');
const AQ = require('../../advanced/airquality.js');
const Advanced = require('../../advanced/index.js');

const ANKARA = { lat: 39.93, lon: 32.86 }, ANTALYA = { lat: 36.88, lon: 30.7 }, ISTANBUL = { lat: 41.01, lon: 28.97 };

// ---- sahte ortam: saat, depolama, ağ ----
function env(over = {}) {
  const e = { t: 1_800_000_000_000, calls: [], online: true, pending: [] };
  e.rt = Core.createRuntime({
    storage: Core.memStorage(), now: () => e.t, online: () => e.online,
    fetch: over.fetch || ((url, init) => { e.calls.push(url); return Promise.resolve(new Response(JSON.stringify(over.body || {}), { status: over.status || 200 })); })
  });
  return e;
}
// elle çözülen istek: yarış (stale response) testleri için
function gated() {
  const e = env({ fetch: (url, init) => new Promise((ok, bad) => {
    e.calls.push(url);
    const q = { url, ok: (body, status = 200) => ok(new Response(JSON.stringify(body), { status })) };
    e.pending.push(q);
    const ab = () => { const err = new Error('aborted'); err.name = 'AbortError'; bad(err); };
    if (init && init.signal) { if (init.signal.aborted) ab(); else init.signal.addEventListener('abort', ab); }
  }) });
  return e;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- örnek yanıtlar ----
function ensBody(members = 20, spread = 0.5) {
  const time = []; for (let d = 0; d < 5; d++) for (let h = 0; h < 24; h++) time.push(`2026-10-${String(13 + d)}T${String(h).padStart(2, '0')}:00`);
  const hourly = { time };
  for (const v of ['temperature_2m', 'precipitation', 'wind_speed_10m']) {
    hourly[v] = time.map(() => v === 'precipitation' ? 0 : 10);   // kontrol
    for (let m = 1; m < members; m++) hourly[`${v}_member${String(m).padStart(2, '0')}`] = time.map(() => v === 'precipitation' ? 0 : 10 + (m % 2 ? spread : -spread));
  }
  return { hourly };
}
const floodBody = (lat, lon, q) => ({ latitude: lat, longitude: lon, daily: { time: q.map((_, i) => `2026-10-${13 + i}`), river_discharge: q } });
const marineBody = (wh) => ({ latitude: 36.9, longitude: 30.7, hourly: { time: wh.map((_, i) => `2026-10-13T${String(i % 24).padStart(2, '0')}:00`), wave_height: wh, wave_direction: wh.map(() => 200), wave_period: wh.map(() => 5), sea_surface_temperature: wh.map(() => 22) } });

// ================= Capability =================
test('capability: iç bölge → marine false; kıyı → marine true; global modüller true', () => {
  const a = Cap.getAdvancedCapabilities(ANKARA), k = Cap.getAdvancedCapabilities(ANTALYA);
  assert.deepEqual(a, { ensemble: true, flood: false, climate: true, seasonal: true, marine: false });
  assert.equal(k.marine, true); assert.equal(Cap.getAdvancedCapabilities(ISTANBUL).marine, true);
  assert.equal(Cap.getAdvancedCapabilities({ lat: 40.6, lon: 33.61 }).marine, false);     // Çankırı
  assert.equal(Cap.getAdvancedCapabilities({ lat: 40.69, lon: 30.27 }).marine, false);    // Sapanca gölü: kıyıya ~30 km
  assert.equal(Cap.getAdvancedCapabilities({ lat: 51.5, lon: -0.12 }).marine, false);     // referans dışı: uydurma yok
  assert.match(Cap.explainAdvancedCapabilities({ lat: 51.5, lon: -0.12 }).details.marine.reason, /referans/);
});
test('capability: geçersiz koordinat → hepsi false', () => {
  for (const l of [null, {}, { lat: NaN, lon: 1 }, { lat: 91, lon: 0 }]) {
    const c = Cap.getAdvancedCapabilities(l); assert.ok(Object.values(c).every((x) => x === false), JSON.stringify(l));
  }
});
test('capability: flood varsayılan false (doğrulanmamış); yalnızca doğrulanmış uygun karar true yapar', () => {
  assert.equal(Cap.getAdvancedCapabilities(ANKARA).flood, false);
  assert.equal(Cap.getAdvancedCapabilities(ANKARA, { floodVerdict: { available: true, confidence: 'high' } }).flood, true);
  assert.equal(Cap.getAdvancedCapabilities(ANKARA, { floodVerdict: { available: false, confidence: 'high', reason: 'x' } }).flood, false);
});

// ================= Flood uygunluğu =================
test('flood suitability: yakın hücre + yeterli akım → available; uzak hücre / küçük akım / kıyı / veri yok → değil', () => {
  const L = { lat: 40.0, lon: 33.0 };
  const good = Flood.suitability(L, floodBody(40.01, 33.01, [40, 42, 45, 44]));
  assert.equal(good.available, true); assert.equal(good.confidence, 'high');
  const mid = Flood.suitability(L, floodBody(40.05, 33.03, [10, 11, 12]));
  assert.equal(mid.available, true); assert.equal(mid.confidence, 'medium');
  const far = Flood.suitability(L, floodBody(40.3, 33.0, [100, 100]));
  assert.equal(far.available, false); assert.match(far.reason, /uzak/);
  const tiny = Flood.suitability(L, floodBody(40.0, 33.0, [0.3, 0.2, 0.4]));
  assert.equal(tiny.available, false); assert.match(tiny.reason, /anlamlı/);
  const none = Flood.suitability(L, floodBody(40.0, 33.0, [null, null]));
  assert.equal(none.available, false);
  const weak = Flood.suitability(L, floodBody(40.07, 33.05, [3, 3, 3]));   // snap ~9 km, 3 m³/s
  assert.equal(weak.available, false); assert.equal(weak.confidence, 'low');
  const coast = Flood.suitability(ANTALYA, floodBody(36.88, 30.7, [20, 20, 20]));   // kıyıda, küçük akım → şüpheli eşleşme
  assert.equal(coast.available, false); assert.match(coast.reason, /kıyı/i);
});
test('flood: uygunsuz konum → status unavailable + önbellekte olumsuz karar; capability false kalır', async () => {
  const e = env({ body: floodBody(40.0, 33.0, [0.1, 0.1, 0.1]) }); e.rt.setFlag('flood', true);
  const r = await e.rt.run(Flood, { lat: 40, lon: 33 });
  assert.equal(r.status, 'unavailable'); assert.equal(r.meta.suitability.available, false);
  const r2 = await e.rt.run(Flood, { lat: 40, lon: 33 });
  assert.equal(e.calls.length, 1, 'olumsuz karar da önbelleğe alınır (boşuna tekrar sorulmaz)'); assert.equal(r2.meta.cache, 'hit');
  const A = Advanced.create(e.rt); assert.equal(A.capabilities({ lat: 40, lon: 33 }).flood, false);
});
test('flood: uygun konum → ok ve capability.flood true olur; "API cevap verdi" tek başına yetmez', async () => {
  const e = env({ body: floodBody(40.01, 33.01, [40, 42, 45, 60]) }); e.rt.setFlag('flood', true);
  const A = Advanced.create(e.rt), L = { lat: 40, lon: 33 };
  assert.equal(A.capabilities(L).flood, false);
  const r = await A.load('flood', L);
  assert.equal(r.status, 'ok'); assert.equal(r.data.suitability.available, true); assert.equal(r.data.discharge.trend, 'rising');
  assert.equal(A.capabilities(L).flood, true);
  assert.equal(Object.keys(r.data).includes('risk'), false, 'taşkın riski/uyarısı üretilmez');
});

// ================= Marine =================
test('marine: iç bölgede istek atılmaz (unavailable), kıyıda atılır; kara hücresi (null) → unavailable', async () => {
  const e = env({ body: marineBody(Array(24).fill(0.6)) }); e.rt.setFlag('marine', true);
  const inland = await e.rt.run(Marine, ANKARA);
  assert.equal(inland.status, 'unavailable'); assert.equal(e.calls.length, 0);
  const coast = await e.rt.run(Marine, ANTALYA);
  assert.equal(coast.status, 'ok'); assert.equal(coast.data.now.waveHeight, 0.6); assert.equal(e.calls.length, 1);
  const e2 = env({ body: marineBody(Array(24).fill(null)) }); e2.rt.setFlag('marine', true);
  const land = await e2.rt.run(Marine, ANTALYA);
  assert.equal(land.status, 'unavailable'); assert.match(land.meta.reason, /deniz verisi yok/);
});

// ================= Ensemble =================
test('ensemble: üyeler arası yayılım ve kademe; az üye (tek model) → unavailable', async () => {
  const lo = Ens.parse(ensBody(20, 0.3));
  assert.equal(lo.data.confidence, 'high'); assert.ok(lo.data.temperatureSpread < 1.5); assert.equal(lo.data.days.length, 5);
  const hi = Ens.parse(ensBody(20, 4));
  assert.equal(hi.data.confidence, 'low');
  const mid = Ens.parse(ensBody(20, 2));
  assert.equal(mid.data.confidence, 'medium');
  const single = Ens.parse(ensBody(3, 1));
  assert.ok(single.unavailable && /ensemble sayılmaz/.test(single.unavailable));
  assert.equal(Ens.parse({ hourly: { time: ['2026-10-13T00:00'], temperature_2m: [10] } }).unavailable != null, true);
  assert.ok(!('percent' in lo.data) && !JSON.stringify(lo).includes('%'), 'sahte yüzde güven yok');
});
test('ensemble: istek tek modelli ensemble ister', () => {
  const u = Ens.url(ANKARA); assert.match(u, /ensemble-api\.open-meteo\.com\/v1\/ensemble\?/); assert.match(u, /models=ecmwf_ifs025/);
});

// ================= Climate / Seasonal / AQ =================
test('climate: onyıl özetleri 2030/2040/2050, ayrı API; günlük tahmin alanı yok', () => {
  const time = [], t = [], p = [];
  for (let y = 2021; y <= 2050; y++) for (let d = 0; d < 365; d++) { time.push(`${y}-01-01`.replace('01-01', '01-01')); t.push(10 + (y - 2021) * 0.05); p.push(1); }
  time.length = 0; for (let y = 2021; y <= 2050; y++) for (let d = 0; d < 365; d++) time.push(`${y}-06-15`);
  const r = Climate.parse({ daily: { time, temperature_2m_mean: t, precipitation_sum: p } });
  assert.deepEqual(r.data.decades.map((d) => d.label), [2030, 2040, 2050]); assert.equal(r.data.kind, 'projection');
  assert.ok(r.data.tempChangeSpanC > 0.9 && r.data.tempChangeSpanC < 1.1); assert.equal(r.data.decades[0].precipPerYear, 365);
  assert.match(Climate.url(ANKARA), /climate-api\.open-meteo\.com\/v1\/climate/); assert.equal(Climate.parse({ daily: { time: ['2030-01-01'], temperature_2m_mean: [1] } }).unavailable != null, true);
  assert.doesNotMatch(Climate.url(ANKARA), /archive/);
});
test('seasonal: yalnızca anomali/eğilim; mutlak günlük değer yok; üye anahtarları ortalanır', () => {
  const r = Seasonal.parse({ weekly: { time: ['2026-10-19', '2026-10-26'], temperature_2m_anomaly: [1.2, 0.8], precipitation_anomaly: [-3, -4] }, monthly: { time: ['2026-11'], temperature_2m_anomaly_member01: [0.2], temperature_2m_anomaly_member02: [0.4] } });
  assert.equal(r.data.kind, 'anomaly'); assert.equal(r.data.weekly.trend.temperature, 'warmer'); assert.equal(r.data.weekly.trend.precipitation, 'drier');
  assert.equal(r.data.monthly.trend.temperature, 'near'); assert.equal(r.data.monthly.rows[0].tempAnomaly, 0.3);
  assert.ok(!/temperature_2m_(max|min|mean)|daily/.test(JSON.stringify(r.data)));
  assert.ok(Seasonal.parse({ weekly: { time: ['x'] } }).unavailable);
});
test('airquality: ortak EAQI sınıfı, kötüleşme penceresi, trend; kirletici/polen için sınıf uydurulmaz', () => {
  const time = Array.from({ length: 36 }, (_, i) => `2026-10-13T${String(i % 24).padStart(2, '0')}:00`.replace('2026-10-13', i < 24 ? '2026-10-13' : '2026-10-14'));
  const aqi = time.map((_, i) => i < 4 ? 30 : i < 9 ? 45 + (i - 4) * 5 : 70);   // 30 → ... 65 → 70 (sınıf 1 → 2 → 3)
  const r = AQ.parse({ current: { time: time[0], european_aqi: 30, pm2_5: 8.44, pm10: 12, ozone: 60, nitrogen_dioxide: 14 }, hourly: { time, european_aqi: aqi, birch_pollen: time.map(() => null), grass_pollen: time.map(() => 3) } });
  assert.equal(r.data.now.level, EAQI.level(30)); assert.equal(r.data.now.label, EAQI.label(30));
  assert.equal(r.data.trend.direction, 'worsening'); assert.ok(r.data.worseningWindow.level > r.data.now.level);
  assert.equal(r.data.worseningWindow.from, time[4]);
  assert.deepEqual(r.data.pollutants, { pm25: 8.4, pm10: 12, o3: 60, no2: 14 }); assert.deepEqual(r.data.pollen, { grass: 3 });
  assert.equal(r.data.peak.level, EAQI.level(70));
  const src = require('node:fs').readFileSync(new URL('../../advanced/airquality.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\b(20|40|60|80|100)\b\s*[,\]]\s*(\d+)/, 'EAQI eşik dizisi yeniden tanımlanmaz');
  assert.ok(AQ.parse({ hourly: { time: ['x'], european_aqi: [null] } }).unavailable);
});

// ================= Önbellek =================
test('cache: taze → ağ yok; süre dolunca yeniden çek; yeni veri eskisini değiştirir', async () => {
  const e = env({ body: marineBody(Array(24).fill(1)) }); e.rt.setFlag('marine', true);
  const ttl = Cfg.CACHE.marine.ttl;
  const a = await e.rt.run(Marine, ANTALYA); assert.equal(a.meta.cache, 'miss'); assert.equal(a.stale, false);
  e.t += ttl - 1; const b = await e.rt.run(Marine, ANTALYA);
  assert.equal(e.calls.length, 1); assert.equal(b.meta.cache, 'hit'); assert.equal(b.fetchedAt, a.fetchedAt);
  e.t += 2; await e.rt.run(Marine, ANTALYA); assert.equal(e.calls.length, 2, 'ttl bitince yenilenir');
});
test('cache: modül başına farklı süreler (climate ≫ seasonal > marine/flood > ensemble)', () => {
  const C = Cfg.CACHE;
  assert.ok(C.climate.ttl > C.seasonal.ttl && C.seasonal.ttl > C.flood.ttl && C.flood.ttl >= C.ensemble.ttl && C.ensemble.ttl > C.airquality.ttl);
  for (const k of Object.keys(C)) assert.ok(C[k].staleMax > C[k].ttl && C[k].max >= 1, k);
});
test('cache: çevrimdışı → eski veri stale:true; ömrü aşıldıysa veya yoksa sessiz unavailable/offline', async () => {
  const e = env({ body: marineBody(Array(24).fill(1)) }); e.rt.setFlag('marine', true);
  await e.rt.run(Marine, ANTALYA); e.online = false;
  e.t += Cfg.CACHE.marine.ttl + 5; const s = await e.rt.run(Marine, ANTALYA);
  assert.equal(s.status, 'ok'); assert.equal(s.stale, true); assert.equal(s.meta.cache, 'stale'); assert.equal(e.calls.length, 1);
  e.t += Cfg.CACHE.marine.staleMax; const old = await e.rt.run(Marine, ANTALYA);
  assert.equal(old.status, 'unavailable'); assert.equal(old.meta.reason, 'offline');
  const none = await e.rt.run(Marine, { lat: 36.2, lon: 29.64 }); assert.equal(none.status, 'unavailable'); assert.equal(none.meta.reason, 'offline'); assert.equal(e.calls.length, 1);
});
test('cache: ağ hatasında eski veri varsa stale ok, yoksa status error; sessiz (fırlatmaz)', async () => {
  let fail = false; const e = env({ fetch: (u) => fail ? Promise.reject(new Error('down')) : Promise.resolve(new Response(JSON.stringify(marineBody(Array(24).fill(1))))) });
  e.rt.setFlag('marine', true);
  const bad = await e.rt.run(Marine, { lat: 36.2, lon: 29.64 }); fail = true;
  const first = await e.rt.run(Marine, { lat: 36.3, lon: 30.15 }); assert.equal(first.status, 'error'); assert.equal(first.meta.reason, 'network');
  e.t += Cfg.CACHE.marine.ttl + 1; const st = await e.rt.run(Marine, { lat: 36.2, lon: 29.64 });
  assert.equal(st.status, 'ok'); assert.equal(st.stale, true); assert.equal(st.meta.error, 'network'); assert.equal(bad.status, 'ok');
});
test('cache: HTTP 5xx → error (önbelleğe yazılmaz); HTTP 400 → unavailable (olumsuz önbellek)', async () => {
  const e5 = env({ status: 503 }); e5.rt.setFlag('marine', true);
  const r5 = await e5.rt.run(Marine, ANTALYA); assert.equal(r5.status, 'error'); assert.equal(r5.meta.reason, 'http-503');
  await e5.rt.run(Marine, ANTALYA); assert.equal(e5.calls.length, 2, 'hata önbelleğe yazılmaz');
  const e4 = env({ status: 400, body: { error: true, reason: 'Parametre geçersiz' } }); e4.rt.setFlag('marine', true);
  const r4 = await e4.rt.run(Marine, ANTALYA); assert.equal(r4.status, 'unavailable'); assert.equal(r4.meta.reason, 'Parametre geçersiz');
  await e4.rt.run(Marine, ANTALYA); assert.equal(e4.calls.length, 1);
});
test('cache: bozuk kayıt temizlenir; büyük yük saklanmaz; konum sayısı tavanı (max) aşılmaz; yalnızca küçük özet saklanır', async () => {
  const e = env({ body: marineBody(Array(24).fill(1)) }); e.rt.setFlag('marine', true);
  await e.rt.run(Marine, ANTALYA);
  const k = e.rt.storage.keys().find((x) => x.startsWith(Cfg.KEY_PREFIX + 'marine:'));
  assert.ok(k); assert.ok(e.rt.storage.get(k).length < 1500, 'ham 24 saatlik yük değil, özet saklanır'); assert.equal(e.rt.storage.get(k).includes('wave_direction'), false);
  e.rt.storage.set(k, '{bozuk'); await e.rt.run(Marine, ANTALYA); assert.equal(e.calls.length, 2);
  for (let i = 0; i < 12; i++) { e.t += 1000; await e.rt.run(Marine, { lat: 36.8 + i * 0.01, lon: 30.65 + i * 0.01 }); }
  assert.ok(e.rt.storage.keys().filter((x) => x.startsWith(Cfg.KEY_PREFIX + 'marine:')).length <= Cfg.CACHE.marine.max);
  const big = { name: 'marine', version: 1, applicable: () => ({ ok: true }), key: () => 'big', url: () => 'u', parse: () => ({ data: { x: 'a'.repeat(Cfg.MAX_ENTRY_BYTES + 10) } }) };
  const e2 = env({ body: {} }); e2.rt.setFlag('marine', true);
  const r = await e2.rt.run(big, ANTALYA); assert.equal(r.status, 'ok'); assert.equal(r.meta.cacheSkipped, true); assert.equal(e2.rt.storage.keys().length, 0);
});
test('cache: aynı anda aynı uç nokta → tek ağ isteği (duplicate yok)', async () => {
  const e = gated(); e.rt.setFlag('marine', true);
  const p1 = e.rt.run(Marine, ANTALYA), p2 = e.rt.run(Marine, ANTALYA), p3 = e.rt.run(Marine, { lat: 36.8801, lon: 30.7004 });   // anahtar 2 hane → aynı
  await tick(); assert.equal(e.calls.length, 1); e.pending[0].ok(marineBody(Array(24).fill(1)));
  const [a, b, c] = await Promise.all([p1, p2, p3]); assert.equal(a.status, 'ok'); assert.strictEqual(a, b); assert.strictEqual(a, c);
});

// ================= İstek yönetimi =================
test('request: şehir değişince eski yanıt yenisinin üstüne yazmaz (iptal + superseded)', async () => {
  const e = gated(); e.rt.setFlag('marine', true);
  const pA = e.rt.run(Marine, ANTALYA); await tick();                 // A ağa çıktı
  const pB = e.rt.run(Marine, { lat: 41.0, lon: 39.72 }); await tick();
  assert.equal(e.pending.length, 2);
  e.pending[1].ok(marineBody(Array(24).fill(2)));            // yeni şehir önce döner
  const b = await pB; assert.equal(b.status, 'ok'); assert.equal(b.data.now.waveHeight, 2);
  const a = await pA; assert.equal(a.status, 'unavailable'); assert.equal(a.meta.reason, 'superseded');   // eski: iptal edildi
  assert.equal(e.rt.stats.superseded, 1);
  assert.equal(e.rt.readCached(Marine, ANTALYA), null, 'iptal edilen şehrin verisi hiç yazılmadı');
});
test('request: ağa çıkmadan iptal edilen istek hiç atılmaz', async () => {
  const e = gated(); e.rt.setFlag('marine', true);
  const pA = e.rt.run(Marine, ANTALYA), pB = e.rt.run(Marine, { lat: 41.0, lon: 39.72 }); await tick();
  assert.equal(e.calls.length, 1); e.pending[0].ok(marineBody(Array(24).fill(2)));
  assert.equal((await pA).meta.reason, 'superseded'); assert.equal((await pB).status, 'ok');
});
test('request: AbortController olmasa da (yanıt sonradan gelse bile) eski yanıt superseded olur', async () => {
  const e = env({ fetch: (u) => new Promise((ok) => { e.calls.push(u); e.pending.push(() => ok(new Response(JSON.stringify(marineBody(Array(24).fill(1)))))); }) });
  const AC = globalThis.AbortController; globalThis.AbortController = undefined;
  try {
    e.rt.setFlag('marine', true);
    const pA = e.rt.run(Marine, ANTALYA), pB = e.rt.run(Marine, { lat: 41.0, lon: 39.72 }); await tick();
    e.pending.forEach((f) => f()); const [a, b] = await Promise.all([pA, pB]);
    assert.equal(a.meta.reason, 'superseded'); assert.equal(b.status, 'ok');
  } finally { globalThis.AbortController = AC; }
});
test('request: cancel() bekleyen isteği iptal eder; zaman aşımı → error/timeout', async () => {
  const e = gated(); e.rt.setFlag('marine', true);
  const p = e.rt.run(Marine, ANTALYA); await tick(); e.rt.cancel(); const r = await p; assert.equal(r.status, 'unavailable'); assert.equal(r.meta.reason, 'superseded');
  const e2 = gated(); e2.rt.setFlag('marine', true);
  const realTimeout = globalThis.setTimeout; globalThis.setTimeout = (f, ms) => realTimeout(f, ms === Cfg.TIMEOUT_MS ? 5 : ms);
  try { const t = await e2.rt.run(Marine, ANTALYA); assert.equal(t.status, 'error'); assert.equal(t.meta.reason, 'timeout'); } finally { globalThis.setTimeout = realTimeout; }
});

// ================= Bayraklar =================
test('flags: hepsi kapalı; kapalı modül fetch/depolama yapmaz; açılınca çalışır; modül bazlı bağımsız', async () => {
  assert.ok(Object.values(Cfg.FEATURES).every((v) => v === false));
  const e = env({ body: marineBody(Array(24).fill(1)) }); const A = Advanced.create(e.rt);
  for (const n of Object.keys(Cfg.FEATURES)) { const r = await A.load(n, ANTALYA); assert.equal(r.status, 'unavailable'); assert.equal(r.meta.reason, 'disabled'); }
  assert.equal(e.calls.length, 0); assert.equal(e.rt.storage.keys().length, 0);
  A.setFlag('marine', true);
  assert.equal((await A.load('marine', ANTALYA)).status, 'ok'); assert.equal(e.calls.length, 1);
  assert.equal((await A.load('flood', ANTALYA)).meta.reason, 'disabled'); assert.equal(e.calls.length, 1);
  A.setFlag('marine', false); assert.equal((await A.load('marine', { lat: 36.2, lon: 29.64 })).meta.reason, 'disabled');
  assert.equal((await A.load('olmayan', ANTALYA)).meta.reason, 'unknown-module');
  assert.equal(A.setFlag('olmayan', true), undefined);
});
test('flags: varsayılan Advanced tekili ve yapılandırma kirlenmez (çalışma zamanı bayrakları kopyadır)', () => {
  const A = Advanced.create(); A.setFlag('ensemble', true);
  assert.equal(Cfg.FEATURES.ensemble, false); assert.equal(Advanced.isOn('ensemble'), false);
  assert.ok(Object.values(Cfg.TIER).every((t) => t === 'advanced'), 'katman etiketi yalnızca hazırlık; kilit/rozet yok');
});

// ================= Normalize çıktı sözleşmesi =================
test('çıktı sözleşmesi: ok / unavailable / error aynı alanlara sahip', async () => {
  const keys = ['data', 'fetchedAt', 'meta', 'module', 'source', 'stale', 'status'];
  const e = env({ body: marineBody(Array(24).fill(1)) }); e.rt.setFlag('marine', true);
  const ok = await e.rt.run(Marine, ANTALYA);
  const un = await e.rt.run(Marine, ANKARA);
  const e2 = env({ status: 500 }); e2.rt.setFlag('marine', true); const er = await e2.rt.run(Marine, ANTALYA);
  for (const r of [ok, un, er]) { assert.deepEqual(Object.keys(r).sort(), keys); assert.equal(r.source, 'open-meteo'); assert.equal(typeof r.stale, 'boolean'); }
  assert.deepEqual([ok.status, un.status, er.status], ['ok', 'unavailable', 'error']);
  assert.ok(ok.fetchedAt > 0 && ok.data && un.data === null && er.data === null);
});
test('geçersiz konum → unavailable/bad-location, ağ yok', async () => {
  const e = env(); const A = Advanced.create(e.rt); A.setFlag('ensemble', true);
  const r = await A.load('ensemble', { lat: NaN, lon: 1 }); assert.equal(r.meta.reason, 'bad-location'); assert.equal(e.calls.length, 0);
});
test('ensemble uçtan uca: bayrak açık → ok, ikinci çağrı önbellekten', async () => {
  const e = env({ body: ensBody(20, 0.3) }); const A = Advanced.create(e.rt); A.setFlag('ensemble', true);
  const a = await A.load('ensemble', ANKARA), b = await A.load('ensemble', ANKARA);
  assert.equal(a.status, 'ok'); assert.equal(b.meta.cache, 'hit'); assert.equal(e.calls.length, 1);
  assert.ok(JSON.stringify(a).length < 3000, 'saklanan/dönen özet küçük');
});
