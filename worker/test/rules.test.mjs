import test from 'node:test'; import assert from 'node:assert/strict';
import { evaluateCity, selectNotifications, climateMean, T, userParts } from '../src/rules.js';
import { NOW, mkFc, mkAq, city, mkArch } from './helpers.mjs';
const ev = (f, aq, clim, opt) => evaluateCity(city, mkFc(f, opt), aq || null, NOW, clim ? async () => clim : async () => null);
const types = (e) => e.map((x) => x.type);

test('sakin hava: hiç olay yok', async () => { assert.deepEqual(await ev(), []); });

test('yağış: hafif/orta yağmur bildirim üretmez; kuvvetli üretir', async () => {
  assert.deepEqual(types(await ev((k) => k >= 2 && k <= 5 ? { rain: 3, precipitation: 3, precipitation_probability: 90, weather_code: 63 } : {})), []);
  const e = await ev((k) => k === 3 ? { rain: 10, precipitation: 10, precipitation_probability: 80, weather_code: 65 } : {});
  assert.deepEqual(types(e), ['precip']); assert.match(e[0].body, /12:00–13:00/); assert.match(e[0].body, /10 mm/);
  assert.deepEqual(types(await ev((k) => k === 3 ? { rain: 10, precipitation: 10, precipitation_probability: 40 } : {})), [], 'olasılık düşükse yok');
  assert.deepEqual(types(await ev((k) => k === 8 ? { rain: 12, precipitation: 12, precipitation_probability: 90 } : {})), [], '6 saatten sonrası kapsam dışı');
});
test('yağış: 3 saatlik toplam ≥ 20 mm', async () => {
  assert.deepEqual(types(await ev((k) => k >= 1 && k <= 3 ? { rain: 7, precipitation: 7, precipitation_probability: 80 } : {})), ['precip']);
  assert.deepEqual(types(await ev((k) => k >= 1 && k <= 3 ? { rain: 6, precipitation: 6, precipitation_probability: 80 } : {})), []);
});
test('yoğun kar', async () => {
  const e = await ev((k) => k === 2 ? { snowfall: 2.5, precipitation: 2.5, precipitation_probability: 80, weather_code: 75, temperature_2m: -2 } : {});
  assert.equal(e[0].type, 'precip'); assert.match(e[0].title, /kar/i);
  assert.deepEqual(types(await ev((k) => k === 2 ? { snowfall: 1, precipitation_probability: 80, weather_code: 71 } : {})), []);
});
test('fırtına: kod 95 + olasılık; acil işareti', async () => {
  let e = await ev((k) => k === 4 ? { weather_code: 95, precipitation_probability: 60 } : {});
  assert.deepEqual(types(e), ['storm']); assert.equal(e[0].urgent, false);
  e = await ev((k) => k === 1 ? { weather_code: 96, precipitation_probability: 70 } : {}); assert.equal(e[0].urgent, true);
  assert.deepEqual(types(await ev((k) => k === 4 ? { weather_code: 95, precipitation_probability: 20 } : {})), []);
  assert.deepEqual(types(await ev((k) => k === 4 ? { weather_code: 80, precipitation_probability: 90 } : {})), [], 'sıradan sağanak fırtına sayılmaz');
});
test('rüzgâr: normal yok, kuvvetli var, çok kuvvetli acil', async () => {
  assert.deepEqual(types(await ev(() => ({ wind_speed_10m: 35, wind_gusts_10m: 60 }))), []);
  let e = await ev((k) => k === 5 ? { wind_speed_10m: 40, wind_gusts_10m: 72 } : {}); assert.deepEqual(types(e), ['wind']); assert.equal(e[0].urgent, false); assert.match(e[0].body, /72 km\/sa/);
  e = await ev((k) => k === 6 ? { wind_speed_10m: 52, wind_gusts_10m: 60 } : {}); assert.deepEqual(types(e), ['wind']);
  e = await ev((k) => k === 2 ? { wind_speed_10m: 60, wind_gusts_10m: 95 } : {}); assert.equal(e[0].urgent, true);
  assert.deepEqual(types(await ev((k) => k === 13 ? { wind_gusts_10m: 100 } : {})), [], '12 saatten sonrası yok');
});
test('sıcak: mutlak eşik + iklim kapısı (yalnızca eşik aşılınca iklim istenir)', async () => {
  let calls = 0; const clim = (a) => async () => { calls++; return a; };
  const hot = (T) => (k) => k === 5 ? { temperature_2m: T, apparent_temperature: T + 1 } : {};
  let e = await evaluateCity(city, mkFc(hot(36)), null, NOW, clim(mkArch(25, 15))); assert.deepEqual(types(e), []); assert.equal(calls, 0, '36° eşik altı: iklim sorgulanmaz');
  e = await evaluateCity(city, mkFc(hot(38)), null, NOW, clim(mkArch(30, 20))); assert.deepEqual(types(e), ['heat']); assert.equal(calls, 1); assert.match(e[0].body, /38°/); assert.match(e[0].body, /normalinin/);
  e = await evaluateCity(city, mkFc(hot(38)), null, NOW, clim(mkArch(36, 24))); assert.deepEqual(types(e), [], 'zaten hep sıcak yerde uyarma');
  assert.deepEqual(types(await ev(hot(38))), [], 'iklim yoksa 40° altı: yok');
  assert.deepEqual(types(await ev(hot(41))), ['heat'], 'iklim yoksa ≥40°: var');
});
test('soğuk', async () => {
  const cold = (T) => (k) => k === 17 ? { temperature_2m: T, apparent_temperature: T - 3 } : {};
  assert.deepEqual(types(await ev(cold(-5), null, mkArch(5, -2))), []);
  assert.deepEqual(types(await ev(cold(-9), null, mkArch(5, 0))), ['cold']);
  assert.deepEqual(types(await ev(cold(-9), null, mkArch(-5, -15))), [], 'zaten hep soğuk yerde uyarma');
  assert.deepEqual(types(await ev(cold(-9))), [], 'iklim yoksa ≤ −15 değilse yok');
  const e = await ev(cold(-16)); assert.deepEqual(types(e), ['cold']); assert.match(e[0].body, /−16°/); assert.match(e[0].body, /^Yarın/);
});
test('UV: push yalnızca aşırı (≥11); 8–10 uygulama içinde kalır', async () => {
  const uv = (v) => (k, hh) => hh === 12 ? { uv_index: v } : {};
  for (const v of [6, 8, 9.9, 10.9]) assert.deepEqual(types(await ev(uv(v))), [], 'UV ' + v + ' push değil');
  const e = await ev(uv(11)); assert.deepEqual(types(e), ['uv']); assert.match(e[0].title, /Aşırı UV/); assert.equal(e[0].urgent, false);
});
test('hava kalitesi: yalnızca EAQI ≥ 60', async () => {
  assert.deepEqual(types(await ev(undefined, mkAq(() => 59))), []);
  let e = await ev(undefined, mkAq((k) => (k === 3 ? 65 : 30))); assert.deepEqual(types(e), ['aqi']); assert.match(e[0].title, /^Hava kalitesi kötüleşebilir/);
  e = await ev(undefined, mkAq((k) => (k === 3 ? 85 : 30))); assert.match(e[0].title, /^Hava kalitesi kötüleşebilir/); assert.match(e[0].id, /vbad$/);   // sınıf/id tepe değerden
});
test('buzlanma: ıslak + ≤0°; dondurucu yağmur; kırağı; kuru soğuk yok', async () => {
  let e = await ev((k) => (k === 2 ? { rain: 1, precipitation: 1 } : k === 6 ? { temperature_2m: -1 } : {})); assert.deepEqual(types(e), ['frost']); assert.match(e[0].title, /Buzlanma/);
  assert.deepEqual(types(await ev((k) => (k === 6 ? { temperature_2m: -1 } : {}))), [], 'yağış yoksa buzlanma uyarısı yok');
  assert.deepEqual(types(await ev((k) => (k === 2 ? { rain: 1, precipitation: 1 } : k === 6 ? { temperature_2m: 2 } : {}))), []);
  e = await ev((k) => (k === 4 ? { weather_code: 66, precipitation_probability: 40 } : {})); assert.match(e[0].title, /Dondurucu/);
  e = await ev((k) => (k === 5 ? { weather_code: 48, temperature_2m: -2 } : {})); assert.deepEqual(types(e), ['frost']);
});
test('climateMean: ±7 gün penceresi', () => {
  const m = climateMean(mkArch(30, 20), 10, 7); assert.ok(Math.abs(m.max - 30) < 1e-9 && m.n > 50);
  assert.equal(climateMean(null, 10, 7), null);
});

// ---------- Seçim: tekrar, bekleme, sessiz saat, günlük sınır ----------
const mkSub = (o) => Object.assign({ tz: 'Europe/Istanbul', sent: {}, last: {}, day: { d: '', n: 0 } }, o);
const E = (type, id, o) => Object.assign({ type, id, urgent: false, title: type + ' · İstanbul', body: 'x' }, o);
const pc = (events) => [{ ci: '41.01,28.95', name: 'İstanbul', events }];
const apply = (sub, sel) => Object.assign({}, sub, sel.patch);

test('aynı olay için ikinci kez bildirim yok', () => {
  let sub = mkSub(); let sel = selectNotifications(sub, pc([E('storm', 'storm:2026-10-07:2')]), NOW); assert.equal(sel.send.length, 1);
  sub = apply(sub, sel); sel = selectNotifications(sub, pc([E('storm', 'storm:2026-10-07:2')]), NOW + 30 * 60000); assert.equal(sel.send.length, 0); assert.equal(sel.skipped[0].why, 'tekrar');
});
test('tahmin saati kayarsa (yeni kimlik) bekleme süresi tekrarı engeller; süre dolunca yeni olay gider', () => {
  let sub = mkSub(); let sel = selectNotifications(sub, pc([E('storm', 'storm:2026-10-07:2')]), NOW); sub = apply(sub, sel);
  sel = selectNotifications(sub, pc([E('storm', 'storm:2026-10-07:3')]), NOW + 2 * 3600000); assert.equal(sel.send.length, 0); assert.equal(sel.skipped[0].why, 'bekleme');
  sel = selectNotifications(sub, pc([E('storm', 'storm:2026-10-07:3')]), NOW + 7 * 3600000); assert.equal(sel.send.length, 1, 'ciddi olay bitip yenisi gelince tekrar gider');
});
test('sessiz saat: 23:00–07:00 arası acil olmayanlar bekler, acil olanlar geçer', () => {
  const night = Date.parse('2026-10-06T23:30:00Z');   // İstanbul 02:30
  assert.equal(userParts(night, 'Europe/Istanbul').hour, 2);
  let sel = selectNotifications(mkSub(), pc([E('heat', 'heat:2026-10-07'), E('storm', 'storm:2026-10-07:0', { urgent: true })]), night);
  assert.deepEqual(sel.send.map((x) => x.type), ['storm']); assert.equal(sel.skipped[0].why, 'sessiz-saat');
  assert.equal(sel.patch.sent['41.01,28.95|heat:2026-10-07'], undefined, 'ertelenen olay "gönderildi" sayılmaz; sabah yine denenir');
  const morning = Date.parse('2026-10-07T04:10:00Z');  // 07:10
  sel = selectNotifications(mkSub(), pc([E('heat', 'heat:2026-10-07')]), morning); assert.equal(sel.send.length, 1);
});
test('günlük sınır 4, öncelik sırasıyla', () => {
  const all = ['uv', 'aqi', 'cold', 'heat', 'frost', 'precip', 'wind', 'storm'].map((t) => E(t, t + ':2026-10-07:1'));
  const sel = selectNotifications(mkSub(), pc(all), NOW);
  assert.deepEqual(sel.send.map((x) => x.type), ['storm', 'wind', 'frost', 'heat'], 'precip fırtınayla birleşir; kalan öncelik sırasıyla');
  assert.ok(sel.skipped.every((s) => s.why === 'günlük-sınır'));
  const sub2 = apply(mkSub(), sel), sel2 = selectNotifications(sub2, pc(all), NOW + 3600000); assert.equal(sel2.send.length, 0, 'aynı gün 4 doldu');
  const next = selectNotifications(sub2, pc([E('heat', 'heat:2026-10-08')]), NOW + 24 * 3600000); assert.equal(next.send.length, 1, 'ertesi gün sayaç sıfırlanır');
});
test('fırtına varken aynı şehirde kuvvetli yağış ayrıca gönderilmez', () => {
  const sel = selectNotifications(mkSub(), pc([E('storm', 'storm:a:1'), E('precip', 'precip:a:1')]), NOW);
  assert.deepEqual(sel.send.map((x) => x.type), ['storm']);
});
test('UV: 72 saat içinde ikinci UV bildirimi yok (yaz gürültüsü)', () => {
  let sub = mkSub(), sel = selectNotifications(sub, pc([E('uv', 'uv:2026-10-07')]), NOW); assert.equal(sel.send.length, 1); sub = apply(sub, sel);
  sel = selectNotifications(sub, pc([E('uv', 'uv:2026-10-08')]), NOW + 24 * 3600000); assert.equal(sel.send.length, 0);
  sel = selectNotifications(sub, pc([E('uv', 'uv:2026-10-11')]), NOW + 73 * 3600000); assert.equal(sel.send.length, 1);
});
test('şehirler birbirinden bağımsız sayılır', () => {
  const two = [{ ci: 'a', name: 'A', events: [E('storm', 'storm:x:1')] }, { ci: 'b', name: 'B', events: [E('storm', 'storm:x:1')] }];
  assert.equal(selectNotifications(mkSub(), two, NOW).send.length, 2);
});

test('hava kalitesi: uygulama ve Worker AYNI EAQI sınıfını kullanır (tek tanım: eaqi.js)', async () => {
  const fs = await import('node:fs'), { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url), Insights = req('../../insights.js'), EAQI = req('../../eaqi.js');
  const insSrc = fs.readFileSync(new URL('../../insights.js', import.meta.url), 'utf8'), rulesSrc = fs.readFileSync(new URL('../src/rules.js', import.meta.url), 'utf8');
  // yinelenen tanım yok: eşik/etiket dizisi yalnızca eaqi.js'te
  assert.ok(!/v < 60 \? 2|AQ_LABEL = \[/.test(insSrc), 'insights.js kendi EAQI eşiği/etiketi tanımlamamalı');
  assert.deepEqual(Object.keys(T.aqi), ['horizonH'], 'Worker T.aqi sınıf eşiği tutmaz');
  assert.ok(!/pk\.v >= \d|veryBad|aqi:\s*\{[^}]*bad/.test(rulesSrc), 'rules.js EAQI sayısal eşiği tanımlamamalı');
  assert.deepEqual(EAQI.LABEL, ['Çok iyi', 'İyi', 'Orta', 'Kötü', 'Çok kötü', 'Aşırı kötü']);
  const lv = async (v) => (await ev(undefined, mkAq(() => v)))[0];
  // her değer için: uygulama kartı sınıfı === Worker başlığı sınıfı (bildirim yalnızca Kötü ve üstü)
  for (const v of [0, 19, 19.6, 20, 39.4, 39.5, 40, 59, 59.4, 59.5, 59.6, 60, 60.4, 70, 79.5, 80, 99, 99.5, 100, 140]) {
    const app = Insights.airQuality({ european_aqi: v }), w = await lv(v);
    assert.equal(app.label, EAQI.label(v), 'uygulama etiketi ' + v);
    if (EAQI.level(v) >= 3) assert.ok(w && w.title.startsWith(app.label), 'Worker başlığı uygulama sınıfıyla aynı olmalı: ' + v + ' → ' + (w && w.title) + ' / ' + app.label);
    else assert.equal(w, undefined, 'Worker yalnızca Kötü+ için bildirir: ' + v);
  }
  assert.equal(Insights.airQuality({ european_aqi: 60 }).label, 'Kötü');   // Worker "Kötü" dediği 60, uygulamada da "Kötü"
  assert.match((await lv(60)).title, /^Kötü hava kalitesi/); assert.match((await lv(79)).title, /^Kötü/);
  assert.match((await lv(80)).title, /^Çok kötü/); assert.match((await lv(100)).title, /^Aşırı kötü/);
  assert.equal(await lv(59), undefined);
});
test('push metni kısa: hava kalitesi başlığı/gövdesi sabit biçimde, EAQI değeri bildirimde yok', async () => {
  const e = (await ev(undefined, mkAq(() => 60)))[0];
  assert.match(e.title, /^Kötü hava kalitesi · /); assert.equal(e.body, 'Hava kalitesi kötü. Hassassanız uzun süre dışarıda kalmayın.');
  assert.ok(!/EAQI/.test(e.body) && e.body.length <= 70);
  assert.equal((await ev(undefined, mkAq(() => 85)))[0].body, 'Hava kalitesi çok kötü. Dışarıda uzun kalmayın.');
  assert.equal((await ev(undefined, mkAq(() => 120)))[0].body, 'Hava kalitesi aşırı kötü. Mümkünse dışarı çıkmayın.');
});
test('hava kalitesi metni bağlama göre: anlık Orta + tahmin tepesi Kötü → gelecek zamanlı; anlık Kötü → mevcut durum', async () => {
  const F = 'Önümüzdeki saatlerde hava kalitesinin kötüleşmesi bekleniyor.';
  let e = (await ev(undefined, mkAq((k) => (k === 0 ? 50 : k === 3 ? 60 : 30))))[0];   // anlık Orta, tepe tam eşikte (Kötü)
  assert.match(e.title, /^Hava kalitesi kötüleşebilir · /); assert.equal(e.body, F); assert.match(e.id, /:bad$/);
  e = (await ev(undefined, mkAq((k) => (k === 0 ? 59 : k === 2 ? 95 : 30))))[0];   // anlık Orta (59), tepe Çok kötü: yine gelecek zamanlı, sınıf/id tepeden
  assert.equal(e.title.startsWith('Hava kalitesi kötüleşebilir'), true); assert.equal(e.body, F); assert.match(e.id, /:vbad$/);
  e = (await ev(undefined, mkAq((k) => (k === 0 ? 60 : 30))))[0];   // anlık Kötü
  assert.match(e.title, /^Kötü hava kalitesi · /); assert.equal(e.body, 'Hava kalitesi kötü. Hassassanız uzun süre dışarıda kalmayın.');
  e = (await ev(undefined, mkAq((k) => (k === 0 ? 70 : k === 4 ? 90 : 30))))[0];   // anlık Kötü, tepe Çok kötü: mevcut durum "kötü", id tepeden
  assert.match(e.title, /^Kötü hava kalitesi/); assert.match(e.id, /:vbad$/);
  assert.equal((await ev(undefined, mkAq((k) => (k === 0 ? 85 : 30))))[0].body, 'Hava kalitesi çok kötü. Dışarıda uzun kalmayın.');
  assert.equal(await (async () => (await ev(undefined, mkAq((k) => (k === 0 ? 55 : 59)))).length)(), 0, 'eşik değişmedi: tepe 59 → bildirim yok');
  assert.equal(await (async () => (await ev(undefined, mkAq((k) => (k === 7 ? 99 : 30)))).length)(), 0, 'ufuk değişmedi: 6 saat sonrası dışarıda');
});
// ---- Dolu: ayrı bildirim yok; aynı fırtınanın birleşik metni ----
const HAIL = (k) => ({ weather_code: 96, precipitation_probability: 70, precipitation: 7, cape: 2600, lifted_index: -6, convective_inhibition: -20, freezing_level_height: 2800, wind_gusts_10m: 75, pressure_msl: 1015 - 1.2 * k });
const STORM_ONLY = { weather_code: 95, precipitation_probability: 70 };
test('dolu: güçlü birleşik sinyal + fırtına → TEK birleşik bildirim (ayrı dolu olayı yok)', async () => {
  const e = await ev((k) => (k >= 2 && k <= 4 ? HAIL(k) : { pressure_msl: 1015 - 1.2 * k }));
  assert.deepEqual(types(e), ['storm', 'wind', 'precip'].filter((x) => types(e).includes(x)), 'yalnızca mevcut türler; "hail" türü yok');
  assert.ok(!types(e).includes('hail')); const s = e.find((x) => x.type === 'storm');
  assert.match(s.title, /^Şiddetli fırtına ve dolu riski · İstanbul$/); assert.match(s.body, /dolu riski/); assert.ok(!/kesin|yağacak/i.test(s.body));
  const plain = (await ev((k) => (k >= 2 && k <= 4 ? STORM_ONLY : {}))).find((x) => x.type === 'storm');
  assert.equal(plain.title, 'Fırtına uyarısı · İstanbul'); assert.equal(plain.id, s.id, 'olay kimliği aynı: dedup/cooldown bozulmaz');
});
test('dolu: CAPE yüksek ama diğer sinyaller zayıf → birleşik metin yok (normal fırtına uyarısı)', async () => {
  const e = await ev((k) => (k >= 2 && k <= 4 ? { weather_code: 95, precipitation_probability: 70, cape: 3500, lifted_index: -1, convective_inhibition: -10, freezing_level_height: 4400, wind_gusts_10m: 25 } : {}));
  assert.equal(e.find((x) => x.type === 'storm').title, 'Fırtına uyarısı · İstanbul');
});
test('dolu: fırtına olayı yoksa tek başına dolu bildirimi gönderilmez; sinyal yetersizse (kararsızlık verisi yok) birleşik metin yok', async () => {
  assert.deepEqual(types(await ev((k) => (k >= 2 && k <= 4 ? Object.assign(HAIL(k), { weather_code: 3 }) : {}))).filter((x) => x === 'storm'), [], 'gök gürültüsü kodu yok → fırtına/dolu bildirimi yok');
  const e = await ev((k) => (k >= 2 && k <= 4 ? { weather_code: 96, precipitation_probability: 70 } : {}));
  assert.equal(e.find((x) => x.type === 'storm').title, 'Fırtına uyarısı · İstanbul', 'yalnızca kod: Orta düzey, birleşik değil');
});
test('dolu birleşimi: dedup / cooldown / sessiz saat / günlük sınır mevcut fırtına kurallarıyla aynı', async () => {
  const e = (await ev((k) => (k >= 2 && k <= 4 ? HAIL(k) : {}))).find((x) => x.type === 'storm');
  const pc = [{ ci: 'a', name: 'İstanbul', events: [e] }];
  let r = selectNotifications(mkSub(), pc, NOW); assert.equal(r.send.length, 1); assert.equal(r.send[0].type, 'storm');
  assert.equal(selectNotifications(mkSub(r.patch), pc, NOW + 3600000).send.length, 0, 'aynı olay tekrar gönderilmez');
  assert.equal(selectNotifications(mkSub({ last: { 'a|storm': NOW - 3 * 3600000 } }), [{ ci: 'a', name: 'x', events: [Object.assign({}, e, { id: 'storm:farkli:1' })] }], NOW).send.length, 0, 'cooldown (6 sa) korunur');
  const night = Date.parse('2026-10-07T21:30:00Z');   // İstanbul 00:30
  assert.equal(selectNotifications(mkSub(), [{ ci: 'a', name: 'x', events: [Object.assign({}, e, { urgent: false })] }], night).send.length, 0, 'sessiz saat: acil olmayan geçmez');
  assert.equal(selectNotifications(mkSub(), [{ ci: 'a', name: 'x', events: [Object.assign({}, e, { urgent: true })] }], night).send.length, 1, 'sessiz saat: acil fırtına geçer');
  assert.equal(selectNotifications(mkSub({ day: { d: userParts(NOW, 'Europe/Istanbul').date, n: T.dailyCap } }), pc, NOW).send.length, 0, 'günlük sınır');
  // aynı fırtına için hem fırtına hem yoğun yağış olsa bile tek bildirim
  const rain = { type: 'precip', id: 'precip:x:1', urgent: false, title: 'Kuvvetli yağış · İstanbul', body: 'y' };
  assert.deepEqual(selectNotifications(mkSub(), [{ ci: 'a', name: 'İstanbul', events: [e, rain] }], NOW).send.map((x) => x.type), ['storm']);
});
test('sessiz saat: UV, hava kalitesi, sıcak, soğuk gece ASLA geçmez (urgent işaretli bile olsa)', () => {
  const night = Date.parse('2026-10-06T23:30:00Z');
  const sel = selectNotifications(mkSub(), pc(['uv', 'aqi', 'heat', 'cold'].map((t) => E(t, t + ':2026-10-07', { urgent: true }))), night);
  assert.equal(sel.send.length, 0); assert.ok(sel.skipped.every((s) => s.why === 'sessiz-saat'));
});
test('gece geçişi: yalnızca ciddi fırtına / çok kuvvetli yağış / tehlikeli rüzgâr / ciddi buzlanma (ve ≤3 saat içinde)', async () => {
  const u = async (f) => (await ev(f)).map((x) => x.type + ':' + x.urgent).join();
  // sıradan olaylar acil değil
  assert.equal(await u((k) => k === 1 ? { weather_code: 95, precipitation_probability: 45 } : {}), 'storm:false', 'zayıf fırtına gece geçmez');
  assert.equal(await u((k) => k === 1 ? { weather_code: 95, precipitation_probability: 60 } : {}), 'storm:true');
  assert.equal(await u((k) => k === 1 ? { weather_code: 99, precipitation_probability: 45 } : {}), 'storm:true', 'dolu');
  assert.equal(await u((k) => k === 5 ? { weather_code: 96, precipitation_probability: 80 } : {}), 'storm:false', 'uzak fırtına gece uyandırmaz');
  assert.equal(await u((k) => k === 1 ? { rain: 9, precipitation: 9, precipitation_probability: 80, weather_code: 65 } : {}), 'precip:false');
  assert.equal(await u((k) => k === 1 ? { rain: 16, precipitation: 16, precipitation_probability: 80, weather_code: 65 } : {}), 'precip:true', 'çok kuvvetli yağış');
  assert.equal(await u((k) => k === 1 ? { snowfall: 2.5, precipitation: 2.5, precipitation_probability: 80, weather_code: 75, temperature_2m: -2 } : {}), 'precip:false');
  assert.equal(await u((k) => k === 1 ? { snowfall: 4.5, precipitation: 4.5, precipitation_probability: 80, weather_code: 75, temperature_2m: -2 } : {}), 'precip:true');
  assert.equal(await u((k) => k === 1 ? { wind_speed_10m: 60, wind_gusts_10m: 80 } : {}), 'wind:false', 'kuvvetli ama tehlikeli değil');
  assert.equal(await u((k) => k === 1 ? { wind_speed_10m: 60, wind_gusts_10m: 92 } : {}), 'wind:true', 'tehlikeli rüzgâr');
  assert.equal(await u((k) => k === 1 ? { weather_code: 67, precipitation_probability: 60, temperature_2m: -1 } : {}), 'frost:true', 'dondurucu yağmur');
  assert.equal(await u((k) => k === 1 ? { weather_code: 48, temperature_2m: -3 } : {}), 'frost:false', 'sisli don gece uyandırmaz');
});
test('gece ertelenen ciddi-olmayan olay sabah TEK kez gider (tek bildirim)', () => {
  const night = Date.parse('2026-10-06T23:30:00Z'), morning = Date.parse('2026-10-07T04:10:00Z');
  let sub = mkSub(), sel = selectNotifications(sub, pc([E('wind', 'wind:2026-10-07:1')]), night); assert.equal(sel.send.length, 0);
  sel = selectNotifications(sub, pc([E('wind', 'wind:2026-10-07:1')]), morning); assert.equal(sel.send.length, 1); sub = apply(sub, sel);
  assert.equal(selectNotifications(sub, pc([E('wind', 'wind:2026-10-07:1')]), morning + 1800000).send.length, 0);
});
