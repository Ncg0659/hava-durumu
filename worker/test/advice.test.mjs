// Paket 5 saf hesapları: yaşam önerileri, sürüş havası, çelişki kontrolü, tekrar azaltma, eksik veri
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../../advice.js');
const I = require('../../insights.js');

const pad = (n) => String(n).padStart(2, '0');
// 2 gün saatlik; bugün = 2026-10-12. fn: değişken -> (i, saat) => değer
function mk(fn = {}, days = ['2026-10-12', '2026-10-13']) {
  const time = [];
  days.forEach((d) => { for (let h = 0; h < 24; h++) time.push(`${d}T${pad(h)}:00`); });
  const n = time.length, col = (f, dflt) => Array.from({ length: n }, (_, i) => (f ? f(i, i % 24) : dflt));
  const o = {
    time,
    temperature_2m: col(fn.t, 20), apparent_temperature: col(fn.f, 20), relative_humidity_2m: col(fn.rh, 50), wind_speed_10m: col(fn.w, 8),
    wind_gusts_10m: col(fn.g, 14), uv_index: col(fn.uv, 3), precipitation: col(fn.p, 0), snowfall: col(fn.snow, 0), precipitation_probability: col(fn.pp, 0),
    weather_code: col(fn.code, 1), visibility: col(fn.vis, 24000), is_day: col((i, h) => (fn.day ? fn.day(i, h) : (h >= 6 && h < 19 ? 1 : 0)), 1),
    cloud_cover: col(fn.cc, 20), cape: col(fn.cape, 100), lifted_index: col(fn.li, 2), convective_inhibition: col(fn.cin, 0), freezing_level_height: col(fn.frz, 3500),
    pressure_msl: col(fn.press, 1015)
  };
  return o;
}
const dl = (sunset = '2026-10-12T18:20', sunrise = '2026-10-12T07:00') => ({ time: ['2026-10-12', '2026-10-13'], sunrise: [sunrise], sunset: [sunset], uv_index_max: [4] });
const ctx = (h, hour = 12, extra = {}) => {
  const s = hour;
  return Object.assign({ h, dl: dl(), start: s, cur: { time: `2026-10-12T${pad(hour)}:00`, apparent_temperature: h.apparent_temperature ? h.apparent_temperature[s] : 20, temperature_2m: h.temperature_2m ? h.temperature_2m[s] : 20 },
    aq: null, stale: false, elev: 40, now: 1760000000000, mem: null }, extra);
};
const D = (h, hour = 12, extra = {}) => A.drive(ctx(h, hour, extra));
const ids = (r) => r.tiles.map((t) => t.id);

// ---------------- Sürüş ----------------
test('sürüş: temiz hava → İyi', () => {
  const d = D(mk());
  assert.equal(d.label, 'İyi'); assert.equal(d.level, 0); assert.match(d.text, /Belirgin hava riski görünmüyor/);
  assert.equal(d.partial, false);
});
test('sürüş: orta yağış + güçlü hamle → Dikkat (Riskli değil)', () => {
  const d = D(mk({ p: () => 3, pp: () => 80, code: () => 63, g: () => 55 }));
  assert.equal(d.label, 'Dikkat'); assert.ok(d.reasons.length >= 1 && d.reasons.length <= 2);
});
test('sürüş: yoğun yağış + düşük görüş → Riskli, gerekçe en çok 2', () => {
  const d = D(mk({ p: () => 9, pp: () => 95, code: () => 65, vis: () => 700, g: () => 55 }));
  assert.equal(d.label, 'Riskli'); assert.ok(d.reasons.length <= 2);
  assert.match(d.text, /yoğun yağış/i); assert.match(d.text, /düşük görüş/i);
});
test('sürüş: yüksek fırtına / dolu riski → Riskli', () => {
  const h = mk({ code: () => 96, cape: () => 2600, li: () => -7, g: () => 85, p: () => 6, pp: () => 90, press: (i) => 1015 - i * 1.2, frz: () => 2500 });
  const d = D(h);
  assert.equal(d.label, 'Riskli');
  assert.ok(d.reasons.some((r) => r.k === 'storm' || r.k === 'hail'));
});
test('sürüş: tek zayıf sinyal gereksiz Riskli yapmaz', () => {
  for (const f of [{ g: () => 52 }, { vis: () => 3500 }, { p: () => 3, pp: () => 80, code: () => 63 }, { t: () => 1, rh: () => 92 }, { snow: () => 0.4, code: () => 71, t: () => -3 }]) {
    const d = D(mk(f)); assert.notEqual(d.label, 'Riskli', JSON.stringify(Object.keys(f)));
  }
  assert.equal(D(mk({ p: () => 0.4, pp: () => 40, code: () => 61, g: () => 30 })).label, 'İyi');   // hafif yağmur: puan yok
});
test('sürüş: donan yağmur / yoğun kar / çok yoğun sis tek başına Riskli', () => {
  assert.equal(D(mk({ code: () => 66, t: () => -1, p: () => 1, pp: () => 80 })).label, 'Riskli');
  assert.equal(D(mk({ snow: () => 3.5, code: () => 75, t: () => -4 })).label, 'Riskli');
  assert.equal(D(mk({ vis: () => 150, code: () => 45 })).label, 'Riskli');
});
test('sürüş: buzlanma — donma civarı + yağış', () => {
  const d = D(mk({ t: () => 0, p: () => 0.6, pp: () => 80, code: () => 61 }));
  assert.ok(d.reasons.some((r) => r.k === 'ice')); assert.ok(d.level >= 1);
});
test('sürüş: eksik görüş → çökme yok, kısmi veri notu, uydurma risk yok', () => {
  const h = mk(); delete h.visibility;
  const d = D(h); assert.equal(d.label, 'İyi'); assert.equal(d.partial, true); assert.match(d.text, /Eldeki verilere göre/); assert.equal(d.missing.vis, true);
  const h2 = mk({ vis: () => null }); assert.doesNotThrow(() => D(h2));
  const h3 = mk({ vis: () => null, code: () => 45 }); assert.equal(D(h3).label, 'Dikkat');   // yalnız sis kodu → en çok Dikkat
});
test('sürüş: eksik risk parametreleri (CAPE/LI/dp/hamle) → güvenli fallback', () => {
  const h = mk(); ['cape', 'lifted_index', 'convective_inhibition', 'freezing_level_height', 'wind_gusts_10m', 'snowfall', 'pressure_msl'].forEach((k) => delete h[k]);
  const d = D(h); assert.ok(d); assert.equal(d.label, 'İyi');
  const h2 = mk({ w: () => 65 }); delete h2.wind_gusts_10m; assert.equal(D(h2).level >= 1, true);   // hamle yok → ortalama rüzgâr eşiği
});
test('sürüş: hiç sinyal yoksa null (kart gösterilmez), boş veri çökmez', () => {
  const h = { time: mk().time }; assert.equal(D(h), null);
  assert.equal(A.drive({ h: { time: [] }, start: 0 }), null);
  assert.equal(A.drive({ h: null, start: 0 }), null);
  const nul = mk({ p: () => null, pp: () => null, code: () => null, vis: () => null, g: () => null, w: () => null, t: () => null, cape: () => null, li: () => null, cin: () => null, frz: () => null, press: () => null, snow: () => null, rh: () => null }); assert.equal(D(nul), null);
});
test('sürüş: akşam rüzgâr → "Akşam … bekleniyor" ve saatlik değişim', () => {
  const h = mk({ g: (i, hh) => (hh >= 17 && hh <= 21 ? 62 : 15) });
  const d = D(h, 14);   // pencere 14–16: temiz
  assert.equal(d.level, 0);
  assert.equal(d.change.dir, 'worse'); assert.match(d.change.text, /^17:00 sonrası sürüş koşulları kötüleşebilir\.$/);
  const h2 = mk({ g: (i, hh) => (hh >= 19 && hh <= 21 ? 62 : 15) });
  const d2 = D(h2, 17);  // pencere 17–19: en kötü saat 19:00
  assert.equal(d2.label, 'Dikkat'); assert.match(d2.text, /^Akşam kuvvetli rüzgâr hamleleri bekleniyor\.$/);
});
test('sürüş: yağış azalıyor → düzelme cümlesi', () => {
  const h = mk({ p: (i, hh) => (hh < 20 ? 3 : 0), pp: (i, hh) => (hh < 20 ? 90 : 5), code: (i, hh) => (hh < 20 ? 63 : 1) });
  const d = D(h, 17); assert.equal(d.change.dir, 'better'); assert.match(d.change.text, /20:00 sonrası yağış azalıyor\./);
});
test('sürüş: bayat veride kesin saat yok', () => {
  const h = mk({ g: (i, hh) => (hh >= 17 && hh <= 21 ? 62 : 15) });
  const d = D(h, 14, { stale: true }); assert.doesNotMatch(d.change.text, /\d\d:\d\d/); assert.match(d.change.text, /^Öğleden sonra sürüş koşulları kötüleşebilir\.$/);
});
test('sürüş: eşikler CFG içinde (gizli sayı yok) ve tutarlı', () => {
  const c = A.CFG.drive;
  assert.ok(c.rain[0] < c.rain[1] && c.rain[1] < c.rain[2]); assert.ok(c.vis[0] > c.vis[1] && c.vis[1] > c.vis[2]); assert.ok(c.gust[0] < c.gust[1] && c.gust[1] < c.gust[2]);
  assert.ok(c.riskMax >= 3 && c.riskSum > c.cautionSum);
});

// ---------------- Yaşam önerileri ----------------
test('yaşam: güzel hava → yürüyüş/kahve benzeri olumlu öneri, ≤4 kutucuk, tekrar yok', () => {
  const r = A.life(ctx(mk()));
  assert.equal(r.mode, 'ok'); assert.ok(r.tiles.length <= 4 && r.tiles.length >= 3);
  const names = r.tiles.map((t) => t.name).join('|');
  assert.match(names, /Yürüyüş|Dışarıda kahve/);
  assert.ok(r.tiles.every((t) => t.lvl === 0));
  assert.equal(new Set(ids(r)).size, ids(r).length);
  const fam = ids(r).filter((x) => x === 'walk' || x === 'dog'); assert.ok(fam.length <= 1);   // aynı aileden tek öneri
});
test('yaşam: yoğun yağış → açık hava önerileri bastırılır, "Evde kal"', () => {
  const r = A.life(ctx(mk({ p: () => 7, pp: () => 95, code: () => 65, vis: () => 3000, g: () => 40 })));
  assert.ok(r.tiles[0].home); assert.match(r.tiles[0].name, /Evde kal/);
  assert.ok(!r.tiles.some((t) => t.lvl === 0 && !t.home));
  assert.equal(r.timing, '');
});
test('yaşam: yüksek UV → güneş koruması (çip) + "UV yüksek" satırı', () => {
  assert.equal(A.uvNeed({ isDay: true, uvNow: 8, uvSoon: 8 }), true);
  assert.equal(A.uvNeed({ isDay: true, uvNow: 1, uvSoon: 2 }), false);   // akşam: gün boyu en yüksek değer çip için yetmez
  assert.equal(A.uvNeed({ isDay: false, uvNow: 9, uvSoon: 9 }), false);
  const r = A.life(ctx(mk({ uv: (i, hh) => (hh >= 11 && hh <= 15 ? 8 : 1) }), 11));
  assert.match(r.timing, /UV/);
});
test('yaşam: kötü hava kalitesi → açık hava sporu / koşu bastırılır, havalandırma uyarısı', () => {
  const r = A.life(ctx(mk(), 12, { aq: { value: 75, pollen: [], hourly: null } }));
  assert.ok(!r.tiles.some((t) => (t.id === 'run' || t.id === 'sport') && t.lvl === 0));
  const v = r.tiles.filter((t) => t.id === 'vent'); assert.equal(v.length, 1); assert.match(v[0].why, /Hava kalitesi nedeniyle pencereyi uzun süre açık tutmayın/);
  const ok = A.life(ctx(mk(), 12, { aq: { value: 12, pollen: [], hourly: null } }));
  assert.ok(!ok.tiles.some((t) => t.id === 'vent' && t.lvl >= 1));
});
test('yaşam: kuvvetli rüzgâr → bisiklet / piknik / kahve ayarlanır', () => {
  const r = I.rateAll(A.hourX({ h: mk({ w: () => 38, g: () => 58 }), start: 12, cur: null, elev: 40 }, 12)).reduce((m, a) => { m[a.id] = a; return m; }, {});
  assert.equal(r.bike.lvl, 2); assert.ok(r.picnic.lvl >= 1); assert.ok(r.coffee.lvl >= 1);
  const life = A.life(ctx(mk({ w: () => 38, g: () => 58 })));
  assert.ok(!life.tiles.some((t) => (t.id === 'bike' || t.id === 'picnic') && t.lvl === 0));
});
test('yaşam: akşam serinleme → üstlük/mont çipi', () => {
  assert.equal(A.clothing({ feels: 24, wind: 8, eveMin: 12, hour: 15 }).key, 'eveLayer');   // 24 → 12: düşüş 12, akşam ≤14 → üstlük
  assert.equal(A.clothing({ feels: 24, wind: 8, eveMin: 8, hour: 15 }).key, 'eveCoat');
  assert.equal(A.clothing({ feels: 14, wind: 8, eveMin: 12, hour: 15 }).key, 'layer');
  assert.equal(A.clothing({ feels: 18, wind: 33, eveMin: 17, hour: 12 }).key, 'windy');
  assert.equal(A.clothing({ feels: 2, wind: 5, eveMin: 0, hour: 12 }).key, 'cold');
  assert.equal(A.clothing({ feels: 8, wind: 5, eveMin: 5, hour: 12 }).key, 'coat');
  assert.equal(A.clothing({ feels: 22, wind: 5, eveMin: 20, hour: 12 }), null);
  assert.equal(A.clothing({ feels: 32, wind: 5, eveMin: 25, hour: 12 }), null);
  assert.equal(A.clothing({ feels: null }), null);
});
test('yaşam: zaman önerileri saatlik veriden — yağmurdan önce fırsat, rüzgâr zayıflıyor, en uygun saat', () => {
  const rainLater = mk({ pp: (i, hh) => (hh >= 15 ? 90 : 5), p: (i, hh) => (hh >= 15 ? 2 : 0), code: (i, hh) => (hh >= 15 ? 61 : 1) });
  const r = A.life(ctx(rainLater, 11)); assert.match(r.timing, /Yağmur(dan önce| başlamadan önce)/);
  const windy = mk({ w: (i, hh) => (hh < 16 ? 36 : 10), g: (i, hh) => (hh < 16 ? 52 : 16) });
  const r2 = A.life(ctx(windy, 11)); assert.match(r2.timing, /^Rüzgâr (öğleden sonra|akşam) zayıflıyor; dışarı çıkmak için daha uygun\.$/);
  const hotNoon = mk({ f: (i, hh) => (hh >= 11 && hh <= 16 ? 36 : 25), t: (i, hh) => (hh >= 11 && hh <= 16 ? 33 : 24) });
  const r3 = A.life(ctx(hotNoon, 12)); assert.match(r3.timing, /en uygun zaman (\d\d:00–\d\d:00|\d\d:00 sonrası)\./);
});
test('yaşam: bayat veride kesin saat içeren öneri yok', () => {
  const rainLater = mk({ pp: (i, hh) => (hh >= 15 ? 90 : 5), p: (i, hh) => (hh >= 15 ? 2 : 0), code: (i, hh) => (hh >= 15 ? 61 : 1) });
  const r = A.life(ctx(rainLater, 11, { stale: true })); assert.doesNotMatch(r.timing, /\d\d:\d\d/);
  const hotNoon = mk({ f: (i, hh) => (hh >= 11 && hh <= 16 ? 36 : 25), t: (i, hh) => (hh >= 11 && hh <= 16 ? 33 : 24) });
  const r3 = A.life(ctx(hotNoon, 12, { stale: true })); r3.tiles.forEach((t) => assert.doesNotMatch(t.why, /\d\d:\d\d–/)); assert.doesNotMatch(r3.timing, /\d\d:\d\d/);
});
test('yaşam: golden hour / gün batımı — yaklaşık dil, hava bulutluysa abartı yok', () => {
  const clear = A.life(ctx(mk({ cc: () => 15 }), 16));
  const sun = clear.tiles.find((t) => t.id === 'sun'); assert.ok(sun, 'fotoğraf kutucuğu'); assert.match(sun.why, /Golden hour yaklaşık \d\d:\d\d civarında başlıyor/);
  const g = sun.why.match(/(\d\d):(\d\d)/); assert.ok(+g[2] % 15 === 0);
  const cloudy = A.life(ctx(mk({ cc: () => 98 }), 16)); const s2 = cloudy.tiles.find((t) => t.id === 'sun'); if (s2) assert.ok(s2.lvl >= 1);
  const inside = A.life(ctx(mk({ cc: () => 15 }), 18)); const s3 = inside.tiles.find((t) => t.id === 'sun'); assert.ok(!s3 || /Gün batımı/.test(s3.name));
  const after = A.life(ctx(mk(), 20, { cur: { time: '2026-10-12T20:00', apparent_temperature: 20, temperature_2m: 20 } })); assert.ok(!after.tiles.some((t) => t.id === 'sun'));
});
test('yaşam: havalandırma — uygun / soğuk / nemli / polen / yağış', () => {
  const find = (h, extra) => A.life(ctx(h, 8, extra)).tiles.find((t) => t.id === 'vent');
  assert.match(find(mk(), { aq: { value: 10, pollen: [] } }).why, /Evi havalandırmak için uygun|Pencereyi açıp havalandırabilirsin/);
  assert.match(find(mk(), { aq: { value: 50, pollen: [] } }).why, /Hava kalitesi orta/);
  assert.match(find(mk(), { aq: { value: 10, pollen: [{ name: 'Çimen', val: 120 }] } }).why, /Polen/);
  const cold = A.life(ctx(mk({ t: () => 2, f: () => 0 }), 8, { aq: { value: 10, pollen: [] } })); assert.ok(!cold.tiles.some((t) => t.id === 'vent' && t.lvl === 0));
  const aqOnly = (r) => r.tiles.filter((t) => t.id === 'vent'); assert.ok(aqOnly(A.life(ctx(mk(), 12))).length <= 1);
});

// ---------------- Çelişki ----------------
test('çelişki: yüksek risk varken eğlence/olumlu öneri çıkmaz', () => {
  const bad = [
    mk({ code: () => 96, cape: () => 2600, li: () => -7, g: () => 85, p: () => 6, pp: () => 90, press: (i) => 1015 - i * 1.2, frz: () => 2500 }),   // fırtına/dolu
    mk({ vis: () => 120, code: () => 45 }),                                                                                                           // yoğun sis
    mk({ g: () => 95 }),                                                                                                                              // fırtına hamleleri
    mk({ code: () => 66, t: () => -1, p: () => 1, pp: () => 80 }),                                                                                    // donan yağmur
    mk({ f: () => 41, t: () => 38 })                                                                                                                  // aşırı sıcak
  ];
  bad.forEach((h, n) => {
    const r = A.life(ctx(h));
    assert.ok(r.mode === 'danger' || r.mode === 'risk', 'mod ' + n);
    r.tiles.forEach((t) => { if (!t.home) assert.ok(t.lvl >= 1, 'temkinli ' + n + ' ' + t.id); assert.ok(t.id !== 'picnic' && t.id !== 'coffee' && t.id !== 'sun', 'eğlence yok ' + n); });
    assert.equal(r.timing, '');
    assert.ok(!/harika|güzel|keyif/i.test(r.tiles.map((t) => t.why).join(' ')), 'olumlu ton yok ' + n);
  });
  // sürüş "Dikkat" iken piknik önerilmez
  const caution = A.life(ctx(mk({ g: () => 55 })));
  assert.ok(!caution.tiles.some((t) => t.id === 'picnic' && t.lvl === 0));
});
test('çelişki: tüm gerçekçi senaryolarda mod ile kutucuk düzeyi uyumlu (tarama)', () => {
  let n = 0;
  for (const g of [10, 40, 60, 95]) for (const vis of [24000, 3000, 600, 120]) for (const pr of [0, 1.5, 4, 10]) for (const t of [-5, 1, 12, 22, 34]) for (const cape of [100, 2200]) {
    const h = mk({ g: () => g, vis: () => vis, p: () => pr, pp: () => (pr ? 90 : 10), code: () => (pr >= 10 ? 65 : pr >= 4 ? 63 : pr ? 61 : 1), t: () => t, f: () => t, cape: () => cape, li: () => (cape > 1000 ? -5 : 2), rh: () => 85, snow: () => (t < 0 && pr ? 0.5 : 0) });
    const r = A.life(ctx(h)); n++;
    if (r.mode === 'danger' || r.mode === 'risk') r.tiles.forEach((x) => { if (!x.home) assert.ok(x.lvl >= 1); });
    if (r.mode === 'caution') assert.ok(!r.tiles.some((x) => x.id === 'picnic' && x.lvl === 0));
    assert.ok(r.tiles.length >= 1 && r.tiles.length <= 4);
    assert.equal(new Set(ids(r)).size, ids(r).length);
  }
  assert.ok(n > 300);
});

// ---------------- Tekrar azaltma ----------------
test('tekrar azaltma: oturum içinde sabit, yeni oturumda dönen eş-doğru metin; koşul belirleyici', () => {
  const h = mk(), mem = A.memNew('s1');
  const a1 = A.life(ctx(h, 12, { mem })), a2 = A.life(ctx(h, 12, { mem }));
  assert.deepEqual(a1.tiles.map((t) => t.why), a2.tiles.map((t) => t.why), 'oturum içinde aynı');
  const saved = JSON.parse(JSON.stringify(mem)); saved.sid = 's2';
  const b = A.life(ctx(h, 12, { mem: saved }));
  const sa = a1.tiles.map((t) => t.id + ':' + t.why).join('|'), sb = b.tiles.map((t) => t.id + ':' + t.why).join('|');
  assert.notEqual(sa, sb, 'yeni oturumda farklılık');
  // yeni oturumdaki her metin hâlâ aynı koşul için geçerli bir metindir
  b.tiles.forEach((t) => assert.equal(t.lvl, 0));
  // kötü havada varyasyon doğru olmayan olumlu metin üretmez
  const bad = mk({ p: () => 7, pp: () => 95, code: () => 65 }), m2 = A.memNew('x');
  for (let k = 0; k < 4; k++) { m2.sid = 'x' + k; const r = A.life(ctx(bad, 12, { mem: m2 })); assert.ok(r.tiles[0].home); assert.ok(!r.tiles.some((t) => !t.home && t.lvl === 0)); }
});
test('tekrar azaltma: önceki oturumda gösterilen düzey-0 etkinlik, yakın alternatifi varsa geri düşer; güvenlik öğeleri etkilenmez', () => {
  const h = mk(), mem = A.memNew('s1'); const first = A.life(ctx(h, 12, { mem }));
  const s2 = JSON.parse(JSON.stringify(mem)); s2.sid = 's2';
  const second = A.life(ctx(h, 12, { mem: s2 }));
  assert.ok(ids(first).join() !== ids(second).join() || first.tiles.map((t) => t.why).join() !== second.tiles.map((t) => t.why).join());
  const aqm = A.memNew('q1'); A.life(ctx(h, 12, { mem: aqm, aq: { value: 75, pollen: [] } }));
  aqm.sid = 'q2'; const r = A.life(ctx(h, 12, { mem: aqm, aq: { value: 75, pollen: [] } }));
  assert.ok(r.tiles.some((t) => t.id === 'vent' && t.lvl === 2), 'hava kalitesi uyarısı her oturumda görünür');
});
test('bellek: temizleme (en çok memKeep anahtar), bozuk veri çökertmez', () => {
  const mem = A.memNew('a'); for (let k = 0; k < 200; k++) mem.v['k' + k] = { s: 'a', i: 0, t: 1000 + k };
  A.life(ctx(mk(), 12, { mem, now: 1000 + 300 }));
  assert.ok(Object.keys(mem.v).length <= A.CFG.life.memKeep + 12);
  assert.doesNotThrow(() => A.life(ctx(mk(), 12, { mem: { sid: 'z', v: {}, cur: null, prev: { ids: 'bozuk', t: 1 } } })));
});
test('eksik / bozuk saatlik veri ile yaşam önerisi çökmez', () => {
  const h = mk(); ['apparent_temperature', 'wind_speed_10m', 'is_day', 'uv_index', 'cloud_cover', 'weather_code', 'visibility', 'wind_gusts_10m', 'precipitation'].forEach((k) => delete h[k]);
  assert.doesNotThrow(() => A.life(ctx(h)));
  const r = A.life(ctx(h)); assert.ok(r.tiles.length >= 1);
  const short = mk(); Object.keys(short).forEach((k) => { short[k] = short[k].slice(0, 14); });
  assert.doesNotThrow(() => A.life(ctx(short, 12)));
});
