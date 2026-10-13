/* Harita katmanlarının SAF hesap tarafı (DOM/MapLibre yok; Node'da test edilir).
   ÖNEMLİ İLKE: Open-Meteo bir NOKTA API'sidir; ücretsiz, anahtarsız bir sıcaklık/bulut/rüzgâr/basınç KAROSU ya da GRİDİ yoktur.
   Bu yüzden bu katmanlarda alanı boyayan sahte ısı haritası, interpolasyon ya da izobar ÜRETİLMEZ. Yalnızca gerçekten sorgulanmış
   noktalar (seçili şehir, favoriler, konumum, kullanıcının bilinçli dokunduğu nokta, "bu görünümü örnekle" ile alınan en çok 9 örnek
   nokta) için model değeri gösterilir. Radar ise gerçek bir karo kaynağıdır (RainViewer) ve mapview.js'te çizilir.
   Tek istek ilkesi: tüm hava katmanları (sıcaklık, hissedilen, bulut, rüzgâr, basınç) AYNI yanıttan beslenir; katman değiştirmek ağ isteği
   yapmaz. Yalnızca hava kalitesi katmanı ilk seçildiğinde ayrı (Air Quality API) tek bir toplu istek yapar. */
'use strict';
(function (g) {
  var API_FORECAST = 'https://api.open-meteo.com/v1/forecast';
  var API_AQ = 'https://air-quality-api.open-meteo.com/v1/air-quality';

  var CFG = {
    steps: [0, 1, 2, 3, 6],            // "Şimdi", +1, +2, +3, +6 saat: Open-Meteo saatlik tahmini bunu gerçekten destekler
    hourlyCount: 7,                    // forecast_hours: şimdiki saat + 6
    wxTtl: 10 * 60 * 1000,             // hava paketi önbelleği
    aqTtl: 30 * 60 * 1000,             // hava kalitesi (CAMS) yavaş değişir
    tapSnap: 0.05,                     // dokunulan noktanın koordinatı bu ızgaraya yuvarlanır (≈5 km): "yakın nokta" aynı önbellek girişini paylaşır
    pointKeyDigits: 2,                 // şehir/favori/konum anahtarı (≈1 km)
    cacheMax: 80,                      // bellek tavanı
    gridCount: 9,                      // "bu görünümü örnekle": en çok 3×3 nokta
    gridInset: 0.2,                    // örnek noktalar görünümün kenarından bu oran içeride
    maxPoints: 26                      // tek istekte en çok nokta (şehir + favori + konum + örnekler)
  };

  var LAYERS = [
    { id: 'radar', label: 'Radar', aria: 'Radar ve yağış katmanı', type: 'tile',
      note: 'Son 2 saat gözlenen yağış (RainViewer). Tahmin değildir.' },
    { id: 'temp', label: 'Sıcaklık', aria: 'Sıcaklık katmanı', type: 'point', field: 'temperature_2m', unit: '°C',
      note: 'Noktasal model sıcaklığı (alan haritası değildir).' },
    { id: 'cloud', label: 'Bulut', aria: 'Bulutluluk katmanı', type: 'point', field: 'cloud_cover', unit: '%',
      note: 'Noktasal bulut örtüsü (alan haritası değildir).' },
    { id: 'wind', label: 'Rüzgâr', aria: 'Rüzgâr katmanı', type: 'point', field: 'wind_speed_10m', unit: 'km/sa',
      note: 'Noktasal rüzgâr: ok gittiği yönü, sayı km/sa. Hamle için noktaya dokun.' },
    { id: 'aq', label: 'Hava kalitesi', aria: 'Hava kalitesi katmanı', type: 'point', field: 'european_aqi', unit: '', src: 'aq',
      note: 'Noktasal Avrupa endeksi (EAQI), model verisi; ölçüm istasyonu değildir.' },
    { id: 'pressure', label: 'Basınç', aria: 'Basınç katmanı', type: 'point', field: 'pressure_msl', unit: 'hPa',
      note: 'Noktasal deniz seviyesi basıncı (hPa). İzobar çizilmez.' },
    { id: 'feels', label: 'Hissedilen', aria: 'Hissedilen sıcaklık katmanı', type: 'point', field: 'apparent_temperature', unit: '°C',
      note: 'Noktasal hissedilen sıcaklık (alan haritası değildir).' }
  ];
  function layer(id) { for (var i = 0; i < LAYERS.length; i++) if (LAYERS[i].id === id) return LAYERS[i]; return null; }
  function isPoint(id) { var l = layer(id); return !!l && l.type === 'point'; }

  var WX_CUR = 'temperature_2m,apparent_temperature,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
  var WX_HR = 'temperature_2m,apparent_temperature,precipitation,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
  var WX_FIELDS = WX_HR.split(',');
  var AQ_FIELDS = ['european_aqi', 'pm2_5', 'pm10'];

  // ---------- Noktalar ----------
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function validLL(lat, lon) { return num(lat) && num(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180; }
  function fix(v, d) { return Number(v).toFixed(d); }
  function keyOf(lat, lon, digits) { var d = digits == null ? CFG.pointKeyDigits : digits; return fix(lat, d) + ',' + fix(lon, d); }
  function snap(v, step) { var s = step || CFG.tapSnap; return Math.round(Math.round(v / s) * s * 1e4) / 1e4; }
  function snapPoint(lat, lon) { return { lat: snap(lat), lon: snap(Math.max(-180, Math.min(180, lon))) }; }

  // Seçili şehir + favoriler + konum (varsa) + örnekler; aynı yere düşenler tek noktaya iner. Sıra: şehir önce.
  function buildPoints(o) {
    var out = [], seen = {};
    function add(role, name, lat, lon, extra) {
      if (!validLL(lat, lon)) return;
      var k = keyOf(lat, lon);
      if (seen[k]) {                                  // aynı yer iki kez eklenmez; rol önceliği şehir > favori > konum > örnek
        if (role === 'fav') seen[k].fav = true;
        if (role === 'city' && seen[k].role !== 'city') { seen[k].role = 'city'; seen[k].name = name; }
        return;
      }
      var p = { key: k, role: role, name: name || '', lat: lat, lon: lon, fav: role === 'fav' };
      if (extra) for (var x in extra) p[x] = extra[x];
      seen[k] = p; out.push(p);
    }
    if (o.city) add('city', o.city.name, o.city.lat, o.city.lon, o.city.id ? { id: o.city.id } : null);
    (o.favs || []).forEach(function (f) { add('fav', f.name, f.lat, f.lon, f.id ? { id: f.id } : null); });
    if (o.user) add('user', 'Konumum', o.user.lat, o.user.lon);
    (o.grid || []).forEach(function (q) { add('grid', '', q.lat, q.lon); });
    // şehir her zaman ilk, kalanlar sırayla; tavanı aşarsa önce örnekler kesilir
    if (out.length > CFG.maxPoints) out = out.filter(function (p) { return p.role !== 'grid'; }).concat(out.filter(function (p) { return p.role === 'grid'; })).slice(0, CFG.maxPoints);
    return out;
  }

  // Görünür sınırlar içinde en çok 3×3 örnek nokta. `avoid`: ekran yerine coğrafi uzaklıkla (derece) mevcut noktalara çok yakın olanları atar.
  function gridPoints(b, avoid, minDeg) {
    if (!b || !validLL(b.south, b.west) || !validLL(b.north, b.east)) return [];
    var w = b.west, e = b.east; if (e < w) e += 360;                  // tarih çizgisini aşan görünüm
    var s = Math.max(-85, b.south), n = Math.min(85, b.north), inset = CFG.gridInset, pts = [], i, j;
    for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) {
      var fy = inset + (1 - 2 * inset) * i / 2, fx = inset + (1 - 2 * inset) * j / 2;
      var lat = n - (n - s) * fy, lon = w + (e - w) * fx; if (lon > 180) lon -= 360; if (lon < -180) lon += 360;
      pts.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });
    }
    var md = minDeg || 0;
    return pts.filter(function (p) { return !(avoid || []).some(function (a) { return Math.abs(a.lat - p.lat) < md && Math.abs(a.lon - p.lon) < md; }); });
  }

  // ---------- İstek adresleri ----------
  function coords(points) {
    return 'latitude=' + points.map(function (p) { return fix(p.lat, 4); }).join(',') + '&longitude=' + points.map(function (p) { return fix(p.lon, 4); }).join(',');
  }
  function wxUrl(points) {
    return API_FORECAST + '?' + coords(points) + '&current=' + WX_CUR + '&hourly=' + WX_HR + '&forecast_hours=' + CFG.hourlyCount + '&timezone=auto&wind_speed_unit=kmh';
  }
  function aqUrl(points) {
    return API_AQ + '?' + coords(points) + '&current=european_aqi,pm2_5,pm10&hourly=european_aqi&forecast_hours=' + CFG.hourlyCount + '&timezone=auto';
  }

  // ---------- Yanıt ayrıştırma ----------
  // Çok noktalı yanıt dizi, tek noktalı yanıt nesnedir. Sıra isteğe karşılık gelir (dönen koordinatlar model ızgarasına yuvarlanır; eşleme sıraya göre).
  function asArray(j) { return Array.isArray(j) ? j : (j && typeof j === 'object' ? [j] : []); }
  function hourIndex(hr, curTime) {
    if (!hr || !hr.time || !curTime) return 0;
    var i = hr.time.indexOf(String(curTime).slice(0, 13) + ':00');
    return i < 0 ? 0 : i;
  }
  // Tek nokta kaydı: { t, off, vals: {0:{alan:değer}, 1:…}, time: {0:'2026-…T15:00', …} } ; eksik alan = yok (uydurma yok)
  function parseOne(item, fields, now) {
    if (!item || !item.current || !item.current.time) return null;
    var cur = item.current, hr = item.hourly, base = hourIndex(hr, cur.time), vals = {}, time = {};
    CFG.steps.forEach(function (s) {
      var v = {}, any = false;
      fields.forEach(function (f) {
        var x = null;
        if (s === 0) x = cur[f];
        else if (hr && hr[f] && hr.time && base + s < hr.time.length) x = hr[f][base + s];
        if (num(x)) { v[f] = x; any = true; }
      });
      if (s === 0 && num(cur.weather_code)) v.weather_code = cur.weather_code;
      vals[s] = any ? v : null;
      time[s] = s === 0 ? cur.time : (hr && hr.time && base + s < hr.time.length ? hr.time[base + s] : null);
    });
    return { t: now || Date.now(), off: num(item.utc_offset_seconds) ? item.utc_offset_seconds : null, vals: vals, time: time };
  }
  function parseBundle(json, points, kind, now) {
    var arr = asArray(json), fields = kind === 'aq' ? AQ_FIELDS : WX_FIELDS, out = {};
    if (arr.length !== points.length) return out;     // eşleme güvenilmezse HİÇBİR değer yazılmaz (yanlış noktaya veri yazmaktansa boş)
    points.forEach(function (p, i) { var r = parseOne(arr[i], fields, now); if (r) out[p.key] = r; });
    return out;
  }

  // ---------- Önbellek ----------
  function cacheNew() { return { wx: {}, aq: {}, n: 0 }; }
  function fresh(rec, kind, now) { return !!rec && (now - rec.t) < (kind === 'aq' ? CFG.aqTtl : CFG.wxTtl); }
  function cachePut(c, kind, key, rec) {
    var store = c[kind];
    if (!(key in store)) c.n++;
    store[key] = rec;
    if (c.n > CFG.cacheMax) {                         // en eskiyi at (bellek sızıntısı olmasın)
      var oldest = null, ok = null, kk, i, kinds = ['wx', 'aq'];
      for (i = 0; i < 2; i++) for (kk in c[kinds[i]]) if (oldest === null || c[kinds[i]][kk].t < oldest) { oldest = c[kinds[i]][kk].t; ok = [kinds[i], kk]; }
      if (ok) { delete c[ok[0]][ok[1]]; c.n--; }
    }
  }
  function missing(c, points, kind, now) { return points.filter(function (p) { return !fresh(c[kind][p.key], kind, now); }); }

  // ---------- Değer erişimi + biçim ----------
  function rec(c, kind, key) { return c[kind][key] || null; }
  function valueFor(c, layerId, key, step) {
    var l = layer(layerId); if (!l || l.type !== 'point') return null;
    var r = c[l.src === 'aq' ? 'aq' : 'wx'][key]; if (!r || !r.vals[step]) return null;
    var v = r.vals[step][l.field];
    return num(v) ? v : null;
  }
  function wxVals(c, key, step) { var r = c.wx[key]; return r && r.vals[step] ? r.vals[step] : null; }
  function aqVals(c, key, step) { var r = c.aq[key]; return r && r.vals[step] ? r.vals[step] : null; }
  function clock(iso) { return iso ? String(iso).slice(11, 16) : ''; }

  var TEMP_STOPS = [[-15, [106, 90, 205]], [-5, [74, 144, 217]], [0, [94, 200, 229]], [8, [95, 211, 161]], [15, [181, 221, 90]], [22, [255, 210, 63]], [28, [255, 154, 60]], [34, [240, 86, 58]], [40, [179, 32, 42]]];
  function lerpStops(stops, v) {
    if (v <= stops[0][0]) return stops[0][1].slice();
    var last = stops[stops.length - 1]; if (v >= last[0]) return last[1].slice();
    for (var i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
      var a = stops[i - 1], b = stops[i], t = (v - a[0]) / (b[0] - a[0]);
      return [0, 1, 2].map(function (k) { return Math.round(a[1][k] + (b[1][k] - a[1][k]) * t); });
    }
    return last[1].slice();
  }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  function lum(c) { return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; }
  function tempColor(t) { return rgb(lerpStops(TEMP_STOPS, t)); }
  function tempText(t) { return lum(lerpStops(TEMP_STOPS, t)) > 0.56 ? '#0b1a2e' : '#fff'; }
  function cloudColor(p) { var x = Math.max(0, Math.min(100, p)) / 100, v = Math.round(250 - x * 120); return 'rgb(' + v + ',' + v + ',' + (v + 4 > 255 ? 255 : v + 4) + ')'; }
  function cloudText(p) { return p > 70 ? '#fff' : '#0b1a2e'; }
  var AQ_FALLBACK = ['#4fe3d8', '#5ad28f', '#f0d94a', '#ff6b5e', '#c2335f', '#9b4fc0'];
  function aqColor(v) { var E = g.EAQI, I = g.Insights, pal = (I && I.AQ_COLOR) || AQ_FALLBACK; return pal[E.level(v)]; }
  function aqText(v) { return g.EAQI.level(v) >= 3 ? '#fff' : '#0b1a2e'; }
  function aqLabel(v) { return g.EAQI.label(v); }

  var DIRS = ['kuzey', 'kuzeydoğu', 'doğu', 'güneydoğu', 'güney', 'güneybatı', 'batı', 'kuzeybatı'];
  function windFrom(deg) { return DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]; }
  var DIR_SUF = ['den', 'dan', 'dan', 'dan', 'den', 'dan', 'dan', 'dan'];   // ünlü uyumu: kuzey-den, güney-den; diğerleri -dan
  function windFromText(deg) {
    var i = Math.round((((deg % 360) + 360) % 360) / 45) % 8, d = DIRS[i];
    return d.charAt(0).toLocaleUpperCase('tr') + d.slice(1) + DIR_SUF[i];
  }
  function arrowDeg(deg) { return (((deg + 180) % 360) + 360) % 360; }    // meteorolojik yön "geldiği yön"; ok gittiği yönü gösterir
  function pressureWord(h) { return h < 1005 ? 'Alçak' : h > 1020 ? 'Yüksek' : 'Normal'; }

  function dg(n) { var x = Math.round(n); if (x === 0) x = 0; return (x < 0 ? '−' + (-x) : x) + '°'; }
  function mm(n) { var r = Math.round(n * 10) / 10; return String(r).replace('.', ','); }

  // Katmanın bir nokta için etiketi: { text, bg, fg, rot } | null (veri yoksa null: hiçbir şey uydurulmaz)
  function pill(c, layerId, key, step) {
    var v = valueFor(c, layerId, key, step); if (v == null) return null;
    if (layerId === 'temp' || layerId === 'feels') return { text: dg(v), bg: tempColor(v), fg: tempText(v) };
    if (layerId === 'cloud') return { text: Math.round(v) + '%', bg: cloudColor(v), fg: cloudText(v) };
    if (layerId === 'pressure') return { text: String(Math.round(v)), bg: 'rgb(236,240,248)', fg: '#0b1a2e' };
    if (layerId === 'aq') return { text: String(EAQI_round(v)), bg: aqColor(v), fg: aqText(v) };
    if (layerId === 'wind') {
      var w = wxVals(c, key, step), d = w && num(w.wind_direction_10m) ? w.wind_direction_10m : null;
      return { text: String(Math.round(v)), bg: 'rgb(236,240,248)', fg: '#0b1a2e', rot: d == null ? null : arrowDeg(d) };
    }
    return null;
  }
  function EAQI_round(v) { return g.EAQI.round(v); }

  // Renk lejantı (yalnızca renkli katmanlarda): { kind:'gradient'|'classes', ... }
  function legend(layerId) {
    if (layerId === 'temp' || layerId === 'feels') {
      var ticks = [-10, 0, 10, 20, 30, 40];
      return { kind: 'gradient', unit: '°C', ticks: ticks, css: 'linear-gradient(90deg,' + ticks.map(function (t, i) { return tempColor(t) + ' ' + Math.round(i / (ticks.length - 1) * 100) + '%'; }).join(',') + ')' };
    }
    if (layerId === 'cloud') return { kind: 'gradient', unit: '%', ticks: [0, 50, 100], css: 'linear-gradient(90deg,' + cloudColor(0) + ',' + cloudColor(100) + ')' };
    if (layerId === 'aq') {
      var E = g.EAQI, I = g.Insights, pal = (I && I.AQ_COLOR) || AQ_FALLBACK;
      return { kind: 'classes', items: E.LABEL.map(function (lb, i) { return { label: lb, color: pal[i] }; }) };
    }
    return null;
  }

  // Aşama etiketleri (saat satırı): "Şimdi", "+1 sa" …
  function stepLabel(s) { return s === 0 ? 'Şimdi' : '+' + s + ' sa'; }

  var api = {
    CFG: CFG, LAYERS: LAYERS, layer: layer, isPoint: isPoint,
    keyOf: keyOf, snap: snap, snapPoint: snapPoint, buildPoints: buildPoints, gridPoints: gridPoints,
    wxUrl: wxUrl, aqUrl: aqUrl, parseBundle: parseBundle, parseOne: parseOne, asArray: asArray, hourIndex: hourIndex,
    cacheNew: cacheNew, fresh: fresh, cachePut: cachePut, missing: missing, rec: rec,
    valueFor: valueFor, wxVals: wxVals, aqVals: aqVals, clock: clock,
    tempColor: tempColor, tempText: tempText, cloudColor: cloudColor, aqColor: aqColor, aqLabel: aqLabel,
    windFrom: windFrom, windFromText: windFromText, arrowDeg: arrowDeg, pressureWord: pressureWord,
    pill: pill, legend: legend, stepLabel: stepLabel, dg: dg, mm: mm
  };
  g.MapLayers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
