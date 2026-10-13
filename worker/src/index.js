// Cloudflare Worker "hava-uyari": abonelik uçları + 30 dakikada bir çalışan uyarı kontrolü.
// Gerekli bağlama: KV (adı "KV"). İsteğe bağlı değişkenler: ALLOWED_ORIGIN, MAX_SUBS, VAPID_SUBJECT.
import { evaluateCity, selectNotifications, T } from './rules.js';
import { sendPush, generateVapid, allowedEndpoint, b64uEnc } from './webpush.js';

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

export async function handleRequest(req, env, deps) {
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

export async function runCron(env, deps) {
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

export default {
  fetch: (req, env) => handleRequest(req, env),
  scheduled: (event, env, ctx) => { ctx.waitUntil(runCron(env)); }
};
