/* EYRIVO polen (0.8) — SAF VERİ + SEVİYE + HAVA YORUMU. DOM, ağ ve depolama yok; tarayıcısız test edilebilir (module.exports).
   Kaynak: Open-Meteo Air Quality API → CAMS European Air Quality Forecast (yaklaşık 11 km model ızgarası, saatlik, 4 gün, birim grains/m³).
   Polen yalnızca Avrupa'da ve polen sezonunda vardır; sezon dışında alanlar null gelir. null ASLA 0 ya da "Düşük" sayılmaz.
   Eşikler (grains/m³): EEA Climate-ADAPT "CAMS yer seviyesi polen tahmini" sayfası, Pfaar ve ark. (2017; 2020) / EAACI klinik eşiklerine dayanır.
     Kızılağaç, huş, zeytin, pelin: Düşük < 10 · Orta 10–99 · Yüksek ≥ 100
     Çimen, ambrosia:               Düşük < 3  · Orta 3–49  · Yüksek ≥ 50
   "Çok yüksek" sınıfı kaynakta yoktur; EYRIVO'ya özel eşik uydurulmaz. */
'use strict';
(function (g) {
  var API = 'https://air-quality-api.open-meteo.com/v1/air-quality';
  var UNIT = 'grains/m³';
  // Gösterim sırası = öne çıkma sırası eşitlikte (Türkiye'de yaygın olanlar önde)
  var TYPES = [
    { id: 'grass',   api: 'grass_pollen',   name: 'Çimen',     mid: 3,  hi: 50,  pref: 'grass' },
    { id: 'olive',   api: 'olive_pollen',   name: 'Zeytin',    mid: 10, hi: 100, pref: 'olive' },
    { id: 'birch',   api: 'birch_pollen',   name: 'Huş',       mid: 10, hi: 100, pref: 'birch' },
    { id: 'ragweed', api: 'ragweed_pollen', name: 'Ambrosia',  mid: 3,  hi: 50,  pref: 'ragweed' },
    { id: 'alder',   api: 'alder_pollen',   name: 'Kızılağaç', mid: 10, hi: 100, pref: 'other' },
    { id: 'mugwort', api: 'mugwort_pollen', name: 'Pelin',     mid: 10, hi: 100, pref: 'other' }
  ];
  var LEVELS = ['Düşük', 'Orta', 'Yüksek'];
  var LV_WORD = ['düşük', 'orta', 'yüksek'];
  var PREFS = [['grass', 'Çimen'], ['olive', 'Zeytin'], ['birch', 'Huş'], ['ragweed', 'Ambrosia'], ['other', 'Diğer']];

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function byId(id) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i]; return null; }

  // Tür bazlı seviye: 0 Düşük, 1 Orta, 2 Yüksek; veri yoksa null
  function levelOf(type, v) {
    var t = typeof type === 'string' ? byId(type) : type; v = num(v);
    if (!t || v === null || v < 0) return null;
    return v >= t.hi ? 2 : v >= t.mid ? 1 : 0;
  }
  // Aynı seviye içinde sıralama için orantı (değer / yüksek eşiği)
  function ratio(t, v) { return v / t.hi; }

  function url(lat, lon) {
    var f = TYPES.map(function (t) { return t.api; }).join(',');
    return API + '?latitude=' + (Math.round(lat * 1000) / 1000) + '&longitude=' + (Math.round(lon * 1000) / 1000) + '&hourly=' + f + '&forecast_days=4&timezone=auto';
  }

  // API cevabı → { times:[...], s:{grass:[...],...}, unit }. Hiç sayısal değer yoksa null (= veri yok).
  function parse(j) {
    if (!j || !j.hourly || !j.hourly.time || !j.hourly.time.length) return null;
    var n = j.hourly.time.length, s = {}, any = false;
    TYPES.forEach(function (t) {
      var a = j.hourly[t.api], out = [], i;
      for (i = 0; i < n; i++) { var v = a ? num(a[i]) : null; out.push(v); if (v !== null) any = true; }
      s[t.id] = out;
    });
    if (!any) return null;
    return { times: j.hourly.time.slice(), s: s, unit: (j.hourly_units && j.hourly_units.grass_pollen) || UNIT };
  }

  // Takip tercihi: ids dizisi (pref anahtarları); boş/geçersiz = hepsi
  function tracked(pref) {
    var set = {}, any = false;
    (pref || []).forEach(function (p) { if (PREFS.some(function (x) { return x[0] === p; })) { set[p] = 1; any = true; } });
    return TYPES.map(function (t) { return !any || !!set[t.pref]; });
  }

  // Bir günün özeti. day: 'yyyy-mm-dd'. Gün için hiç sayısal veri yoksa null.
  function summarize(model, day, pref) {
    if (!model) return null;
    var idx = [], i, k;
    for (i = 0; i < model.times.length; i++) if (model.times[i].slice(0, 10) === day) idx.push(i);
    if (!idx.length) return null;
    var tr = tracked(pref), types = [], any = false;
    TYPES.forEach(function (t, ti) {
      var max = null, at = -1;
      idx.forEach(function (i) { var v = model.s[t.id][i]; if (v !== null && (max === null || v > max)) { max = v; at = i; } });
      if (max !== null) any = true;
      types.push({ id: t.id, name: t.name, mid: t.mid, hi: t.hi, tracked: tr[ti], peak: max, level: levelOf(t, max), peakAt: at >= 0 ? model.times[at].slice(11, 16) : null });
    });
    if (!any) return null;
    // Saatlik genel seviye = takipteki türlerin en yükseği; sıralama için en yüksek orantı
    var hours = idx.map(function (i) {
      var lv = null, r = -1, lead = null;
      TYPES.forEach(function (t, ti) {
        if (!tr[ti]) return;
        var v = model.s[t.id][i], l = levelOf(t, v);
        if (l === null) return;
        var rr = ratio(t, v);
        if (lv === null || l > lv || (l === lv && rr > r)) { lv = l; r = rr; lead = t.id; }
      });
      return { time: model.times[i].slice(11, 16), level: lv, lead: lead, r: r };
    });
    // Günün genel seviyesi: takipteki türlerin günlük en yüksek seviyesi
    var dayLv = null;
    types.forEach(function (t) { if (t.tracked && t.level !== null && (dayLv === null || t.level > dayLv)) dayLv = t.level; });
    if (dayLv === null) return null;   // takipteki türlerin hiçbirinde veri yok
    var leading = types.filter(function (t) { return t.tracked && t.level === dayLv; })
      .sort(function (a, b) { return (b.peak / b.hi) - (a.peak / a.hi); });
    // Yoğun zaman aralığı: genel seviyenin gün seviyesine eşit olduğu saatler (yalnızca Orta/Yüksek için)
    var span = null, first = -1, last = -1;
    if (dayLv >= 1) {
      hours.forEach(function (h, i) { if (h.level === dayLv) { if (first < 0) first = i; last = i; } });
      if (first >= 0) span = { from: hours[first].time, to: hours[last].time, single: first === last };
    }
    return { day: day, level: dayLv, label: LEVELS[dayLv], leading: leading, types: types, hours: hours, span: span };
  }

  // Cümleler
  function names(list) { return list.map(function (t) { return t.name; }); }
  function joinTr(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' ve ' + a[a.length - 1]; }
  function lead(sum, max) {   // "Çimen ve Zeytin poleni öne çıkıyor" (en çok 'max' tür adlandırılır)
    var l = sum.leading.slice(0, max || 2);
    return joinTr(names(l)) + ' poleni öne çıkıyor';
  }
  function headline(sum) {   // "Polen yüksek — Çimen poleni öne çıkıyor."
    if (!sum) return '';
    if (sum.level === 0) return 'Bugün belirgin polen riski yok.';
    return 'Polen ' + LV_WORD[sum.level] + ' — ' + lead(sum, 2) + '.';
  }
  function cardSub(sum) {   // ana kart alt satırı
    if (sum.level === 0) return 'Bugün belirgin risk yok';
    return names(sum.leading.slice(0, 2)).join(' · ');
  }

  // İleride "Yarın polen çok yüksek olabilir" türü bildirim için hazır veri yapısı (bu turda KULLANILMIYOR, push KAPALI).
  // Dönüş: { date, level, label, types:[id], peak:{id,value}, span } ya da null. Worker'a dokunulmaz.
  function notifyPayload(model, day) {
    var s = summarize(model, day, null);
    if (!s) return null;
    var top = s.leading[0];
    return { date: day, level: s.level, label: s.label, types: s.leading.map(function (t) { return t.id; }), peak: { id: top.id, value: top.peak, unit: UNIT }, span: s.span };
  }

  function addDays(day, n) {
    var d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  // Saat şeridi: 3 saatte bir hücre (00:00 … 21:00); seviyesi olmayan hücre null
  function strip(sum, step) {
    step = step || 3;
    return sum.hours.filter(function (h, i) { return i % step === 0; });
  }
  function fmtVal(v) {
    if (v === null || v === undefined) return '—';
    var r = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
    return String(r).replace('.', ',');
  }

  var API_EXPORT = {
    API: API, UNIT: UNIT, TYPES: TYPES, LEVELS: LEVELS, PREFS: PREFS,
    levelOf: levelOf, url: url, parse: parse, tracked: tracked, summarize: summarize, headline: headline, cardSub: cardSub, lead: lead,
    notifyPayload: notifyPayload, addDays: addDays, strip: strip, fmtVal: fmtVal
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API_EXPORT;
  g.POLLEN = API_EXPORT;
})(typeof window !== 'undefined' ? window : globalThis);
