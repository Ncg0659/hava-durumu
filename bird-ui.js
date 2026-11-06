/* EYRIVO Kuş Göç Takvimi (0.8.x geliştirme): "Kuş Göçü" kartı + "Kuş Göç Takvimi" paneli.
   Bu bir MEVSİMSEL TAKVİM / rehberdir. Canlı kuş konumu, kuş sayısı, "yakınınızda şu kuş var" iddiası YOKTUR.
   Veri: bird-migration-tr.json (yerel, sürümlü, kaynakları ve seviye yöntemi dosyada yazılı). Harici API yok; çevrimdışı çalışır.
   Konum → göç bölgesi: koordinat tabanlı kaba kutu eşlemesi (ilçe tahmini yok); sınıra yakınsa kesin sınır iddiası yapılmaz.
   Saf kısım (bölge eşleme, ay/sezon/seviye hesapları, cümleler, doğrulama) tarayıcısız test edilebilir (module.exports). */
'use strict';
(function (g) {
  var MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var MABB = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  var RANK = { l: 1, m: 2, h: 3 };
  var ILABEL = { h: 'Yoğun', m: 'Orta', l: 'Düşük' };
  var SLABEL = { spring: 'İlkbahar göçü', autumn: 'Sonbahar göçü', winter: 'Kışlama dönemi' };
  var DIR = { spring: 'Güneyden kuzeye', autumn: 'Kuzeyden güneye' };
  var MARGIN = 0.15;   // derece (~15 km): bölge sınırına bu kadar yakınsa "sınır bölgesi" notu
  // [latMin, latMax, lonMin, lonMax]; öncelik sırası önemli. Bilinçli olarak kaba: biyolojik sınır iddiası yok.
  var BOXES = [
    ['hatay_belen', [[35.8, 36.95, 35.6, 36.8]]],
    ['east_blacksea', [[40.3, 41.7, 39.6, 42.3]]],
    ['istanbul_bosphorus', [[40.75, 41.65, 28.0, 29.95]]],
    ['marmara', [[39.6, 41.2, 26.0, 30.8], [40.0, 42.1, 26.0, 28.2]]]
  ];
  // Türkiye'nin kaba dış hattı [lon, lat]; yalnızca "Türkiye'de mi?" kararı için
  var TR = [[25.6, 40.0], [26.05, 40.75], [26.35, 41.2], [26.55, 41.7], [27.1, 42.0], [28.0, 42.05], [29.0, 41.3], [31.0, 41.2], [32.5, 42.05], [35.2, 42.1], [36.5, 41.4], [39.0, 41.2], [41.5, 41.6], [42.7, 41.5], [43.5, 41.1], [44.8, 40.2], [44.8, 39.4], [44.2, 37.3], [42.3, 37.1], [38.0, 36.8], [36.7, 36.2], [35.9, 35.8], [34.6, 36.5], [30.7, 36.6], [28.2, 36.5], [27.3, 36.6], [27.0, 37.8], [26.2, 38.3], [26.5, 39.5]];

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function inPoly(lon, lat, poly) {
    var c = false, i, j;
    for (i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function inBox(lat, lon, b) { return lat >= b[0] && lat <= b[1] && lon >= b[2] && lon <= b[3]; }
  function depth(lat, lon, b) { return Math.min(lat - b[0], b[1] - lat, lon - b[2], b[3] - lon); }   // içeride pozitif
  function gap(lat, lon, b) { var dy = Math.max(b[0] - lat, 0, lat - b[1]), dx = Math.max(b[2] - lon, 0, lon - b[3]); return Math.sqrt(dx * dx + dy * dy); }
  function isTR(city) {
    var c = city && city.country;
    if (c && !/^(t[uü]rkiye|turkey|tr)$/i.test(String(c).trim())) return false;
    return true;
  }
  // Konum → {id, edge} | null (Türkiye dışı/bilinmiyor). Kaba kutu eşlemesi; ilçe adı kullanılmaz.
  function regionFor(city) {
    var lat = city && num(city.lat), lon = city && num(city.lon), i, j, hit = null, edge = false;
    if (lat === null || lon === null || !isTR(city)) return null;
    if (!inPoly(lon, lat, TR)) return null;
    for (i = 0; i < BOXES.length && !hit; i++) for (j = 0; j < BOXES[i][1].length; j++) {
      var b = BOXES[i][1][j];
      if (inBox(lat, lon, b)) { hit = BOXES[i][0]; if (depth(lat, lon, b) < MARGIN) edge = true; break; }
    }
    // başka bir geçiş hattının kutusuna çok yakınsa da "sınır bölgesi"
    for (i = 0; i < BOXES.length; i++) {
      if (BOXES[i][0] === hit || (hit === 'istanbul_bosphorus' && BOXES[i][0] === 'marmara') || (hit === 'marmara' && BOXES[i][0] === 'istanbul_bosphorus')) continue;   // İstanbul ve Marmara zaten iç içe
      for (j = 0; j < BOXES[i][1].length; j++) if (gap(lat, lon, BOXES[i][1][j]) < MARGIN) edge = true;
    }
    return { id: hit || 'tr_general', edge: edge };
  }

  // Veri doğrulama: bozuk bölge/ay/grup atılır; kullanılabilir bölge yoksa null.
  function validate(j) {
    if (!j || typeof j !== 'object' || !Array.isArray(j.regions) || !j.groups || typeof j.groups !== 'object') return null;
    var out = { v: j.v, groups: {}, sources: j.sources && typeof j.sources === 'object' ? j.sources : {}, conf: j.confidence || {}, regions: {} };
    Object.keys(j.groups).forEach(function (k) { var o = j.groups[k]; if (o && typeof o.name === 'string') out.groups[k] = o; });
    function cleanMonths(src) {
      var m = {};
      if (!src || typeof src !== 'object') return m;
      Object.keys(src).forEach(function (k) {
        var e = src[k], gg = {}, any = false;
        if (!/^(0[1-9]|1[0-2])$/.test(k) || !e || (e.s !== 'spring' && e.s !== 'autumn' && e.s !== 'winter') || !e.g || typeof e.g !== 'object') return;
        Object.keys(e.g).forEach(function (gk) { var lv = e.g[gk]; if (out.groups[gk] && (lv === 'h' || lv === 'm' || lv === 'l' || lv === 'w')) { gg[gk] = lv; any = true; } });
        if (any) m[k] = { s: e.s, g: gg, q: e.q ? 1 : 0, src: Array.isArray(e.src) ? e.src.filter(function (x) { return typeof x === 'string'; }) : [] };
      });
      return m;
    }
    var common = cleanMonths(j.common);
    j.regions.forEach(function (r) {
      if (!r || typeof r.id !== 'string' || typeof r.name !== 'string') return;
      var m = cleanMonths(r.months);
      Object.keys(common).forEach(function (k) { if (!m[k]) m[k] = common[k]; });
      out.regions[r.id] = { id: r.id, name: r.name, conf: r.conf, note: typeof r.note === 'string' ? r.note : '', months: m };
    });
    return Object.keys(out.regions).length ? out : null;
  }

  // Bir ayın özeti: göç gruplarının en yükseği; yalnızca kışlama varsa 'winter'; yoksa 'calm'
  function monthInfo(region, mi) {   // mi: 0..11
    var e = region && region.months[(mi < 9 ? '0' : '') + (mi + 1)];
    if (!e) return { kind: 'calm', level: null, season: null, groups: [], q: 0, src: [] };
    var best = 0, groups = [];
    Object.keys(e.g).forEach(function (k) { if (e.g[k] !== 'w') { groups.push({ id: k, level: e.g[k] }); if (RANK[e.g[k]] > best) best = RANK[e.g[k]]; } });
    groups.sort(function (a, b) { return RANK[b.level] - RANK[a.level]; });
    if (best) return { kind: 'migration', level: best === 3 ? 'h' : best === 2 ? 'm' : 'l', season: e.s, groups: groups, q: e.q, src: e.src };
    return { kind: 'winter', level: null, season: 'winter', groups: Object.keys(e.g).map(function (k) { return { id: k, level: 'w' }; }), q: 0, src: e.src };
  }
  function joinTr(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' ve ' + a[a.length - 1]; }
  // Kesinlik iddiası olmayan cümle. Canlı gözlem yok: "şu anda", "yakınınızda" gibi ifadeler üretilmez.
  function sentence(info, groups) {
    if (info.kind === 'winter') return 'Su kuşları için kışlama dönemi; sulak alanlarda toplanıyor olabilirler.';
    if (info.kind !== 'migration') return 'Bu dönemde göç hareketi daha sakin.';
    var ph = info.groups.filter(function (x) { return groups[x.id] && x.level === info.level; }).slice(0, 3).map(function (x) { return groups[x.id].phrase; });
    if (!ph.length) ph = info.groups.slice(0, 3).map(function (x) { return groups[x.id] && groups[x.id].phrase; }).filter(Boolean);
    var base = joinTr(ph.map(function (x, i) { return i ? x.toLocaleLowerCase('tr') : x; }));   // 'Leylek ve yırtıcı kuş geçişleri…'
    return info.level === 'h' ? base + ' geçişleri bu dönemde yoğunlaşabilir.' : info.level === 'm' ? base + ' geçişleri bu dönemde görülebilir.' : base + ' hareketi bu dönemde hafif düzeyde olabilir.';
  }
  // Mevcut hareketin sürdüğü son ay (aynı sezon, ardışık aylar) → "Mayıs ayı sonuna kadar sürebilir"
  function lastMonth(region, mi) {
    var cur = monthInfo(region, mi), k = mi, n, nx;
    if (cur.kind !== 'migration') return null;
    var thr = RANK[cur.level];   // yalnızca aynı ya da daha yüksek düzeydeki ardışık aylar; veri dışı/düşük uç aylara taşmaz
    for (n = 1; n < 12; n++) { nx = monthInfo(region, (mi + n) % 12); if (nx.kind !== 'migration' || nx.season !== cur.season || RANK[nx.level] < thr) break; k = (mi + n) % 12; }
    return k;
  }
  function nextSeason(region, mi) {
    var n, x;
    for (n = 1; n <= 12; n++) { x = monthInfo(region, (mi + n) % 12); if (x.kind === 'migration') return { month: (mi + n) % 12, season: x.season, level: x.level }; }
    return null;
  }
  // Yıllık özet cümlesi: "En yoğun dönem: Mart–Nisan (ilkbahar) ve Eylül (sonbahar)"
  function yearSummary(region) {
    var runs = [], i, cur = null, hi = 0, lo = 0;
    for (i = 0; i < 12; i++) { var x = monthInfo(region, i); if (x.kind === 'migration' && x.level === 'h') { hi++; if (cur && cur.season === x.season && cur.end === i - 1) cur.end = i; else { cur = { start: i, end: i, season: x.season }; runs.push(cur); } } else if (x.kind === 'migration') lo++; }
    function rng(r) { return (r.start === r.end ? MONTHS[r.start] : MONTHS[r.start] + '–' + MONTHS[r.end]) + ' (' + (r.season === 'spring' ? 'ilkbahar' : 'sonbahar') + ')'; }
    if (hi) return 'En yoğun dönem: ' + joinTr(runs.map(rng)) + '.';
    return lo ? 'Bu konumda belirgin bir yoğun dönem kaydı yok; düşük/orta düzeyde hareket dönemleri aşağıda.' : 'Bu konum için kayıtlı göç dönemi yok.';
  }
  // Gelecekteki bildirimler için veri yapısı (bu turda bildirim YOK): bölge × sezon × grup için başlangıç/bitiş/doruk ayları
  function events(region) {
    var out = [], gs = {};
    for (var i = 0; i < 12; i++) { var x = monthInfo(region, i); if (x.kind !== 'migration') continue; x.groups.forEach(function (gr) { var k = x.season + '|' + gr.id, e = gs[k] || (gs[k] = { region: region.id, season: x.season, group: gr.id, months: [], peak: [] }); e.months.push(i + 1); if (gr.level === 'h') e.peak.push(i + 1); }); }
    Object.keys(gs).forEach(function (k) { out.push(gs[k]); });
    return out;
  }
  function usedSources(region, data) {
    var seen = {}, out = [];
    Object.keys(region.months).forEach(function (m) { region.months[m].src.forEach(function (id) { if (!seen[id] && data.sources[id]) { seen[id] = 1; out.push(Object.assign({ id: id }, data.sources[id])); } }); });
    return out.sort(function (a, b) { return a.id.length === b.id.length ? (a.id < b.id ? -1 : 1) : a.id.length - b.id.length; });
  }
  function windTr(kmh) { return kmh === null ? '' : kmh >= 40 ? 'kuvvetli' : kmh >= 20 ? 'orta' : 'hafif'; }

  var pure = {
    regionFor: regionFor, validate: validate, monthInfo: monthInfo, sentence: sentence, lastMonth: lastMonth, nextSeason: nextSeason, yearSummary: yearSummary, events: events, usedSources: usedSources,
    MONTHS: MONTHS, MABB: MABB, ILABEL: ILABEL, SLABEL: SLABEL, DIR: DIR, BOXES: BOXES, windTr: windTr
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof document === 'undefined') return;

  // ---------------- Arayüz ----------------
  var FKEY = 'hd2:bird:fav', FILE = 'bird-migration-tr.json';
  var C = null, P = { wrap: null, body: null, open: false, opener: null, cid: '' };
  var data = null, loading = null, failed = false, timer = 0;

  function curCity() { return C && C.state.city; }
  function curId() { var c = curCity(); return c ? C.cityId(c) : ''; }
  function todayMonth() { var d = C && C.state.data, t = d && d.current && d.current.time; return typeof t === 'string' && /^\d{4}-\d{2}/.test(t) ? +t.slice(5, 7) - 1 : -1; }
  function follows() { var a = C && C.store(FKEY); return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }) : []; }
  function setFollow(id, on) { var a = follows().filter(function (x) { return x !== id; }); if (on) a.push(id); C.store(FKEY, a); }

  function load() {
    if (data) return Promise.resolve(data);
    if (failed) return Promise.resolve(null);
    if (loading) return loading;
    var inline = C.$('lazy-bird-json'), src;
    try { src = inline ? Promise.resolve(JSON.parse(inline.textContent)) : fetch(FILE).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }); } catch (e) { src = Promise.reject(e); }
    loading = src.then(function (j) { data = validate(j); if (!data) failed = true; loading = null; return data; }).catch(function () { failed = true; loading = null; return null; });
    return loading;
  }
  function ctx() {
    var city = curCity(), mi = todayMonth(), rg = city && data ? regionFor(city) : null;
    if (!data || !rg || mi < 0 || !data.regions[rg.id]) return null;
    var region = data.regions[rg.id];
    return { region: region, edge: rg.edge, mi: mi, info: monthInfo(region, mi) };
  }
  function gName(id, short) { var o = data.groups[id]; return o ? (short ? o.short || o.name : o.name) : id; }

  // ---------- Ana ekran kartı ----------
  // UX kararı: kart yalnızca göç hareketi olan aylarda (düşük/orta/yoğun) görünür. Sakin aylarda ve yalnızca kışlama dönemlerinde gizlenir:
  // ana ekranı "bir şey yok" bilgisiyle doldurmaz. Bölge dışı (Türkiye dışı) konumda hiç görünmez.
  function dtGo() { return '<i class="dt-go" aria-hidden="true">' + C.uiIcon('right', 14) + '</i>'; }
  function cardHtml() {
    var x = ctx(); if (!x || x.info.kind !== 'migration') return '';
    var esc = C.esc, f = follows(), gs = x.info.groups.slice().sort(function (a, b) { return (f.indexOf(b.id) >= 0) - (f.indexOf(a.id) >= 0) || RANK[b.level] - RANK[a.level]; }), names = gs.slice(0, 2).map(function (e) { return gName(e.id, true); });
    var mine = gs.filter(function (e) { return f.indexOf(e.id) >= 0; }).map(function (e) { return gName(e.id, true); });
    var l1 = SLABEL[x.info.season] + ' · ' + ILABEL[x.info.level];
    var label = 'Kuş Göçü: ' + l1 + '. ' + names.join(', ') + '. Ayrıntıları aç';
    return '<div class="drive birdc" data-bird role="button" tabindex="0" aria-haspopup="dialog" aria-label="' + esc(label) + '">' +
      '<span class="drive-i">' + C.uiIcon('bird', 20) + '</span><span class="drive-b"><b>Kuş Göçü</b>' +
      '<span class="bd-l">' + esc(l1) + '</span><span class="bd-l">' + esc(names.join(' · ')) + '</span>' +
      (mine.length ? '<span class="bd-l bd-mine">Takip ettiğin: ' + esc(mine.join(', ')) + '</span>' : '') +
      '<small>' + esc(x.region.name) + ' · mevsimsel takvim</small></span>' + dtGo() + '</div>';
  }
  function fill() {
    var h = C && C.$('birdCard');
    if (h) {
      var html = cardHtml();
      if (h.getAttribute('data-h') !== html) { h.innerHTML = html; h.setAttribute('data-h', html); }
      h.hidden = !html;
    }
    if (P.open) paint();
  }

  // ---------- Panel ----------
  function head() {
    return '<header class="sh-head"><span class="sh-sp" aria-hidden="true"></span><div class="sh-title"><h2 id="bdTitle">Kuş Göç Takvimi</h2><p id="bdSub"></p></div>' +
      '<button type="button" class="sh-x" data-close aria-label="Kapat">' + C.uiIcon('close', 20) + '</button></header>';
  }
  function stripHtml(x) {
    var i, h = '';
    for (i = 0; i < 12; i++) {
      var mi = (x.mi + i) % 12, m = monthInfo(x.region, mi), lv = m.kind === 'migration' ? m.level : m.kind === 'winter' ? 'w' : 'n';
      var lab = m.kind === 'migration' ? ILABEL[m.level] : m.kind === 'winter' ? 'Kış' : 'Sakin';
      h += '<li class="bd-m lv-' + lv + (i === 0 ? ' now' : '') + '"' + (i === 0 ? ' aria-current="date"' : '') + '><span class="bd-bar" aria-hidden="true"></span><b>' + MABB[mi] + '</b><small>' + (i === 0 ? 'Bu ay' : lab) + '</small>' + (i === 0 ? '' : '') + '<span class="sr">' + MONTHS[mi] + ': ' + lab + (m.kind === 'migration' ? ', ' + (SLABEL[m.season]).toLowerCase() : '') + '</span></li>';
    }
    return '<ul class="bd-strip" tabindex="0" aria-label="Önümüzdeki 12 ay">' + h + '</ul>';
  }
  function groupsHtml(x) {
    var f = follows(), esc = C.esc, info = x.info, list = info.groups.slice();
    if (!list.length) return '';
    list.sort(function (a, b) { return (f.indexOf(b.id) >= 0) - (f.indexOf(a.id) >= 0) || RANK[b.level] - RANK[a.level]; });
    return '<h3 class="bd-h">' + (info.kind === 'winter' ? 'Bu dönemde' : 'Bu dönemde öne çıkanlar') + '</h3><ul class="bd-groups">' + list.map(function (e) {
      var on = f.indexOf(e.id) >= 0, nm = gName(e.id);
      return '<li' + (on ? ' class="fol"' : '') + '><span>' + esc(nm) + '</span><b>' + (e.level === 'w' ? 'Kışlama' : ILABEL[e.level]) + '</b>' +
        '<button type="button" class="bd-fol" data-bd-fol="' + esc(e.id) + '" aria-pressed="' + on + '" aria-label="' + esc(nm + (on ? ' takibi bırak' : ' takip et')) + '">' + C.uiIcon('star', 18, on ? 'filled' : '') + '</button></li>';
    }).join('') + '</ul>';
  }
  function dirHtml(x) {
    var s = x.info.season; if (s !== 'spring' && s !== 'autumn') return '';
    return '<p class="bd-dir"><span class="bd-arr ' + s + '" aria-hidden="true">' + (s === 'spring' ? '↑' : '↓') + '</span>' + DIR[s] + '</p>';
  }
  function weatherHtml() {
    var d = C.state.data, c = d && d.current; if (!c) return '';
    var info = C.describe(c.weather_code, c.is_day === 1), w = num(c.wind_speed_10m), parts = [info.text];
    if (w !== null) parts.push('rüzgâr ' + windTr(w) + ' (' + Math.round(w) + ' km/s)');
    return '<p class="bd-wx">Şu anki hava: ' + C.esc(parts.join(', ')) + '. Hava durumu, kuşların davranışı hakkında kesin bir sonuç vermez.</p>';
  }
  function dynHtml(x) {
    var esc = C.esc, info = x.info, html = '', last = lastMonth(x.region, x.mi), nx = nextSeason(x.region, x.mi);
    var top = info.kind === 'migration' ? SLABEL[info.season] + ' · ' + ILABEL[info.level] : info.kind === 'winter' ? SLABEL.winter : 'Sakin dönem';
    html += '<div class="bd-top"><b>' + esc(top) + '</b><p>' + esc(sentence(info, data.groups)) + '</p>' + dirHtml(x) +
      (last !== null ? '<small>' + (info.level === 'h' ? 'Yoğun geçiş dönemi ' + MONTHS[last] + ' ayına kadar sürebilir.' : 'Bu hareket ' + MONTHS[last] + ' ayı sonuna kadar sürebilir.') + (info.q ? ' Ay içi dağılım doğrulanamadı.' : '') + '</small>' : '') +
      (info.kind === 'calm' && nx ? '<small>Bir sonraki hareket dönemi: ' + MONTHS[nx.month] + ' (' + SLABEL[nx.season].toLowerCase() + ').</small>' : '') + '</div>';
    if (x.edge) html += '<p class="bd-edge">Konum bölge sınırına yakın; komşu bölgenin dönemleri de geçerli olabilir. Bölgeler kaba bir coğrafi eşlemedir, kesin biyolojik sınır değildir.</p>';
    html += groupsHtml(x);
    html += '<h3 class="bd-h">Önümüzdeki 12 ay</h3>' + stripHtml(x) + '<p class="bd-sum">' + esc(yearSummary(x.region)) + '</p>';
    html += weatherHtml();
    var conf = data.conf[x.region.conf] || '';
    html += '<div class="pol-info bd-notes"><p><b>Bu bölüm canlı kuş konumu göstermez.</b> Göç dönemleri mevsimsel takvim ve bölgesel bilgilerden oluşturulur. Düşük/Orta/Yoğun seviyeleri canlı kuş sayısı değil, takvimsel göç yoğunluğudur.</p>' +
      '<p>Bölge: ' + esc(x.region.name) + '. ' + esc(x.region.note) + (conf ? ' Veri güveni: ' + esc(conf) : '') + '</p>' +
      '<p>Takip ettiğin gruplar yalnızca bu cihazda saklanır.</p>' +
      '<p class="bd-src"><b>Kaynaklar</b></p><ul>' + usedSources(x.region, data).map(function (s) { return '<li>' + esc(s.t) + ' <span>(' + esc(s.use) + ')</span></li>'; }).join('') + '</ul></div>';
    return html;
  }
  function paint() {
    if (!P.open) return;
    var x = ctx(), sub = C.$('bdSub'), dyn = C.$('bdDyn');
    if (!x) { close(true); return; }
    var city = curCity();
    if (sub) sub.textContent = (C.cityTitle ? C.cityTitle(city) : city.name) + ' · ' + x.region.name + ' · ' + MONTHS[x.mi];
    var keep = dyn && dyn.querySelector('.bd-strip') ? dyn.querySelector('.bd-strip').scrollLeft : 0;
    if (dyn) { dyn.innerHTML = dynHtml(x); var st = dyn.querySelector('.bd-strip'); if (st) st.scrollLeft = keep; }
  }
  function open(opener) {
    if (!P.wrap || !ctx()) return;
    document.dispatchEvent(new CustomEvent('hd2:sheet', { detail: 'bird' }));
    if (opener) P.opener = opener;
    P.cid = curId();
    if (!P.open) {
      P.wrap.hidden = false; void P.wrap.offsetWidth; P.wrap.classList.add('open'); P.open = true;
      document.documentElement.classList.add('lock');
      C.app.setAttribute('aria-hidden', 'true'); if ('inert' in C.app) C.app.inert = true;
    }
    P.body.innerHTML = head() + '<div id="bdDyn"></div>';
    paint();
    var xb = P.body.querySelector('.sh-x'); if (xb) xb.focus({ preventScroll: true });
  }
  function close(silent) {
    if (!P.wrap || P.wrap.hidden) return;
    P.wrap.classList.remove('open'); P.open = false;
    document.documentElement.classList.remove('lock');
    C.app.removeAttribute('aria-hidden'); if ('inert' in C.app) C.app.inert = false;
    var done = function () { if (!P.open) { P.wrap.hidden = true; P.wrap.querySelector('.sheet').style.transform = ''; } };
    if (C.reduceMotion() || silent) done(); else setTimeout(done, 260);
    if (!silent && P.opener && document.contains(P.opener)) P.opener.focus();
  }
  document.addEventListener('hd2:sheet', function (ev) { if (ev.detail !== 'bird') close(true); });

  function sync() {
    if (!C) return;
    if (P.open && curId() !== P.cid) close(true);   // konum değişti: eski bölgenin paneli kapanır
    if (data) fill(); else if (!failed) { fill(); clearTimeout(timer); timer = setTimeout(function () { load().then(function () { fill(); }); }, 400); }   // ana ekran çizildikten sonra (yerel, küçük dosya)
  }

  function bind() {
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('[data-bird]');
      if (t && !P.wrap.contains(t)) open(t);
    });
    document.addEventListener('keydown', function (ev) {
      var t = ev.target.closest && ev.target.closest('[data-bird]');
      if (t && (ev.key === 'Enter' || ev.key === ' ') && !P.wrap.contains(t)) { ev.preventDefault(); open(t); }
    });
    P.wrap.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-close]') || ev.target.classList.contains('sheet-bg')) { close(); return; }
      var f = ev.target.closest('[data-bd-fol]');
      if (f) { var id = f.getAttribute('data-bd-fol'); setFollow(id, f.getAttribute('aria-pressed') !== 'true'); paint(); fill(); var again = P.body.querySelector('[data-bd-fol="' + id + '"]'); if (again) again.focus({ preventScroll: true }); }
    });
    document.addEventListener('keydown', function (ev) {
      if (P.wrap.hidden) return;
      if (ev.key === 'Escape') { close(); return; }
      if (ev.key === 'Tab') {
        var fo = Array.prototype.filter.call(P.wrap.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]'), function (b) { return b.offsetParent !== null; });
        if (!fo.length) return;
        var first = fo[0], last = fo[fo.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    });
    var grip = C.$('bdGrip'), panel = P.wrap.querySelector('.sheet'), y0 = null, dy = 0;
    grip.addEventListener('pointerdown', function (ev) { y0 = ev.clientY; dy = 0; panel.style.transition = 'none'; grip.setPointerCapture(ev.pointerId); });
    grip.addEventListener('pointermove', function (ev) { if (y0 == null) return; dy = Math.max(0, ev.clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; });
    function end() { if (y0 == null) return; y0 = null; panel.style.transition = ''; if (dy > 90) close(); else panel.style.transform = ''; }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });   // gün/ay değişimi: uygulama öne gelince ay yeniden okunur
  }

  g.HDBird = {
    init: function (cx) { C = cx; P.wrap = C.$('bdSheet'); P.body = C.$('bdBody'); if (P.wrap) bind(); },
    sync: sync, open: open, close: function () { close(); },
    _pure: pure,
    _state: function () { var x = ctx(); return { open: P.open, loaded: !!data, failed: failed, region: x && x.region.id, kind: x && x.info.kind, level: x && x.info.level }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
