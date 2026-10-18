const D = require('../daily.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const base = { temp: 21, feels: 21, rh: 50, wind: 8, gust: 14, precip: 0, pop: 5, uv: 3, code: 1, isDay: true, cloud: 30, vis: 20000, aqi: 20, stormLvl: 0, hailLvl: 0, ice: false, hour: 12, nowMin: 720, sunsetMin: 1140, sunriseMin: 360, eveMin: 19, dayMin: 14, dayMax: 23, popMax24: 5, precipSum24: 0, hoursAhead: 24 };
const X = (o) => Object.assign({}, base, o);
// konfor
let c = D.comfort(base); ok(c && c.score >= 9 && /rahat/.test(c.label), 'ideal ' + JSON.stringify(c));
c = D.comfort(X({ temp: 34, feels: 38, rh: 80 })); ok(c.score <= 3 && /Bunaltıcı|Aşırı sıcak/.test(c.label), 'çok sıcak nemli ' + c.text);
c = D.comfort(X({ temp: 31, feels: 33, rh: 78 })); ok(c.score <= 4 && c.label === 'Bunaltıcı', 'bunaltıcı ' + c.text);
c = D.comfort(X({ temp: -12, feels: -20 })); ok(c.score <= 2 && /Dondurucu|Zor/.test(c.label), 'çok soğuk ' + c.text);
c = D.comfort(X({ temp: 5, feels: 3, rh: 95 })); ok(c.score < 6, 'soğuk nemli');
c = D.comfort(X({ rh: 8 })); ok(c.score >= 8 && c.reasons.some(r => /kuru/.test(r)), 'kuru ' + JSON.stringify(c));
c = D.comfort(X({ wind: 5, gust: 8 })); ok(c.score === 10, 'sakin ' + c.score);
c = D.comfort(X({ wind: 55, gust: 90 })); ok(c.score <= 6 && /Rüzgâr|rüzgâr|hamle/.test(c.reasons.join()), 'çok rüzgârlı ' + c.text);
c = D.comfort(X({ precip: 6, code: 65, pop: 100 })); ok(c.score <= 7 && /Yağış/.test(c.reasons.join()), 'yağmurlu ' + c.text);
c = D.comfort(X({ uv: 10 })); ok(c.score <= 9, 'uv');
c = D.comfort(X({ code: 95, stormLvl: 2, wind: 40, gust: 70 })); ok(c.score <= 4 && c.label === 'Fırtınalı', 'fırtına konfor ' + c.text);
c = D.comfort(X({ code: 96, hailLvl: 2 })); ok(c.score <= 5 && /Dolu/.test(c.reasons.join()), 'dolu konfor ' + c.text);
// eksik veri
ok(D.comfort(null) === null && D.comfort(undefined) === null && D.comfort({}) === null, 'boş girdi → null');
ok(D.comfort(X({ temp: null, feels: null })) === null, 'çekirdek yok → null');
ok(D.comfort(X({ temp: NaN, feels: NaN })) === null, 'NaN çekirdek → null');
ok(D.comfort(X({ temp: Infinity, feels: Infinity })) === null, 'Infinity çekirdek → null');
ok(D.comfort(X({ temp: 20, feels: null })).estimated === true, 'feels yok → sıcaklık, estimated');
c = D.comfort(X({ rh: NaN, wind: Infinity, gust: -Infinity, precip: null, uv: undefined, pop: NaN })); ok(c && c.score === 10 && isFinite(c.score), 'opsiyoneller geçersiz → yok sayılır ' + c.text);
ok(D.comfort('x') === null && D.comfort(5) === null, 'tür');
// aktiviteler
let a = D.activities(base); ok(a.length === 5 && a.every(v => v.score >= 0 && v.score <= 10 && Number.isInteger(v.score)), 'beş etkinlik');
const by = (arr, id) => arr.find(v => v.id === id);
ok(by(a, 'walk').score >= 8 && !by(a, 'walk').blocked, 'yürüyüş ideal');
a = D.activities(X({ code: 95, stormLvl: 2 })); ok(a.every(v => v.score <= 2 || v.id === 'carwash') && by(a, 'walk').blocked, 'fırtına bastırır');
a = D.activities(X({ code: 96, hailLvl: 2 })); ok(by(a, 'walk').blocked && /Dolu/.test(by(a, 'walk').why), 'dolu');
a = D.activities(X({ precip: 9, code: 65 })); ok(by(a, 'walk').blocked && by(a, 'coffee').score <= 2, 'şiddetli yağış');
a = D.activities(X({ aqi: 80 })); ok(by(a, 'sport').blocked && by(a, 'walk').blocked && !by(a, 'carwash').blocked, 'kötü AQI dış etkinlik yok, yıkama etkilenmez');
a = D.activities(X({ temp: 40, feels: 42 })); ok(by(a, 'sport').blocked && /sıcak/i.test(by(a, 'sport').why), 'aşırı sıcak');
a = D.activities(X({ temp: -1, feels: -3, code: 71, precip: 0.3, ice: true })); ok(by(a, 'walk').blocked && /Buzlanma/.test(by(a, 'walk').why) && by(a, 'carwash').score <= 5, 'buzlanma');
a = D.activities(X({ temp: 0, feels: -2, ice: true, precip: 0, code: 3 })); ok(by(a, 'carwash').blocked && /Buzlanma/.test(by(a, 'carwash').why), 'buzlanma yıkama');
a = D.activities(X({ nowMin: 1100, sunsetMin: 1140 })); ok(by(a, 'photo').score >= 8 && /Altın saat/.test(by(a, 'photo').why), 'altın saat ' + by(a, 'photo').why);
a = D.activities(X({ nowMin: 900, sunsetMin: 1140 })); ok(by(a, 'photo').score < 8 && /Altın saate/.test(by(a, 'photo').why), 'altın saate yaklaşıyor: ' + by(a, 'photo').why);
a = D.activities(X({ isDay: false })); ok(by(a, 'photo').score <= 2 && by(a, 'walk').score <= 9, 'gece fotoğraf düşük');
a = D.activities(X({ popMax24: 90, precipSum24: 5 })); ok(by(a, 'carwash').score <= 4, 'yağış gelecek → yıkama düşük');
a = D.activities(X({ hoursAhead: 2, popMax24: null, precipSum24: null, pop: null })); ok(!by(a, 'carwash'), 'yetersiz ufuk → yıkama puanı uydurulmaz');
a = D.activities(X({ feels: null, temp: null })); ok(Array.isArray(a) && a.length === 0, 'çekirdek yok → boş');
a = D.activities(X({ wind: NaN, gust: Infinity, cloud: NaN, vis: NaN, nowMin: NaN, sunsetMin: NaN, popMax24: NaN })); ok(a.every(v => Number.isFinite(v.score)), 'NaN/Infinity güvenli');
ok(D.activities(null).length === 0 && D.activities(undefined).length === 0, 'null');
// olumlu öneriler
a = D.activities(base); let top = D.topActivities(a, 3); ok(top.length <= 3 && top.every(v => !v.blocked && v.score >= 7), 'top');
a = D.activities(X({ code: 95, stormLvl: 2 })); ok(D.topActivities(a).filter(v => v.id !== 'carwash').length === 0, 'fırtınada olumlu öneri yok');
// giyim
let o = D.outfit(X({ feels: 2, temp: 3 }), null); ok(/mont/i.test(o.text), 'soğuk ' + o.text);
o = D.outfit(X({ feels: 20, eveMin: 12, hour: 15 }), null, {}); ok(/akşam/.test(o.text) || o.parts.some(p => /akşam/.test(p)), 'akşam düşüşü ' + JSON.stringify(o));
o = D.outfit(X({ feels: 16, wind: 35, gust: 55 }), null); ok(/rüzgâr/.test(o.text), 'rüzgâr ' + o.text);
o = D.outfit(X({ feels: 20, precip: 1, code: 61 }), null); ok(/şemsiye|su geçirmez/.test(o.text), 'yağmur');
o = D.outfit(X({ feels: 20, precip: 1, code: 61 }), null, { rain: false }); ok(!o || !/şemsiye/.test(o.text), 'rain:false');
o = D.outfit(X({ feels: 22, dayMin: 8, dayMax: 24, eveMin: 22 }), null); ok(o && /katmanlı/.test(o.text), 'gün içi değişim ' + (o && o.text));
o = D.outfit(X({ feels: 31 }), null); ok(/Hafif/.test(o.text), 'sıcak');
o = D.outfit(X({ feels: null, temp: null }), null); ok(o === null, 'veri yok');
o = D.outfit(X({ feels: 8 }), { key: 'coat', text: 'Serin, mont giymeni öneririm', short: 'Mont giy' }); ok(/Serin, mont giymeni öneririm/.test(o.text), 'base korunur');
o = D.outfit(null, null); ok(o === null, 'null');
o = D.outfit(X({ feels: NaN, temp: Infinity }), null); ok(o === null, 'NaN');
// evcil hayvan
let p = D.pet(base); ok(p.level === 0 && /uygun/.test(p.title), 'pet ok ' + p.title);
p = D.pet(X({ temp: 31, feels: 32, uv: 8, cloud: 5 })); ok(p.level >= 1 && p.reasons.some(r => /Zemin/.test(r)) && !/°C|derece/.test(p.reasons.join(' ').replace(/Hissedilen/g, '')), 'zemin ısısı tahmini ' + JSON.stringify(p.reasons));
ok(!p.reasons.some(r => /\d+\s*°/.test(r)), 'asfalt sıcaklığı sayısı verilmez');
p = D.pet(X({ temp: 38, feels: 40 })); ok(p.level === 2, 'çok sıcak');
p = D.pet(X({ temp: -8, feels: -14 })); ok(p.level === 2, 'çok soğuk');
p = D.pet(X({ temp: -3, feels: -6 })); ok(p.level === 1, 'soğuk');
p = D.pet(X({ ice: true, temp: 0 })); ok(p.level >= 1 && p.reasons.some(r => /kaygan|Buzlan/.test(r)), 'buz');
p = D.pet(X({ precip: 1, code: 61 })); ok(p.level === 1, 'yağış');
p = D.pet(X({ gust: 80 })); ok(p.level === 2, 'sert rüzgâr');
p = D.pet(X({ code: 95, stormLvl: 2 })); ok(p.level === 2, 'fırtına');
p = D.pet(X({ aqi: 80 })); ok(p.level === 1, 'kötü AQI');
ok(D.pet(X({ temp: null, feels: null })) === null && D.pet(null) === null && D.pet(X({ temp: NaN, feels: NaN })) === null, 'pet veri yok');
p = D.pet(X({ wind: NaN, gust: Infinity, uv: NaN, cloud: NaN, rh: NaN })); ok(p && Number.isFinite(p.level), 'pet NaN güvenli');
ok(!/köpek|kedi|ırk|cins|veteriner/i.test(JSON.stringify(D.pet(base)).replace(/Veteriner tavsiyesi değildir/, '')), 'tür/ırk iddiası yok');
// pick
const tiles = [{ id: 'walk', icon: 'walk', name: 'Yürüyüş', lvl: 0, label: 'Uygun', why: 'x' }, { id: 'dog', icon: 'dog', name: 'Köpek', lvl: 0, label: 'Uygun', why: 'y' }, { id: 'coffee', icon: 'coffee', name: 'Kahve', lvl: 0, label: 'Uygun', why: 'z' }, { id: 'sport', icon: 'dumbbell', name: 'Spor', lvl: 0, label: 'Uygun', why: 'w' }];
let pk = D.pick(tiles, base, D.activities(base)); ok(pk.length <= 3 && new Set(pk.map(v => v.id)).size === pk.length, 'pick ≤3 ve tekrarsız'); ok(!(pk.some(v => v.id === 'walk') && pk.some(v => v.id === 'dog')), 'yürüyüş/köpek aynı aile');
pk = D.pick(tiles, X({ code: 95, stormLvl: 2 }), D.activities(X({ code: 95, stormLvl: 2 }))); ok(pk.length === 0, 'fırtınada olumlu dış mekân kalmaz');
pk = D.pick([{ id: 'home', icon: 'home', name: 'Evde kal', lvl: 0, label: 'Önerilir', why: 'Fırtına var', home: true }].concat(tiles), X({ code: 95, stormLvl: 2 }), []); ok(pk.length === 1 && pk[0].home, 'evde kal korunur');
pk = D.pick(null, base, null); ok(Array.isArray(pk), 'null tiles');
pk = D.pick([], X({ nowMin: 1100 }), D.activities(X({ nowMin: 1100 }))); ok(pk.some(v => v.id === 'photo'), 'altın saat eklenir');
// fromData
const hh = { time: ['2026-10-18T12:00', '2026-10-18T13:00'], temperature_2m: [20, 21], apparent_temperature: [20, NaN], precipitation: [0, 0], precipitation_probability: [10, 10], wind_gusts_10m: [20, 20], uv_index: [3, 3], cloud_cover: [10, 10], visibility: [20000, 20000], relative_humidity_2m: [50, 50] };
let fd = D.fromData({ current: { temperature_2m: 20, apparent_temperature: 20, relative_humidity_2m: 55, wind_speed_10m: 9, weather_code: 1, is_day: 1, time: '2026-10-18T12:00' }, hourly: hh, daily: { sunset: ['2026-10-18T18:20'], sunrise: ['2026-10-18T06:40'], temperature_2m_max: [23], temperature_2m_min: [14] } }, 0, { value: 30 });
ok(fd.temp === 20 && fd.hour === 12 && fd.sunsetMin === 1100 && fd.aqi === 30 && fd.dayMax === 23, 'fromData ' + JSON.stringify(fd).slice(0, 200));
ok(D.fromData(null, 0, null).temp === null && D.fromData({}, 0, null).feels === null && D.fromData({ current: null, hourly: null }, NaN, 5).temp === null, 'fromData boş');
ok(D.comfort(D.fromData({}, 0, null)) === null, 'boş veri → puan yok');
console.log('PASS', pass, 'FAIL', fail);
