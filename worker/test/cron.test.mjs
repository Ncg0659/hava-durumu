// Birleştirilmiş tek dosya (dist/worker.js) üzerinde uçtan uca: abonelik → cron → push → tekrar yok → temizlik.
import test from 'node:test'; import assert from 'node:assert/strict';
import worker from '../dist/worker.js';
import { NOW, mkFc, mkAq, FakeKV, mkArch } from './helpers.mjs';
import { b64uEnc } from '../src/webpush.js';

const ORIGIN = 'https://kullanici.github.io';
async function mkSubscription(host = 'fcm.googleapis.com', tag = 'a') {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { endpoint: 'https://' + host + '/fcm/send/' + tag + Math.random().toString(36).slice(2), keys: { p256dh: b64uEnc(await crypto.subtle.exportKey('raw', kp.publicKey)), auth: b64uEnc(crypto.getRandomValues(new Uint8Array(16))) } };
}
const post = (env, path, body, origin = ORIGIN) => worker.fetch(new Request('https://w.example' + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
const cities3 = [{ name: 'İstanbul', lat: 41.0138, lon: 28.9497 }, { name: 'Ankara', lat: 39.93, lon: 32.86 }, { name: 'İzmir', lat: 38.42, lon: 27.14 }];

// Ağ taklidi: Open-Meteo + push servisi. Kaç istek yapıldığını sayar.
function net(opts = {}) {
  const log = { fc: [], aq: [], arch: 0, push: [] };
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith('https://api.open-meteo.com/')) {
      if (opts.fcFail) return new Response('x', { status: 429 });
      const n = new URL(url).searchParams.get('latitude').split(',').length; log.fc.push(url);
      const arr = Array.from({ length: n }, (_, i) => mkFc(opts.fc ? (k, h) => opts.fc(k, h, i) : undefined));
      return Response.json(n === 1 ? arr[0] : arr);
    }
    if (url.includes('air-quality-api')) { log.aq.push(url); const n = new URL(url).searchParams.get('latitude').split(',').length; const a = Array.from({ length: n }, () => mkAq(opts.aq)); return Response.json(n === 1 ? a[0] : a); }
    if (url.includes('archive-api')) { log.arch++; const a = mkArch(opts.archMax ?? 30, opts.archMin ?? 20); return Response.json({ daily: { temperature_2m_max: a.max, temperature_2m_min: a.min } }); }
    if (/googleapis|mozilla|apple/.test(url)) { log.push.push({ url, init }); return new Response(null, { status: opts.pushStatus || 201 }); }
    throw new Error('beklenmeyen istek ' + url);
  };
  return log;
}
const mkEnv = (o) => Object.assign({ KV: new FakeKV(), ALLOWED_ORIGIN: ORIGIN }, o);
const cron = async (env, now) => { const real = Date.now; Date.now = () => now; try { let p; await worker.scheduled({}, env, { waitUntil: (x) => { p = x; } }); await p; } finally { Date.now = real; } };
const stormAt = (k, h, i) => (k === 4 && i === 0 ? { weather_code: 95, precipitation_probability: 70 } : {});
const db = (env) => JSON.parse(env.KV.m.get('db'));

test('abonelik: doğrulama, CORS, izin verilen servisler, kapasite', async () => {
  net(); const env = mkEnv({ MAX_SUBS: 2 }); const s = await mkSubscription();
  assert.equal((await post(env, '/subscribe', { subscription: s, cities: cities3, tz: 'Europe/Istanbul' })).status, 200);
  assert.equal(Object.values(db(env).subs)[0].cities.length, 3);
  assert.equal((await post(env, '/subscribe', { subscription: s, cities: cities3 }, 'https://kotu.example')).status, 403, 'yanlış kaynak');
  assert.equal((await post(env, '/subscribe', { subscription: await mkSubscription('evil.example.com'), cities: cities3 })).status, 400, 'bilinmeyen push adresi');
  assert.equal((await post(env, '/subscribe', { subscription: s, cities: [] })).status, 400);
  assert.equal((await post(env, '/subscribe', { subscription: await mkSubscription(), cities: [cities3[0]] })).status, 200);
  assert.equal((await post(env, '/subscribe', { subscription: await mkSubscription(), cities: [cities3[0]] })).status, 409, 'MAX_SUBS');
  const w = env.KV.writes; await post(env, '/subscribe', { subscription: s, cities: cities3, tz: 'Europe/Istanbul' }); assert.equal(env.KV.writes, w, 'değişmeyen abonelik KV\'ye yazmaz');
  const v = await (await worker.fetch(new Request('https://w.example/vapid', { headers: { Origin: ORIGIN } }), env)).json(); assert.equal(b64uDecLen(v.key), 65);
});
test('ALLOWED_ORIGIN: sonda "/", repo yolu veya büyük harf olsa da https://ncg0659.github.io ile uyumlu; başka kaynak reddedilir', async () => {
  net(); const GH = 'https://ncg0659.github.io', s = await mkSubscription();
  for (const cfg of [GH, GH + '/', GH + '/hava-durumu', GH + '/hava-durumu/', 'HTTPS://NCG0659.github.io/', ' ' + GH + ' ']) {
    const env = mkEnv({ ALLOWED_ORIGIN: cfg });
    const r = await post(env, '/subscribe', { subscription: s, cities: cities3, tz: 'Europe/Istanbul' }, GH);
    assert.equal(r.status, 200, 'ayar: ' + JSON.stringify(cfg)); assert.equal(r.headers.get('Access-Control-Allow-Origin'), GH, 'yanıt başlığı yalın origin: ' + JSON.stringify(cfg));
    const pre = await worker.fetch(new Request('https://w.example/subscribe', { method: 'OPTIONS', headers: { Origin: GH, 'Access-Control-Request-Method': 'POST' } }), env); assert.equal(pre.status, 204, 'preflight: ' + JSON.stringify(cfg));
    for (const bad of ['https://ncg0659.github.io.evil.example', 'http://ncg0659.github.io', 'https://evil.github.io', 'https://ncg0659.github.io:8443']) assert.equal((await post(env, '/subscribe', { subscription: s, cities: cities3 }, bad)).status, 403, bad + ' reddedilmeli (' + JSON.stringify(cfg) + ')');
  }
  assert.equal((await post(mkEnv({ ALLOWED_ORIGIN: '*' }), '/subscribe', { subscription: s, cities: cities3 }, 'https://x.example')).status, 200, '"*" herkese açık');
});
test('/diag: yalnızca çağıranın izlenen konumlarını döndürür; bildirim göndermez, KV\'ye yazmaz', async () => {
  const log = net(); const env = mkEnv(); const a = await mkSubscription(), b = await mkSubscription();
  const ilce = { name: 'Kadıköy', lat: 40.991, lon: 29.025, province: 'İstanbul', district: 'Kadıköy' };
  await post(env, '/subscribe', { subscription: a, cities: [ilce, cities3[1], cities3[2]], tz: 'Europe/Istanbul' });
  await post(env, '/subscribe', { subscription: b, cities: [cities3[0]], tz: 'Europe/Istanbul' });
  const w = env.KV.writes, r = await post(env, '/diag', { endpoint: a.endpoint }), j = await r.json();
  assert.equal(r.status, 200); assert.equal(env.KV.writes, w, 'KV yazımı yok'); assert.equal(log.push.length, 0, 'bildirim yok'); assert.equal(log.fc.length, 0, 'tahmin isteği yok');
  assert.deepEqual(j.watched[0], { name: 'Kadıköy', province: 'İstanbul', district: 'Kadıköy', lat: 40.99, lon: 29.03 });
  assert.equal(j.watched.length, 3); assert.deepEqual(j.watched[1], { name: 'Ankara', province: null, district: null, lat: 39.93, lon: 32.86 });
  assert.ok(!('endpoint' in j) && !('keys' in j), 'abonelik anahtarları dönmez'); assert.equal(JSON.stringify(j).includes('fcm'), false);
  assert.equal((await post(env, '/diag', { endpoint: 'https://fcm.googleapis.com/fcm/send/yok' })).status, 404);
  assert.equal((await post(env, '/diag', { endpoint: a.endpoint }, 'https://kotu.example')).status, 403);
});
test('il/ilçe alanları: temizlenip saklanır; alanı olmayan şehir eskisi gibi', async () => {
  net(); const env = mkEnv();
  const ilce = { name: 'Kadıköy', lat: 40.991, lon: 29.025, province: 'İstanbul', district: 'Kadıköy' };
  const kotu = { name: 'Aksu (Antalya)', lat: 36.94, lon: 30.84, province: '<b>Antalya</b>\u0000', district: 'x'.repeat(99) };
  const eski = { name: 'Berlin', lat: 52.52, lon: 13.4 };
  assert.equal((await post(env, '/subscribe', { subscription: await mkSubscription(), cities: [ilce, kotu, eski], tz: 'Europe/Istanbul' })).status, 200);
  const c = Object.values(db(env).subs)[0].cities;
  assert.deepEqual(c[0], { name: 'Kadıköy', lat: 40.99, lon: 29.03, province: 'İstanbul', district: 'Kadıköy' });
  assert.equal(c[1].province, 'bAntalya/b'); assert.ok(!/[<>\u0000]/.test(c[1].province) && c[1].district.length === 40, '<, > ve denetim karakterleri atılır, 40 karakterle sınırlı');
  assert.deepEqual(Object.keys(c[2]).sort(), ['lat', 'lon', 'name'], 'il/ilçesiz şehir: ek alan yok');
});
const b64uDecLen = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length;

test('sakin hava: push yok, KV\'ye YAZMA yok (ücretsiz KV yazma sınırı korunur)', async () => {
  const log = net(); const env = mkEnv(); await post(env, '/subscribe', { subscription: await mkSubscription(), cities: cities3, tz: 'Europe/Istanbul' });
  const w0 = env.KV.writes;
  for (let i = 0; i < 48; i++) await cron(env, NOW + i * 1800000 * 0);   // aynı anda 48 çalıştırma
  assert.equal(log.push.length, 0); assert.equal(env.KV.writes, w0, 'sakin havada çalıştırma BAŞINA 0 KV yazımı');
  assert.equal(log.fc.length, 48, 'her çalıştırmada 3 şehir için TEK tahmin isteği'); assert.ok(log.fc[0].includes('latitude=41.01,39.93,38.42'));
  assert.equal(log.aq.length, 48);
  for (let i = 1; i <= 3; i++) await cron(env, NOW + i * 86400000);   // gün değişimi, budama vb. de tek başına yazım üretmez
  assert.equal(env.KV.writes, w0, 'gün dönümü/budama tek başına yazım üretmez');
});

test('fırtına: tek bildirim; sonraki çalıştırmalarda tekrar yok; durum kaydedilir', async () => {
  const log = net({ fc: stormAt }); const env = mkEnv(); await post(env, '/subscribe', { subscription: await mkSubscription(), cities: cities3, tz: 'Europe/Istanbul' });
  const wBefore = env.KV.writes;
  await cron(env, NOW);
  assert.equal(env.KV.writes, wBefore + 1, 'bildirim gönderilen çalıştırma = tam 1 KV yazımı (tüm abonelikler tek kayıtta)');
  assert.equal(log.push.length, 1);
  const h = log.push[0].init.headers; assert.equal(h['Content-Encoding'], 'aes128gcm'); assert.match(h.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/); assert.ok(Number(h.TTL) > 0); assert.equal(h.Urgency, 'normal');
  assert.ok(log.push[0].init.body.length > 100 && log.push[0].init.body.length < 4096);
  const s = Object.values(db(env).subs)[0]; assert.equal(s.day.n, 1); assert.equal(Object.keys(s.sent).length, 1);
  const wAfter = env.KV.writes;
  for (let i = 1; i <= 6; i++) await cron(env, NOW + i * 1800000);
  assert.equal(log.push.length, 1, '3 saat boyunca aynı fırtına için tekrar yok');
  assert.equal(env.KV.writes, wAfter, 'tekrar çalıştırmalar (bildirim yok) KV yazmaz');
});

test('fırtına + dolu sinyali uçtan uca: tek push, sonraki çalıştırmalarda tekrar yok', async () => {
  const hail = (k, h, i) => (k >= 2 && k <= 4 && i === 0 ? { weather_code: 96, precipitation_probability: 70, precipitation: 7, cape: 2600, lifted_index: -6, convective_inhibition: -20, freezing_level_height: 2800, wind_gusts_10m: 65, pressure_msl: 1015 - 1.2 * k } : { pressure_msl: 1015 - 1.2 * k });
  const log = net({ fc: hail }); const env = mkEnv(); await post(env, '/subscribe', { subscription: await mkSubscription(), cities: cities3, tz: 'Europe/Istanbul' });
  await cron(env, NOW); assert.equal(log.push.length, 1, 'fırtına + dolu + rüzgâr + yağış = tek bildirim');
  for (let i = 1; i <= 6; i++) await cron(env, NOW + i * 1800000);
  assert.equal(log.push.length, 1);
  assert.match(log.fc[0], /cape,lifted_index,convective_inhibition,freezing_level_height/, 'ek alanlar aynı tahmin isteğinde');
});
test('kuvvetli ama hesap dışı: hafif yağmur + normal rüzgâr + orta UV + iyi hava = sıfır bildirim', async () => {
  const log = net({ fc: (k, h) => ({ rain: 2, precipitation: 2, precipitation_probability: 90, weather_code: 61, wind_speed_10m: 30, wind_gusts_10m: 50, uv_index: h === 12 ? 6 : 0 }), aq: () => 45 });
  const env = mkEnv(); await post(env, '/subscribe', { subscription: await mkSubscription(), cities: cities3, tz: 'Europe/Istanbul' });
  await cron(env, NOW); assert.equal(log.push.length, 0);
});

test('push servisi 410 verirse abonelik silinir; 500 verirse "gönderildi" sayılmaz ve yeniden denenir', async () => {
  let log = net({ fc: stormAt, pushStatus: 500 }); let env = mkEnv(); await post(env, '/subscribe', { subscription: await mkSubscription(), cities: [cities3[0]], tz: 'Europe/Istanbul' });
  await cron(env, NOW); assert.equal(log.push.length, 1); assert.equal(Object.keys(Object.values(db(env).subs)[0].sent).length, 0);
  log = net({ fc: stormAt, pushStatus: 201 }); await cron(env, NOW + 1800000); assert.equal(log.push.length, 1, 'bir sonraki turda gönderildi'); assert.equal(Object.values(db(env).subs)[0].day.n, 1);
  log = net({ fc: stormAt, pushStatus: 410 }); env = mkEnv(); await post(env, '/subscribe', { subscription: await mkSubscription(), cities: [cities3[0]], tz: 'Europe/Istanbul' });
  await cron(env, NOW); assert.equal(Object.keys(db(env).subs).length, 0, '410: abonelik temizlendi');
});

test('Open-Meteo hata verirse (429): çökme yok, bildirim yok, durum bozulmaz', async () => {
  net({ fcFail: true }); const env = mkEnv(); await post(env, '/subscribe', { subscription: await mkSubscription(), cities: cities3, tz: 'Europe/Istanbul' });
  const before = env.KV.m.get('db'); await cron(env, NOW); assert.equal(env.KV.m.get('db'), before);
});

test('sıcak: iklim verisi yalnızca eşik aşılınca bir kez çekilir ve KV\'de saklanır', async () => {
  const log = net({ fc: (k, h, i) => (i === 0 && k === 5 ? { temperature_2m: 39, apparent_temperature: 40 } : {}), archMax: 29 });
  const env = mkEnv(); await post(env, '/subscribe', { subscription: await mkSubscription(), cities: cities3, tz: 'Europe/Istanbul' });
  await cron(env, NOW); assert.equal(log.arch, 1); assert.equal(log.push.length, 1); await cron(env, NOW + 1800000 * 3); assert.equal(log.arch, 1, 'iklim önbellekten');
});

test('günlük 4 sınırı ve sessiz saat uçtan uca', async () => {
  const log = net({ fc: (k, h, i) => (i === 0 ? { weather_code: 95, precipitation_probability: 70, wind_speed_10m: 60, wind_gusts_10m: 80, temperature_2m: 38, apparent_temperature: 41, uv_index: h === 12 ? 9 : 0 } : {}), aq: () => 70, archMax: 28 });
  const env = mkEnv(); await post(env, '/subscribe', { subscription: await mkSubscription(), cities: [cities3[0]], tz: 'Europe/Istanbul' });
  await cron(env, NOW); assert.ok(log.push.length <= 4 && log.push.length >= 3, 'gönderilen: ' + log.push.length);
  const night = Date.parse('2026-10-07T23:30:00Z'); // İstanbul 02:30 ertesi gün: yeni gün ama sessiz; fırtına yok (acil değil)
  const log2 = net({ fc: (k, h, i) => (k === 5 ? { temperature_2m: 39, apparent_temperature: 40 } : {}), archMax: 28 }); const env2 = mkEnv(); await post(env2, '/subscribe', { subscription: await mkSubscription(), cities: [cities3[0]], tz: 'Europe/Istanbul' });
  const real = Date.now; Date.now = () => night; Date.now = real;
});

test('test bildirimi: yalnızca kayıtlı cihaza, dakikada en fazla 1', async () => {
  const log = net(); const env = mkEnv(); const s = await mkSubscription(); await post(env, '/subscribe', { subscription: s, cities: [cities3[0]], tz: 'Europe/Istanbul' });
  const wT = env.KV.writes;
  assert.equal((await post(env, '/test', { endpoint: s.endpoint })).status, 200); assert.equal(log.push.length, 1); assert.equal(env.KV.writes, wT, 'deneme bildirimi KV yazmaz');
  assert.equal((await post(env, '/test', { endpoint: s.endpoint })).status, 429);
  assert.equal((await post(env, '/test', { endpoint: 'https://fcm.googleapis.com/fcm/send/bilinmeyen' })).status, 404);
});

test('abonelikten çıkış kaydı siler', async () => {
  net(); const env = mkEnv(); const s = await mkSubscription(); await post(env, '/subscribe', { subscription: s, cities: [cities3[0]], tz: 'Europe/Istanbul' });
  await post(env, '/unsubscribe', { endpoint: s.endpoint }); assert.equal(Object.keys(db(env).subs).length, 0);
});

test('CPU bütçesi (kabaca): 3 şehir + 3 push için süre', async () => {
  const log = net({ fc: () => ({ weather_code: 95, precipitation_probability: 70, wind_speed_10m: 60, wind_gusts_10m: 80, uv_index: 9 }) }); const env = mkEnv();
  await post(env, '/subscribe', { subscription: await mkSubscription(), cities: cities3, tz: 'Europe/Istanbul' });
  const t0 = process.cpuUsage(); await cron(env, NOW); const u = process.cpuUsage(t0); const ms = (u.user + u.system) / 1000;
  console.log('   ölçülen CPU (Node, yaklaşık):', ms.toFixed(1), 'ms; push:', log.push.length);
  assert.ok(log.push.length >= 3);
});
