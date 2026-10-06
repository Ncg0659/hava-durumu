'use strict';
(function () {
  // ---------- Ayarlar ----------
  var API_FORECAST = 'https://api.open-meteo.com/v1/forecast';
  var API_GEO = 'https://geocoding-api.open-meteo.com/v1/search';
  var API_AQ = 'https://air-quality-api.open-meteo.com/v1/air-quality';
  var DEFAULT_CITY = { name: 'İstanbul', admin: 'İstanbul', country: 'Türkiye', lat: 41.0138, lon: 28.9497 };
  var FAV_KEY = 'hd2:favs';
  var LAST_KEY = 'hd2:last';
  var WX_KEY = 'hd2:wx';          // çevrimdışı için son başarılı hava verisi (en fazla WX_MAX şehir)
  var WX_MAX = 6;
  var WX_MAX_AGE = 24 * 3600 * 1000; // bundan eski veri hiç gösterilmez
  var MAX_FAVS = 12;
  var reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduceMotion() { return !!(reduceMQ && reduceMQ.matches); }
  var LOW_POWER = (navigator.hardwareConcurrency || 8) <= 4; // zayıf cihazlarda daha az parçacık
  // Açılış ölçümü: performance.mark ile (adres sonuna ?perf eklenirse konsola tablo basılır)
  function mark(n) { try { performance.mark('hd:' + n); } catch (e) { /* önemli değil */ } }
  mark('boot');
  var MIN_SPLASH = 300;        // açılış ekranı en az bu kadar (ms) görünür; hazırsa fazla beklenmez
  var FRESH_MS = 10 * 60000;   // bu kadar yeni önbellek varsa ağ beklenmeden hemen gösterilir
  var COLD_TIMEOUT = 8000;     // soğuk açılışta ağ bu kadar yanıt vermezse önbelleğe/hata mesajına geçilir
  var boot = { motion: false, needle: false, firstTheme: true };

  // ---------- Kısa yardımcılar ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function round(n) { var r = Math.round(n); return r === 0 ? 0 : r; }
  function num(n) { var r = round(n); return r < 0 ? '−' + (-r) : String(r); } // gerçek eksi işareti
  function deg(n) { return num(n) + '°'; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function store(key, value) {
    try {
      if (value === undefined) { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* özel pencere vb. durumlarda sessizce devam et */ }
    return null;
  }

  // ---------- Hava durumu kodları (WMO) ----------
  var WMO = {
    0: ['Açık', 'clear', 'clear'], 1: ['Çoğunlukla açık', 'clear', 'clear'],
    2: ['Parçalı bulutlu', 'partly', 'cloud'], 3: ['Kapalı', 'overcast', 'cloud'],
    45: ['Sisli', 'fog', 'fog'], 48: ['Kırağılı sis', 'fog', 'fog'],
    51: ['Hafif çise', 'drizzle', 'rain'], 53: ['Çise', 'drizzle', 'rain'], 55: ['Yoğun çise', 'drizzle', 'rain'],
    56: ['Donan çise', 'sleet', 'rain'], 57: ['Yoğun donan çise', 'sleet', 'rain'],
    61: ['Hafif yağmur', 'rain', 'rain'], 63: ['Yağmur', 'rain', 'rain'], 65: ['Şiddetli yağmur', 'heavy', 'rain'],
    66: ['Donan yağmur', 'sleet', 'rain'], 67: ['Şiddetli donan yağmur', 'sleet', 'rain'],
    71: ['Hafif kar', 'snow', 'snow'], 73: ['Kar', 'snow', 'snow'], 75: ['Yoğun kar', 'snow', 'snow'], 77: ['Kar taneleri', 'snow', 'snow'],
    80: ['Hafif sağanak', 'showers', 'rain'], 81: ['Sağanak', 'showers', 'rain'], 82: ['Şiddetli sağanak', 'heavy', 'rain'],
    85: ['Hafif kar sağanağı', 'snow', 'snow'], 86: ['Kar sağanağı', 'snow', 'snow'],
    95: ['Gök gürültülü fırtına', 'storm', 'storm'], 96: ['Dolulu fırtına', 'storm', 'storm'], 99: ['Şiddetli dolulu fırtına', 'storm', 'storm']
  };
  function describe(code, isDay) {
    var w = WMO[code] || ['Bilinmiyor', 'overcast', 'cloud'];
    var theme = w[2];
    if (theme === 'clear' || theme === 'cloud' || theme === 'rain' || theme === 'snow') theme += isDay ? '-day' : '-night';
    return { text: w[0], kind: w[1], theme: theme };
  }
  function isWet(c) { return (c >= 51 && c <= 67) || (c >= 80 && c <= 82); }
  function isSnow(c) { return (c >= 71 && c <= 77) || c === 85 || c === 86; }
  var THEME_COLOR = {
    'clear-day': '#1668c9', 'clear-night': '#070f26', 'cloud-day': '#3f5f80', 'cloud-night': '#101823',
    'fog': '#566570', 'rain-day': '#2c4764', 'rain-night': '#0c141e', 'snow-day': '#42658a', 'snow-night': '#18253a', 'storm': '#15132c'
  };

  // ---------- Zaman (API şehrin yerel saatini yazı olarak verir) ----------
  function parts(s) { return { y: +s.slice(0, 4), mo: +s.slice(5, 7), d: +s.slice(8, 10), h: +s.slice(11, 13), mi: +s.slice(14, 16) }; }
  function hm(s) { return s.slice(11, 16); }
  function minutes(s) { var p = parts(s); return p.h * 60 + p.mi; }
  function dayName(dateStr, i) {
    if (i === 0) return 'Bugün';
    if (i === 1) return 'Yarın';
    var p = parts(dateStr + 'T12:00');
    return new Date(p.y, p.mo - 1, p.d).toLocaleDateString('tr-TR', { weekday: 'long' });
  }
  function longDate(s) {
    var p = parts(s);
    return new Date(p.y, p.mo - 1, p.d).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + hm(s);
  }

  // ---------- Etiketler ----------
  var FROM = ['Kuzeyden', 'Kuzeydoğudan', 'Doğudan', 'Güneydoğudan', 'Güneyden', 'Güneybatıdan', 'Batıdan', 'Kuzeybatıdan'];
  function windFrom(d) { return FROM[Math.round(d / 45) % 8]; }
  function humidityLabel(h) { return h < 30 ? 'Kuru' : h < 60 ? 'Konforlu' : h < 80 ? 'Nemli' : 'Çok nemli'; }
  var UV_CLASSES = [['Düşük', '#34c759'], ['Orta', '#ffd60a'], ['Yüksek', '#ff9f0a'], ['Çok yüksek', '#ff453a'], ['Aşırı', '#bf5af2']];
  function uvClass(u) { return u < 3 ? 0 : u < 6 ? 1 : u < 8 ? 2 : u < 11 ? 3 : 4; }

  // ---------- Yağış görünümü (önümüzdeki 12 saat) ----------
  function rainOutlook(h, start) {
    var bars = [], max = 0, first = -1, k, p;
    for (k = 0; k < 12 && start + k < h.time.length; k++) {
      p = h.precipitation_probability[start + k] || 0;
      bars.push(p);
      if (p > max) max = p;
      if (first < 0 && p >= 40) first = k;
    }
    return { bars: bars, max: max, first: first };
  }
  function rainText(o, wetNow) {
    if (wetNow) return 'Şu an yağış var';
    if (o.first === 0) return 'Şu an yüksek ihtimal';
    if (o.first > 0) return 'Yaklaşık ' + o.first + ' saat sonra yağış';
    return 'Önümüzdeki 12 saat kuru';
  }

  // ---------- Akıllı öneriler ----------
  // En önemlisi başa gelir; en fazla 3 öneri gösterilir.
  function tipsFor(x) {
    var t = [], c = x.code, wet = isWet(c), snowy = isSnow(c), storm = c >= 95, freezing = c === 56 || c === 57 || c === 66 || c === 67;
    if (storm) t.push({ i: 'bolt', c: '#ffd23f', long: 'Fırtına var, mümkünse içeride kal', short: 'Fırtına' });
    if (freezing || (x.minNext <= 1 && (wet || snowy || x.rain.max >= 30 || x.hum >= 85))) {
      t.push({ i: 'snowflake', c: '#9fe7ff', long: 'Buzlanma olabilir, dikkatli yürü', short: 'Buzlanma riski' });
    } else if (snowy) {
      t.push({ i: 'snowflake', c: '#d6ecff', long: 'Kar var, zemin kaygan olabilir', short: 'Kaygan zemin' });
    }
    var aqTip = x.aqi >= 60 ? { i: 'mask', c: '#ffb3c1', long: x.aqi >= 80 ? 'Hava kalitesi çok kötü, dışarıda uzun kalma' : 'Hava kalitesi kötü, dışarıda efor yapma', short: 'Hava kirli' } : null;
    if (aqTip && x.aqi >= 80) t.push(aqTip);
    if (wet) t.push({ i: 'umbrella', c: '#6ec6ff', long: 'Yağış var, şemsiyeni yanına al', short: 'Şemsiye al' });
    else if (x.rain.first === 0) t.push({ i: 'umbrella', c: '#6ec6ff', long: 'Yağış ihtimali şu an yüksek, şemsiye al', short: 'Şemsiye al' });
    else if (x.rain.first > 0 && x.rain.first <= 6) t.push({ i: 'umbrella', c: '#6ec6ff', long: 'Yaklaşık ' + x.rain.first + ' saat sonra yağış var, şemsiye al', short: 'Şemsiye al' });
    else if (x.rainDay >= 60) t.push({ i: 'umbrella', c: '#6ec6ff', long: 'Bugün yağış ihtimali yüksek, şemsiye al', short: 'Şemsiye al' });
    if (x.wind >= 40) t.push({ i: 'wind', c: '#b6f0e0', long: 'Rüzgâr çok kuvvetli, dışarıda dikkatli ol', short: 'Kuvvetli rüzgâr' });
    else if (x.wind >= 28) t.push({ i: 'wind', c: '#b6f0e0', long: 'Rüzgâr kuvvetli, hafif eşyaları sabitle', short: 'Rüzgârlı' });
    if (aqTip && x.aqi < 80) t.push(aqTip);
    if (x.isDay && x.uv >= 6 && !wet && !storm) t.push({ i: 'sun', c: '#ffc93c', long: 'Güneş kremi sürmeyi unutma', short: 'Güneş kremi' });
    if (x.feels <= 3) t.push({ i: 'jacket', c: '#ffab7a', long: 'Hava çok soğuk, kalın giyin', short: 'Kalın giyin' });
    else if (x.feels <= 10) t.push({ i: 'jacket', c: '#ffab7a', long: 'Serin, mont giymeni öneririm', short: 'Mont giy' });
    if (x.feels >= 30) t.push({ i: 'thermo', c: '#ff7a59', long: 'Hava sıcak, bol su iç ve gölgede kal', short: 'Sıcak hava' });
    if (!t.length) t.push(x.isDay ? { i: 'smile', c: '#ffd166', long: 'Güzel bir gün, keyfini çıkar', short: 'Güzel gün' }
      : { i: 'moon', c: '#cfd8ff', long: 'Sakin bir akşam, iyi dinlenmeler', short: 'İyi geceler' });
    return t.slice(0, 3);
  }

  // ---------- Durum ----------
  var state = { city: null, data: null, aq: null, aqState: 'idle', aqCtl: null, start: 0, favs: store(FAV_KEY) || [], loadCtl: null, geoCtl: null, items: [], active: -1 };
  var el = {
    app: $('app'), content: $('content'), msg: $('msg'), q: $('q'), form: $('search'), suggest: $('suggest'),
    favs: $('favs'), sky: $('sky'), fx: $('fx'), theme: document.querySelector('meta[name="theme-color"]')
  };
  function cityId(c) { return c.lat.toFixed(2) + ',' + c.lon.toFixed(2); }
  function isFav(c) { return state.favs.some(function (f) { return f.id === cityId(c); }); }
  function cityLabel(c) { return [c.admin && c.admin !== c.name ? c.admin : '', c.country].filter(Boolean).join(', '); }

  // ---------- Gökyüzü + efektler (sadece transform/opacity animasyonu) ----------
  var currentTheme = '';
  boot.booting = true;
  function setTheme(theme) {
    if (theme === currentTheme) return;
    currentTheme = theme;
    // İlk uygulamada gökyüzü geçişsiz oturur: splash kalktığında altındaki renk zaten hazır (sert renk sıçraması olmaz)
    if (boot.firstTheme) { boot.firstTheme = false; el.sky.classList.add('nt'); }
    Array.prototype.forEach.call(el.sky.children, function (n) { n.classList.toggle('on', n.dataset.theme === theme); });
    if (el.sky.classList.contains('nt')) requestAnimationFrame(function () { requestAnimationFrame(function () { el.sky.classList.remove('nt'); }); });
    if (el.theme) el.theme.setAttribute('content', THEME_COLOR[theme] || '#1668c9');
    try { localStorage.setItem('hd2:themeName', theme); localStorage.setItem('hd2:themeColor', THEME_COLOR[theme] || '#1668c9'); } catch (e) { /* açılış rengi hatırlanamaz, sorun değil */ }
    if (boot.motion) buildFx(theme);   // açılışta dekoratif efektler splash kalktıktan sonra başlar
  }
  // Giriş animasyonu: yalnızca opacity + transform; Web Animations API (zorunlu reflow yok)
  function revealContent(ms) {
    if (reduceMotion()) return;
    var n = el.content;
    if (n.animate) n.animate([{ opacity: 0, transform: 'translate3d(0,10px,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { duration: ms || 450, easing: 'cubic-bezier(.2,.7,.2,1)' });
    else { n.classList.remove('reveal'); void n.offsetWidth; n.classList.add('reveal'); }
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function buildFx(theme) {
    el.fx.textContent = '';
    if (reduceMotion()) return;
    var sc = LOW_POWER ? 0.6 : 1, f = document.createDocumentFragment(), i, n;
    function add(cls, style) { n = document.createElement('i'); n.className = cls; n.style.cssText = style; f.appendChild(n); }
    if (theme.indexOf('rain') === 0 || theme === 'storm') {
      for (i = 0; i < Math.round(22 * sc); i++) add('rain', 'left:' + rnd(0, 100).toFixed(1) + '%;height:' + rnd(12, 22).toFixed(0) + 'px;animation-duration:' + rnd(1.1, 1.7).toFixed(2) + 's;animation-delay:-' + rnd(0, 1.7).toFixed(2) + 's');
      if (theme === 'storm') add('flash', '');
    } else if (theme.indexOf('snow') === 0) {
      for (i = 0; i < Math.round(20 * sc); i++) { var s = rnd(3, 6).toFixed(1); add('snow', 'left:' + rnd(0, 100).toFixed(1) + '%;width:' + s + 'px;height:' + s + 'px;--dx:' + rnd(-36, 36).toFixed(0) + 'px;animation-duration:' + rnd(10, 16).toFixed(1) + 's;animation-delay:-' + rnd(0, 16).toFixed(1) + 's'); }
    } else if (theme === 'clear-night') {
      for (i = 0; i < Math.round(34 * sc); i++) add('star', 'left:' + rnd(0, 100).toFixed(1) + '%;top:' + rnd(0, 70).toFixed(1) + '%;animation-delay:-' + rnd(0, 6).toFixed(1) + 's;animation-duration:' + rnd(4, 7).toFixed(1) + 's');
    } else if (theme === 'clear-day') {
      add('glow', '');
    } else if (theme.indexOf('cloud') === 0 || theme === 'fog') {
      for (i = 0; i < 2; i++) add('softcloud', 'top:' + (10 + i * 30) + '%;animation-duration:' + (110 + i * 40) + 's;animation-delay:-' + (i * 55) + 's');
    }
    el.fx.appendChild(f);
    requestAnimationFrame(function () { el.fx.classList.add('in'); });
  }
  document.addEventListener('visibilitychange', function () { el.fx.classList.toggle('paused', document.hidden); });
  if (reduceMQ && reduceMQ.addEventListener) reduceMQ.addEventListener('change', function () { buildFx(currentTheme); });

  // ---------- Çizim parçaları ----------
  function tipsHtml(tips) {
    return '<div class="tips" aria-label="Öneriler">' + tips.map(function (t, i) {
      return '<span class="tip' + (i ? ' sm' : '') + '"><span class="tip-i" style="background:' + t.c + '">' + uiIcon(t.i, i ? 14 : 18) + '</span>' + (i ? t.short : t.long) + '</span>';
    }).join('') + '</div>';
  }

  function humidityCard(hum) {
    var v = round(hum);
    return '<div class="card stat"><div class="stat-h">' + uiIcon('drop', 17) + '<span>Nem</span></div>' +
      '<div class="stat-v">%' + v + '</div>' +
      '<div class="hbar" role="img" aria-label="Nem %' + v + '"><i style="width:' + v + '%"></i><u style="left:30%"></u><u style="left:60%"></u></div>' +
      '<div class="stat-s"><b>' + humidityLabel(hum) + '</b></div></div>';
  }
  function windCard(speed, dir) {
    var to = (round(dir) + 180) % 360;
    return '<div class="card stat"><div class="stat-h">' + uiIcon('wind', 17) + '<span>Rüzgâr</span></div>' +
      '<div class="wind-row"><div class="stat-v">' + round(speed) + '<small> km/sa</small></div>' +
      '<svg class="dial" viewBox="0 0 48 48" width="52" height="52" role="img" aria-label="Rüzgâr ' + windFrom(dir) + ' esiyor">' +
        '<circle cx="24" cy="24" r="21" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.4)" stroke-width="1.5"/>' +
        '<path d="M24 3v4M24 41v4M3 24h4M41 24h4" stroke="rgba(255,255,255,.55)" stroke-width="1.5" stroke-linecap="round"/>' +
        '<text x="24" y="17" text-anchor="middle" font-size="7" font-weight="700" fill="rgba(255,255,255,.8)">K</text>' +
        '<g class="needle" data-to="' + to + '" style="transform-origin:24px 24px;transform:rotate(0deg)"><path d="M24 11l6 17-6-3.5L18 28z" fill="#fff"/></g></svg></div>' +
      '<div class="stat-s"><b>' + windFrom(dir) + '</b> · ' + round(dir) + '°</div></div>';
  }
  function rainCard(o, wetNow) {
    var bars = o.bars.map(function (p, i) {
      return '<i style="height:' + Math.max(12, p) + '%"' + (p < 10 ? ' class="lo"' : '') + ' title="' + (i === 0 ? 'Şimdi' : '+' + i + ' sa') + ': %' + round(p) + '"></i>';
    }).join('');
    return '<div class="card stat"><div class="stat-h">' + uiIcon('umbrella', 17) + '<span>Yağış ihtimali</span></div>' +
      '<div class="stat-v">%' + round(o.max) + '</div>' +
      '<div class="rbars" role="img" aria-label="Önümüzdeki 12 saatin yağış ihtimali">' + bars + '</div>' +
      '<div class="stat-s">' + rainText(o, wetNow) + '</div></div>';
  }
  function uvCard(uv) {
    var k = uvClass(uv), cls = UV_CLASSES[k];
    return '<div class="card stat"><div class="stat-h">' + uiIcon('sun', 17) + '<span>UV indeksi</span></div>' +
      '<div class="stat-v">' + round(uv) + '<span class="chipuv" style="background:' + cls[1] + '">' + cls[0] + '</span></div>' +
      '<div class="uvscale" role="img" aria-label="UV ' + round(uv) + ', ' + cls[0] + '"><i style="flex:3;background:#34c759"></i><i style="flex:3;background:#ffd60a"></i><i style="flex:2;background:#ff9f0a"></i><i style="flex:3;background:#ff453a"></i><i style="flex:1;background:#bf5af2"></i><b style="left:' + r1(Math.min(uv / 12, 1) * 100) + '%"></b></div>' +
      '<div class="stat-s">Bugün en yüksek</div></div>';
  }

  // Kompakt güneş yolu: gerçek saate göre konum
  function sunCard(d) {
    var rise = minutes(d.sunrise), set = minutes(d.sunset), now = minutes(d.time), len = set - rise;
    var f = (now - rise) / len, night = f <= 0 || f >= 1, fc = Math.max(0, Math.min(1, f));
    var X0 = 8, XW = 184, B = 46, A = 36, i, t;
    function pt(u) { return r1(X0 + XW * u) + ',' + r1(B - A * Math.sin(Math.PI * u)); }
    var full = [], past = [];
    for (i = 0; i <= 40; i++) full.push(pt(i / 40));
    for (i = 0; i <= 30; i++) past.push(pt(fc * i / 30));
    var dot = pt(fc).split(',');
    return '<section class="card" aria-labelledby="h-sun"><div class="card-h"><h2 id="h-sun">Güneş</h2><span class="sm">' + (night ? 'Şu an gece · ' : '') + 'Gün uzunluğu ' + Math.floor(len / 60) + ' sa ' + (len % 60) + ' dk</span></div>' +
      '<div class="sunrow"><div class="st">' + uiIcon('sunrise', 20) + '<b>' + hm(d.sunrise) + '</b><span>Doğuş</span></div>' +
      '<svg class="sunpath" viewBox="0 0 200 56" role="img" aria-label="Güneşin gün içindeki yolu">' +
        '<line x1="0" y1="' + B + '" x2="200" y2="' + B + '" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>' +
        '<polyline points="' + full.join(' ') + '" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="2" stroke-dasharray="1.5 5" stroke-linecap="round"/>' +
        '<polyline points="' + past.join(' ') + '" fill="none" stroke="#FFC93C" stroke-width="3" stroke-linecap="round" opacity="' + (night ? 0.2 : 1) + '"/>' +
        (night ? '' : '<circle cx="' + dot[0] + '" cy="' + dot[1] + '" r="11" fill="#FFC93C" opacity=".25"/>') +
        '<circle cx="' + dot[0] + '" cy="' + dot[1] + '" r="5.5" fill="' + (night ? '#cfd8ff' : '#FFC93C') + '"/></svg>' +
      '<div class="st">' + uiIcon('sunset', 20) + '<b>' + hm(d.sunset) + '</b><span>Batış</span></div></div></section>';
  }

  function hourlyCard(h, start, wantAnim) {
    var end = Math.min(start + 24, h.time.length), i, anyWind = false, out = '';
    for (i = start; i < end; i++) if ((h.wind_speed_10m[i] || 0) >= 30) anyWind = true;
    for (i = start; i < end; i++) {
      var day = h.is_day[i] === 1, info = describe(h.weather_code[i], day), p = h.precipitation_probability[i] || 0, w = h.wind_speed_10m[i] || 0, now = i === start;
      out += '<li class="hr' + (now ? ' now' : day ? '' : ' night') + '"><span class="hr-t">' + (now ? 'Şimdi' : hm(h.time[i])) + '</span>' +
        weatherIcon(info.kind, day, 34, now && wantAnim) + '<b>' + deg(h.temperature_2m[i]) + '</b>' +
        '<span class="hr-p">' + (p >= 10 ? '%' + round(p) : '&nbsp;') + '</span>' +
        (anyWind ? '<span class="hr-w">' + (w >= 30 ? uiIcon('wind', 12) + round(w) : '&nbsp;') + '</span>' : '') + '</li>';
    }
    return '<section class="card" aria-labelledby="h-hr"><h2 id="h-hr">Saatlik tahmin</h2><ul class="strip">' + out + '</ul></section>';
  }

  function dailyCard(dl, curTemp) {
    var lo = Math.min.apply(null, dl.temperature_2m_min), hiT = Math.max.apply(null, dl.temperature_2m_max), span = Math.max(hiT - lo, 1), j, out = '';
    for (j = 0; j < dl.time.length; j++) {
      var di = describe(dl.weather_code[j], true), mn = dl.temperature_2m_min[j], mx = dl.temperature_2m_max[j];
      // Ortak ölçek: tüm günler aynı [lo, hiT] aralığına göre konumlanır
      var l = (mn - lo) / span, w = Math.max((mx - mn) / span, 0.04);
      if (l + w > 1) l = 1 - w;
      var pos = w >= 1 ? 0 : (l / (1 - w)) * 100, dp = dl.precipitation_probability_max[j];
      var dotp = Math.max(0, Math.min(1, (curTemp - lo) / span));
      out += '<li><button type="button" class="dy" data-day="' + j + '" aria-haspopup="dialog" aria-label="' + dayName(dl.time[j], j) + ' ayrıntılarını aç"><span class="dy-n">' + dayName(dl.time[j], j) + '</span>' + weatherIcon(di.kind, true, 32, false) +
        '<span class="dy-p">' + (dp >= 20 ? '%' + round(dp) : '') + '</span><span class="dy-lo">' + deg(mn) + '</span>' +
        '<span class="bar" aria-hidden="true"><i data-min="' + mn + '" data-max="' + mx + '" style="left:' + r1(l * 100) + '%;width:' + r1(w * 100) + '%;background-size:' + Math.round(10000 / (w * 100)) + '% 100%;background-position:' + r1(pos) + '% 0"></i>' +
        (j === 0 ? '<s style="left:' + r1(dotp * 100) + '%" title="Şu an"></s>' : '') + '</span>' +
        '<span class="dy-hi">' + deg(mx) + '</span></button></li>';
    }
    return '<section class="card" id="dailyCard" aria-labelledby="h-dy"><div class="card-h"><h2 id="h-dy">' + dl.time.length + ' günlük tahmin</h2><span class="sm">Ortak ölçek: ' + deg(lo) + ' – ' + deg(hiT) + '</span></div><ul class="days">' + out + '</ul><p class="hint">Ayrıntı için bir güne dokun.</p></section>';
  }

  function render(city, data, opts) {
    if (window.WeatherMap) window.WeatherMap.destroy(); // eski kart DOM'dan kalkıyor; harita yeniden kurulur
    var c = data.current, h = data.hourly, dl = data.daily;
    var isDay = c.is_day === 1, info = describe(c.weather_code, isDay);
    var uvToday = dl.uv_index_max[0] || 0, rainToday = dl.precipitation_probability_max[0] || 0;
    setTheme(info.theme);

    var hourStart = c.time.slice(0, 13) + ':00', start = h.time.indexOf(hourStart);
    if (start < 0) start = 0;
    var outlook = rainOutlook(h, start), wetNow = isWet(c.weather_code);
    state.start = start;
    var tips = tipsFor(tipsInput());

    var fav = isFav(city);
    el.content.innerHTML =
      '<section class="hero" aria-label="Şu anki hava durumu">' +
        '<button class="fav-btn" id="favBtn" type="button" aria-pressed="' + fav + '" aria-label="' + (fav ? 'Favorilerden çıkar' : 'Favorilere ekle') + '">' + uiIcon('star', 22, fav ? 'filled' : '') + '</button>' +
        '<h1>' + esc(city.name) + '</h1><p class="sub">' + esc(cityLabel(city)) + (cityLabel(city) ? ' · ' : '') + longDate(c.time) + '</p>' +
        '<div class="nowrow">' + weatherIcon(info.kind, isDay, 104, true) +
          '<div class="now-t"><div class="temp" aria-label="' + num(c.temperature_2m) + ' derece">' + num(c.temperature_2m) + '<sup>°</sup></div><p class="cond">' + info.text + '</p></div></div>' +
        '<p class="meta"><span><span class="sr">En yüksek </span>↑ ' + deg(dl.temperature_2m_max[0]) + '</span><span><span class="sr">En düşük </span>↓ ' + deg(dl.temperature_2m_min[0]) + '</span><span>Hissedilen ' + deg(c.apparent_temperature) + '</span></p>' +
        tipsHtml(tips) +
      '</section>' +
      '<section class="stats" aria-label="Ayrıntılar">' + humidityCard(c.relative_humidity_2m) + windCard(c.wind_speed_10m, c.wind_direction_10m) + rainCard(outlook, wetNow) + uvCard(uvToday) + '</section>' +
      hourlyCard(h, start, !reduceMotion()) +
      '<section class="card today" id="todayCard" aria-labelledby="h-today"></section>' +
      '<section class="card aq" id="aqCard" aria-labelledby="h-aq"></section>' +
      mapShell() +
      sunCard({ sunrise: dl.sunrise[0], sunset: dl.sunset[0], time: c.time }) + dailyCard(dl, c.temperature_2m);
    mark('render-html');
    fillInsights();
    mark('render-insights');

    $('favBtn').addEventListener('click', toggleFav);
    if (!boot.booting && !(opts && opts.noReveal)) revealContent(500);   // açılışta giriş animasyonunu hideSplash başlatır

    // Rüzgâr oku: 0°'den gerçek yöne doğru döner
    var needle = el.content.querySelector('.needle');
    if (needle) {
      var to = needle.getAttribute('data-to');
      if (reduceMotion()) needle.style.transform = 'rotate(' + to + 'deg)';
      else if (!boot.motion) boot.needle = true;   // açılışta ok, hareket aşaması başlayınca döner
      else requestAnimationFrame(function () { requestAnimationFrame(function () { needle.style.transform = 'rotate(' + to + 'deg)'; }); });
    }
    if (state.mapOpen) openMap(true);
  }

  // ---------- Aşama 2: bugünün özeti, aktiviteler, hava kalitesi ----------
  function tipsInput() {
    var d = state.data, c = d.current, h = d.hourly, dl = d.daily, s = state.start, k, minNext = c.temperature_2m;
    for (k = s; k < Math.min(s + 12, h.time.length); k++) if (h.temperature_2m[k] < minNext) minNext = h.temperature_2m[k];
    return { code: c.weather_code, isDay: c.is_day === 1, feels: c.apparent_temperature, wind: c.wind_speed_10m, hum: c.relative_humidity_2m,
      uv: dl.uv_index_max[0] || 0, rain: rainOutlook(h, s), rainDay: dl.precipitation_probability_max[0] || 0, minNext: minNext,
      aqi: state.aq ? state.aq.value : null };
  }
  // Aktivite değerlendirmesi: önümüzdeki 3 saatin ortalaması/en kötüsü
  function activityInput() {
    var d = state.data, c = d.current, h = d.hourly, s = state.start, k, n = 0, fsum = 0, wmax = c.wind_speed_10m, pmax = 0, wet = false, snow = false, storm = false;
    for (k = s; k < Math.min(s + 3, h.time.length); k++) {
      n++; fsum += h.apparent_temperature ? h.apparent_temperature[k] : c.apparent_temperature;
      if ((h.wind_speed_10m[k] || 0) > wmax) wmax = h.wind_speed_10m[k];
      if ((h.precipitation_probability[k] || 0) > pmax) pmax = h.precipitation_probability[k];
      var cd = h.weather_code[k];
      if (Insights.codeWet(cd)) wet = true; if (Insights.codeSnow(cd)) snow = true; if (Insights.codeStorm(cd)) { storm = true; wet = true; }
    }
    var t = tipsInput(), cc = c.weather_code, freezing = cc === 56 || cc === 57 || cc === 66 || cc === 67;
    var ice = freezing || (t.minNext <= 1 && (wet || snow || t.rain.max >= 30 || t.hum >= 85));
    return { feels: n ? fsum / n : c.apparent_temperature, wind: wmax, p: pmax, wet: wet, snow: snow, storm: storm, ice: ice,
      isDay: c.is_day === 1, uv: h.uv_index ? (h.uv_index[s] || 0) : 0, aqi: state.aq ? state.aq.value : null };
  }
  function todayHtml() {
    var d = state.data, c = d.current;
    var text = Insights.daySummary({ h: d.hourly, dl: d.daily, j: 0, nowIdx: state.start, curTemp: c.temperature_2m, aq: state.aq });
    var acts = Insights.activities(activityInput());
    return '<div class="card-h"><h2 id="h-today">Bugün</h2><span class="sm">Verilerden otomatik özet</span></div>' +
      '<p class="digest">' + esc(text) + '</p>' +
      '<ul class="acts" aria-label="Aktivite önerileri">' + acts.map(function (a) {
        return '<li class="act l' + (a.id === 'home' ? 'h' : a.lvl) + '"><span class="act-i">' + uiIcon(a.icon, 20) + '</span><span class="act-b"><b>' + esc(a.name) +
          '</b><em class="lv"><i aria-hidden="true"></i>' + esc(a.label) + '</em><small>' + esc(a.why) + '</small></span></li>';
      }).join('') + '</ul>';
  }
  function aqHtml() {
    var head = '<div class="card-h"><h2 id="h-aq">Hava kalitesi</h2><span class="sm">Avrupa endeksi (EAQI)</span></div>';
    if (state.aqState === 'loading') return head + '<p class="aq-note">Hava kalitesi yükleniyor…</p>';
    if (state.aqState !== 'ok' || !state.aq) return head + '<p class="aq-note">Hava kalitesi verisi şu an alınamadı.</p><button type="button" class="btn ghost" id="aqRetry">Tekrar dene</button>';
    var a = state.aq, i, seg = '';
    for (i = 0; i < 6; i++) seg += '<i style="background:' + Insights.AQ_COLOR[i] + '"></i>';
    var rows = a.comps.map(function (p) {
      var val = p.val < 10 ? (Math.round(p.val * 10) / 10) : round(p.val);
      return '<li><span class="dot" style="background:' + (p.color || 'rgba(255,255,255,.35)') + '"></span><span class="n">' + p.name + '</span><span class="v">' + String(val).replace('.', ',') + ' µg/m³</span><span class="l">' + (p.label || '—') + '</span></li>';
    }).join('');
    var pollen = '';
    if (a.pollenKnown) {
      pollen = '<h3>Polen</h3>' + (a.pollen.length ? '<ul class="pollen">' + a.pollen.map(function (p) {
        return '<li><b>' + p.name + '</b> ' + String(Math.round(p.val * 10) / 10).replace('.', ',') + ' tane/m³</li>'; }).join('') + '</ul>' : '<p class="aq-note">Şu an ölçülebilir polen yok.</p>');
    } else pollen = '<p class="aq-note">Polen verisi bu bölge veya mevsim için yok.</p>';
    return head +
      '<div class="aq-main"><div class="aq-num" style="border-color:' + a.color + '"><b>' + a.value + '</b></div>' +
      '<div class="aq-txt"><div class="aq-lbl"><i style="background:' + a.color + '"></i>' + a.label + '</div><p>' + a.sentence + '</p></div></div>' +
      '<div class="aq-scale" role="img" aria-label="Hava kalitesi ölçeği: ' + a.value + ', ' + a.label + '">' + seg + '<b style="left:' + r1(Math.min(a.value, 120) / 120 * 100) + '%"></b></div>' +
      '<button type="button" class="aq-more" id="aqMore" aria-expanded="' + !!state.aqOpen + '" aria-controls="aqDetail"><span>Ayrıntılar</span>' + uiIcon('chevron', 16) + '</button>' +
      '<div class="aq-detail" id="aqDetail"' + (state.aqOpen ? '' : ' hidden') + '>' +
        (a.main ? '<p class="aq-main-note">Başlıca etken: <b>' + a.main + '</b></p>' : '') +
        '<ul class="pol">' + rows + '</ul>' +
        (a.us != null ? '<p class="aq-us">ABD AQI karşılığı: <b>' + a.us + '</b></p>' : '') + pollen +
        '<p class="aq-src">Kirletici sınıfları anlık değere göre gösterilir; genel endeks ortalamalara dayandığı için ikisi birebir örtüşmeyebilir.</p><p class="aq-src">Kaynak: <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noopener">Open-Meteo</a> · CAMS ENSEMBLE (Copernicus Atmosphere Monitoring Service) verisinden türetilmiş model sonucudur; yerel ölçüm istasyonundan farklı olabilir.</p>' +
      '</div>';
  }
  function fillInsights() {
    var t = $('todayCard'), q = $('aqCard');
    if (t) t.innerHTML = todayHtml();
    if (q) q.innerHTML = aqHtml();
  }
  // Hava kalitesi sonradan gelince: öneri çipleri, özet, aktiviteler ve kart güncellenir
  function refreshInsights() {
    if (!state.data || !$('todayCard')) return;
    var tp = el.content.querySelector('.tips');
    if (tp) tp.outerHTML = tipsHtml(tipsFor(tipsInput()));
    fillInsights();
  }
  function loadAQ(city) {
    if (state.aqCtl) state.aqCtl.abort();
    var ctl = state.aqCtl = new AbortController();
    var url = API_AQ + '?latitude=' + city.lat + '&longitude=' + city.lon +
      '&current=european_aqi,us_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,sulphur_dioxide,carbon_monoxide,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen&timezone=auto';
    state.aq = null; state.aqState = 'loading';
    fetch(url, { signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) {
        if (ctl !== state.aqCtl) return;
        var a = Insights.airQuality(j.current);
        if (!a) throw new Error('veri yok');
        state.aq = a; state.aqState = 'ok'; refreshInsights();
      })
      .catch(function (e) {
        if (e.name === 'AbortError' || ctl !== state.aqCtl) return;
        state.aqState = 'error'; refreshInsights();
      });
  }

  // ---------- Harita / radar (tembel yükleme) ----------
  function mapShell() {
    return '<section class="card mapcard" id="mapCard" aria-labelledby="h-map">' +
      '<div class="card-h"><h2 id="h-map">Harita ve radar</h2><button type="button" class="btn" id="mapOpen">' + uiIcon('map', 16) + 'Haritayı aç</button></div>' +
      '<p class="map-hint" id="mapHint">Konumunu ve son 2 saatlik yağış radarını gör. Açana kadar hiçbir şey indirilmez.</p>' +
      '<div id="mapBox" hidden></div></section>';
  }
  var mapLoad = null;
  function injectInline(id, kind) {
    var n = $(id); if (!n) return false;
    var e = document.createElement(kind === 'css' ? 'style' : 'script');
    e.textContent = n.textContent; document.head.appendChild(e); return true;
  }
  function loadExternal(url, kind) {
    return new Promise(function (ok, bad) {
      var e = document.createElement(kind === 'css' ? 'link' : 'script');
      if (kind === 'css') { e.rel = 'stylesheet'; e.href = url; } else { e.src = url; }
      e.onload = ok; e.onerror = function () { bad(new Error('yüklenemedi: ' + url)); };
      document.head.appendChild(e);
    });
  }
  function ensureMapAssets() {
    if (window.WeatherMap) return Promise.resolve();
    if (mapLoad) return mapLoad;
    var inline = !!$('lazy-maplibre-js');
    if (inline) {
      injectInline('lazy-maplibre-css', 'css'); injectInline('lazy-maplibre-js', 'js'); injectInline('lazy-mapview-js', 'js');
      mapLoad = Promise.resolve();
    } else {
      mapLoad = loadExternal('vendor/maplibre/maplibre-gl.css', 'css')
        .then(function () { return loadExternal('vendor/maplibre/maplibre-gl.js', 'js'); })
        .then(function () { return loadExternal('mapview.js', 'js'); });
    }
    mapLoad = mapLoad.then(function () { if (!window.maplibregl || !window.WeatherMap) throw new Error('harita bileşenleri eksik'); })
      .catch(function (e) { mapLoad = null; throw e; });
    return mapLoad;
  }
  function mapCtx() {
    var d = state.data, c = d.current, info = describe(c.weather_code, c.is_day === 1);
    return { city: state.city, temp: c.temperature_2m, kind: info.kind, text: info.text, isDay: c.is_day === 1, offset: d.utc_offset_seconds || 0 };
  }
  function openMap(restore) {
    var btn = $('mapOpen'), box = $('mapBox'), hint = $('mapHint');
    if (!box) return;
    if (btn) { btn.disabled = true; btn.lastChild.textContent = 'Yükleniyor…'; }
    ensureMapAssets().then(function () {
      if ($('mapBox') !== box) return; // arada şehir değişti
      state.mapOpen = true;
      var reset = function () {
        state.mapOpen = false; box.hidden = true; box.textContent = '';
        if (hint) hint.hidden = false; if (btn) { btn.hidden = false; btn.disabled = false; btn.lastChild.textContent = 'Haritayı aç'; }
      };
      box.hidden = false; if (hint) hint.hidden = true; if (btn) btn.hidden = true;
      try { window.WeatherMap.open(box, mapCtx(), reset); }
      catch (err) { reset(); say('Bu cihazda harita çizilemedi (WebGL gerekir). Tarayıcını güncelleyip tekrar dene.'); }
    }).catch(function () {
      state.mapOpen = false;
      if (btn) { btn.disabled = false; btn.lastChild.textContent = 'Haritayı aç'; }
      say('Harita yüklenemedi. Bağlantını kontrol edip tekrar dene.');
    });
  }

  // ---------- Günlük ayrıntı (alt panel) ----------
  var sheet = { wrap: $('sheet'), body: $('sheetBody'), day: 0, opener: null };
  function fmtMm(n) { return (Math.round(n * 10) / 10).toLocaleString('tr-TR', { maximumFractionDigits: 1 }); }
  function dayLong(dateStr) {
    var p = parts(dateStr + 'T12:00');
    return new Date(p.y, p.mo - 1, p.d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  }
  function sheetHtml(j) {
    var d = state.data, dl = d.daily, di = describe(dl.weather_code[j], true), uv = dl.uv_index_max[j] || 0, uc = UV_CLASSES[uvClass(uv)];
    var rise = minutes(dl.sunrise[j]), set = minutes(dl.sunset[j]), len = set - rise, p = dl.precipitation_probability_max[j] || 0;
    var wmax = dl.wind_speed_10m_max ? dl.wind_speed_10m_max[j] : null, gust = dl.wind_gusts_10m_max ? dl.wind_gusts_10m_max[j] : null;
    var text = Insights.daySummary({ h: d.hourly, dl: dl, j: j, nowIdx: j === 0 ? state.start : undefined, curTemp: d.current.temperature_2m, aq: j === 0 ? state.aq : null });
    return '<header class="sh-head"><button type="button" class="sh-nav" data-nav="-1" aria-label="Önceki gün"' + (j === 0 ? ' disabled' : '') + '>' + uiIcon('left', 20) + '</button>' +
        '<div class="sh-title"><h2 id="sheetTitle">' + dayName(dl.time[j], j) + '</h2><p>' + dayLong(dl.time[j]) + '</p></div>' +
        '<button type="button" class="sh-nav" data-nav="1" aria-label="Sonraki gün"' + (j === dl.time.length - 1 ? ' disabled' : '') + '>' + uiIcon('right', 20) + '</button>' +
        '<button type="button" class="sh-x" data-close aria-label="Kapat">' + uiIcon('close', 20) + '</button></header>' +
      '<div class="sh-now">' + weatherIcon(di.kind, true, 64, false) + '<div><div class="sh-t"><b>' + deg(dl.temperature_2m_max[j]) + '</b><span>' + deg(dl.temperature_2m_min[j]) + '</span></div><p>' + di.text + '</p></div></div>' +
      '<p class="sh-comment">' + esc(text) + '</p>' +
      '<div class="sh-grid">' +
        '<div class="sh-tile"><span>' + uiIcon('umbrella', 15) + 'Yağış ihtimali</span><b>%' + round(p) + '</b><i class="sh-g"><u style="width:' + round(p) + '%"></u></i></div>' +
        '<div class="sh-tile"><span>' + uiIcon('drop', 15) + 'Toplam yağış</span><b>' + (dl.precipitation_sum ? fmtMm(dl.precipitation_sum[j]) + ' mm' : '—') + '</b></div>' +
        '<div class="sh-tile"><span>' + uiIcon('sun', 15) + 'UV indeksi</span><b>' + round(uv) + '</b><em class="chipuv" style="background:' + uc[1] + '">' + uc[0] + '</em></div>' +
        '<div class="sh-tile"><span>' + uiIcon('wind', 15) + 'Rüzgâr</span><b>' + (wmax != null ? round(wmax) + ' km/sa' : '—') + '</b>' + (gust != null ? '<em>Hamle ' + round(gust) + ' km/sa</em>' : '') + '</div>' +
      '</div>' +
      '<div class="sh-sun"><span class="sx">' + uiIcon('sunrise', 22) + '<span><b>' + hm(dl.sunrise[j]) + '</b><small>Doğuş</small></span></span><span class="mid">' + Math.floor(len / 60) + ' sa ' + (len % 60) + ' dk</span>' +
        '<span class="sx">' + uiIcon('sunset', 22) + '<span><b>' + hm(dl.sunset[j]) + '</b><small>Batış</small></span></span></div>';
  }
  function openSheet(j, opener) {
    sheet.day = j; if (opener) sheet.opener = opener;
    sheet.body.innerHTML = sheetHtml(j);
    if (sheet.wrap.hidden) {
      sheet.wrap.hidden = false;
      void sheet.wrap.offsetWidth;
      sheet.wrap.classList.add('open');
      document.documentElement.classList.add('lock');
      el.app.setAttribute('aria-hidden', 'true'); if ('inert' in el.app) el.app.inert = true;
    }
    var f = sheet.body.querySelector('.sh-x'); if (f) f.focus();
  }
  function closeSheet() {
    if (sheet.wrap.hidden) return;
    sheet.wrap.classList.remove('open');
    document.documentElement.classList.remove('lock');
    el.app.removeAttribute('aria-hidden'); if ('inert' in el.app) el.app.inert = false;
    var done = function () { sheet.wrap.hidden = true; sheet.wrap.querySelector('.sheet').style.transform = ''; };
    if (reduceMotion()) done(); else setTimeout(done, 260);
    if (sheet.opener && document.contains(sheet.opener)) sheet.opener.focus();
  }
  sheet.wrap.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]') || e.target.classList.contains('sheet-bg')) { closeSheet(); return; }
    var nv = e.target.closest('[data-nav]');
    if (nv) { var n = sheet.day + (+nv.dataset.nav); if (n >= 0 && n < state.data.daily.time.length) { openSheet(n); var again = sheet.body.querySelector('[data-nav="' + nv.dataset.nav + '"]'); if (again && !again.disabled) again.focus(); } }
  });
  document.addEventListener('keydown', function (e) {
    if (sheet.wrap.hidden) return;
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key === 'Tab') { // odak panelin içinde kalsın
      var f = Array.prototype.filter.call(sheet.wrap.querySelectorAll('button:not([disabled])'), function (b) { return b.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  // Kaydırarak kapatma (tutamaktan aşağı çek)
  (function () {
    var grip = $('sheetGrip'), panel = sheet.wrap.querySelector('.sheet'), y0 = null, dy = 0;
    grip.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; panel.style.transition = 'none'; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; });
    function end() { if (y0 == null) return; y0 = null; panel.style.transition = ''; if (dy > 90) closeSheet(); else panel.style.transform = ''; }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  })();

  // Tek yerden tıklama yönetimi (içerik her yenilendiğinde yeniden bağlanmasın)
  el.content.addEventListener('click', function (e) {
    var dy = e.target.closest('.dy[data-day]');
    if (dy) { openSheet(+dy.dataset.day, dy); return; }
    if (e.target.closest('#mapOpen')) { openMap(); return; }
    if (e.target.closest('#aqRetry')) { if (state.city) { state.aqState = 'loading'; refreshInsights(); loadAQ(state.city); } return; }
    var more = e.target.closest('#aqMore');
    if (more) {
      state.aqOpen = !state.aqOpen;
      more.setAttribute('aria-expanded', state.aqOpen);
      $('aqDetail').hidden = !state.aqOpen;
    }
  });

  // ---------- Favoriler ----------
  function renderFavs() {
    document.dispatchEvent(new Event('hd2:cities'));   // bildirim kartı izlenen şehirleri günceller (notify.js)
    if (!state.favs.length) { el.favs.hidden = true; el.favs.textContent = ''; return; }
    el.favs.hidden = false;
    el.favs.innerHTML = state.favs.map(function (f) {
      var on = state.city && cityId(state.city) === f.id;
      return '<span class="chip' + (on ? ' on' : '') + '"><button type="button" class="chip-go" data-id="' + esc(f.id) + '"' + (on ? ' aria-current="true"' : '') + '>' + esc(f.name) + '</button>' +
        '<button type="button" class="chip-x" data-rm="' + esc(f.id) + '" aria-label="' + esc(f.name) + ' favorilerden çıkar">' + uiIcon('close', 14) + '</button></span>';
    }).join('');
  }
  function syncFavBtn() {
    var b = $('favBtn'); if (!b || !state.city) return;
    var on = isFav(state.city);
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-label', on ? 'Favorilerden çıkar' : 'Favorilere ekle');
    b.querySelector('svg').classList.toggle('filled', on);
  }
  function toggleFav() {
    var c = state.city, id = cityId(c);
    if (isFav(c)) state.favs = state.favs.filter(function (f) { return f.id !== id; });
    else {
      if (state.favs.length >= MAX_FAVS) { say('En fazla ' + MAX_FAVS + ' favori şehir ekleyebilirsin.'); return; }
      state.favs.push({ id: id, name: c.name, admin: c.admin, country: c.country, lat: c.lat, lon: c.lon });
    }
    store(FAV_KEY, state.favs);
    renderFavs(); syncFavBtn();
  }
  el.favs.addEventListener('click', function (e) {
    var go = e.target.closest('[data-id]'), rm = e.target.closest('[data-rm]');
    if (rm) {
      state.favs = state.favs.filter(function (f) { return f.id !== rm.dataset.rm; });
      store(FAV_KEY, state.favs); renderFavs(); syncFavBtn();
    } else if (go) {
      var f = state.favs.filter(function (x) { return x.id === go.dataset.id; })[0];
      if (f) loadCity(f);
    }
  });

  // ---------- Mesaj ----------
  function say(text, retry) {
    el.msg.textContent = text || '';
    el.msg.hidden = !text;
    if (text && retry) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'retry'; b.textContent = 'Tekrar dene';
      b.addEventListener('click', retry); el.msg.appendChild(b);
    }
  }

  // ---------- Çevrimdışı: son başarılı veri ----------
  function saveWx(city, data) {
    var all = store(WX_KEY) || {}, id = cityId(city), ids;
    all[id] = { city: city, data: data, t: Date.now() };
    ids = Object.keys(all).sort(function (a, b) { return all[b].t - all[a].t; });
    ids.slice(WX_MAX).forEach(function (k) { delete all[k]; });
    store(WX_KEY, all);
  }
  function loadWx(city) {
    var all = store(WX_KEY), h = all && all[cityId(city)];
    if (!h || !h.data || !h.data.current || Date.now() - h.t > WX_MAX_AGE || h.t > Date.now() + 60000) return null;
    return h;
  }
  function stamp(t) {
    var d = new Date(t), now = new Date(), hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return d.toDateString() === now.toDateString() ? 'bugün ' + hm : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) + ' ' + hm;
  }
  function startMotion() {
    boot.motion = true;
    document.documentElement.classList.add('motion');   // simge animasyonları (.ic.anim) şimdi başlar
    if (boot.needle) { boot.needle = false; var nd = el.content.querySelector('.needle'); if (nd) nd.style.transform = 'rotate(' + nd.getAttribute('data-to') + 'deg)'; }
    var go = function () { buildFx(currentTheme); mark('motion'); if (location.search.indexOf('perf') >= 0) logPerf(); };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 400 }); else setTimeout(go, 0);
  }
  function logPerf() {
    try { var t0 = performance.getEntriesByName('hd:boot')[0].startTime, rows = {};
      performance.getEntriesByType('mark').filter(function (m) { return m.name.indexOf('hd:') === 0; }).forEach(function (m) { rows[m.name] = Math.round(m.startTime - t0); });
      console.table(rows); } catch (e) { /* önemli değil */ }
  }
  function hideSplash() {
    var s = $('splash');
    if (!s) { boot.booting = false; document.documentElement.classList.remove('boot'); if (boot.q) { var q0 = boot.q; boot.q = null; q0(); } return; }
    if (s.dataset.done) return;
    s.dataset.done = '1';
    var wait = Math.max(0, MIN_SPLASH - performance.now());   // ağır iş bitti; en az 300 ms'ye tamamlanana kadar bekle
    var run = function () {
      requestAnimationFrame(function () {
        // Tek karede: içerik görünür olur + animasyonu başlar + splash solmaya başlar (hepsi opacity/transform)
        document.documentElement.classList.remove('boot'); boot.booting = false;
        revealContent(380);
        s.classList.add('out'); mark('splash-out');
        var gone = function () { if (s.parentNode) s.parentNode.removeChild(s); mark('splash-gone'); };
        setTimeout(gone, reduceMotion() ? 160 : 460);
        // Dekoratif efektler (parçacıklar, simge animasyonları) geçiş bittikten sonra, 2 kare + kısa gecikmeyle
        setTimeout(function () { requestAnimationFrame(startMotion); }, reduceMotion() ? 0 : 520);
        if (boot.q) { var q = boot.q; boot.q = null; setTimeout(q, 0); }   // ertelenen ikincil iş (hava kalitesi) geçiş başladıktan sonra
      });
    };
    if (wait > 0) setTimeout(run, wait); else run();
  }
  window.addEventListener('online', function () { if (state.stale && state.city) loadCity(state.city); });

  // ---------- Veri ----------
  function afterBoot(fn) { if (boot.booting) boot.q = fn; else fn(); }   // açılışta yalnızca sonuncusu çalışır
  function applyFresh(city, data, opts) {
    state.city = city; state.data = data; state.stale = false;
    el.content.classList.remove('is-stale');
    if (state.aqCtl) state.aqCtl.abort();
    state.aq = null; state.aqState = 'loading';
    store(LAST_KEY, city);
    if (!(opts && opts.fromCache)) saveWx(city, data);   // önbellekten gelen veri "şimdi alındı" diye yeniden damgalanmaz
    render(city, data, opts);
    renderFavs();
    afterBoot(function () { if (state.city === city) loadAQ(city); });   // hava kalitesi isteği/çizimi açılış geçişini geciktirmesin
    document.title = Math.round(data.current.temperature_2m) + '° ' + city.name + ' · Hava Durumum';
  }
  function loadCity(city, o) {
    o = o || {};
    if (state.loadCtl) state.loadCtl.abort();
    var ctl = state.loadCtl = new AbortController(), timer = 0;
    if (o.cold) timer = setTimeout(function () { ctl.timedOut = true; ctl.abort(); }, COLD_TIMEOUT);   // yavaş ağda boş ekran yerine önbellek/hata
    hideSuggest();
    if (!o.silent) { say(''); el.app.classList.add('loading'); }
    var url = API_FORECAST + '?latitude=' + city.lat + '&longitude=' + city.lon +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m,wind_direction_10m' +
      '&hourly=temperature_2m,apparent_temperature,weather_code,precipitation_probability,precipitation,is_day,wind_speed_10m,uv_index' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset' +
      '&forecast_days=10&timezone=auto&wind_speed_unit=kmh';
    return fetch(url, { signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (data) {
        mark('data');
        if (o.silent && state.data && state.data.current && data.current && state.data.current.time === data.current.time) { saveWx(city, data); return; }   // aynı ölçüm: ekrana dokunma
        applyFresh(city, data, o.silent ? { noReveal: true } : null);
      })
      .catch(function (err) {
        if (err.name === 'AbortError' && !ctl.timedOut) return;
        var offline = (navigator.onLine === false || err instanceof TypeError) && !ctl.timedOut, hit = loadWx(city);
        if (hit) {
          // Eski veri güncelmiş gibi gösterilmez: uyarı çubuğu + soluk ana kart
          state.stale = true;
          if (!o.silent) {   // sessiz yenileme: ekrandaki önbellek verisi zaten çizili, yeniden çizilmez (yalnızca uyarı eklenir)
            state.city = city; state.data = hit.data;
            if (state.aqCtl) state.aqCtl.abort();
            state.aq = null; state.aqState = 'error';
            store(LAST_KEY, city);
            render(city, hit.data);
            renderFavs();
          }
          el.content.classList.add('is-stale');
          document.title = city.name + ' · Hava Durumum';
          say((offline ? 'İnternet bağlantısı yok. ' : 'Güncel veri alınamadı. ') + 'Gösterilen veri eski. Son güncelleme: ' + stamp(hit.t) + '.', function () { loadCity(city); });
        } else if (o.silent) {
          return;
        } else if (offline) {
          say('İnternet bağlantısı yok. Güncel hava verisi alınamıyor.', function () { loadCity(city); });
        } else {
          say('Hava durumu alınamadı. İnternet bağlantını kontrol edip tekrar dene.', function () { loadCity(city); });
        }
      })
      .then(function () { clearTimeout(timer); if (state.loadCtl === ctl) { el.app.classList.remove('loading'); hideSplash(); } });
  }

  // ---------- Şehir arama ----------
  function geocode(q, count, signal) {
    return fetch(API_GEO + '?count=' + count + '&language=tr&name=' + encodeURIComponent(q), { signal: signal })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) {
        return (j.results || []).map(function (x) {
          return { name: x.name, admin: x.admin1 || '', country: x.country || '', lat: x.latitude, lon: x.longitude };
        });
      });
  }
  function hideSuggest() { el.suggest.hidden = true; el.suggest.textContent = ''; state.items = []; state.active = -1; el.q.setAttribute('aria-expanded', 'false'); }
  function showSuggest(items) {
    state.items = items; state.active = -1;
    el.suggest.innerHTML = items.map(function (c, i) {
      return '<li role="option" id="s' + i + '"><button type="button" data-i="' + i + '"><b>' + esc(c.name) + '</b><span>' + esc(cityLabel(c)) + '</span></button></li>';
    }).join('');
    el.suggest.hidden = false; el.q.setAttribute('aria-expanded', 'true');
  }
  function pick(i) { var c = state.items[i]; if (!c) return; el.q.value = ''; loadCity(c); }
  function setActive(i) {
    state.active = i;
    Array.prototype.forEach.call(el.suggest.children, function (li, k) { li.classList.toggle('act', k === i); });
    if (i >= 0) el.q.setAttribute('aria-activedescendant', 's' + i); else el.q.removeAttribute('aria-activedescendant');
  }
  var timer;
  el.q.addEventListener('input', function () {
    clearTimeout(timer);
    var q = el.q.value.trim();
    if (q.length < 2) { hideSuggest(); return; }
    timer = setTimeout(function () {
      if (state.geoCtl) state.geoCtl.abort();
      var ctl = state.geoCtl = new AbortController();
      geocode(q, 5, ctl.signal).then(function (items) {
        if (items.length) { say(''); showSuggest(items); } else { hideSuggest(); say('"' + q + '" için şehir bulunamadı. Yazımı kontrol et.'); }
      }).catch(function (e) { if (e.name !== 'AbortError') { hideSuggest(); say('Şehir araması şu an çalışmıyor. Biraz sonra tekrar dene.'); } });
    }, 300);
  });
  el.q.addEventListener('keydown', function (e) {
    var n = state.items.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); setActive((state.active + 1) % n); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); setActive((state.active - 1 + n) % n); }
    else if (e.key === 'Escape') { hideSuggest(); }
  });
  el.form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearTimeout(timer);
    if (state.items.length) { pick(state.active >= 0 ? state.active : 0); return; }
    var q = el.q.value.trim();
    if (q.length < 2) return;
    geocode(q, 1).then(function (items) {
      if (items.length) { el.q.value = ''; loadCity(items[0]); } else say('"' + q + '" için şehir bulunamadı. Yazımı kontrol et.');
    }).catch(function () { say('Şehir araması şu an çalışmıyor. Biraz sonra tekrar dene.'); });
  });
  el.suggest.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
  document.addEventListener('click', function (e) { if (!e.target.closest('.top')) hideSuggest(); });

  // ---------- Başlangıç ----------
  $('searchIcon').innerHTML = uiIcon('search', 18);
  renderFavs();
  setTimeout(hideSplash, 12000);  // son çare: ağ zaman aşımı (8 sn) zaten hata/önbellek gösterir
  var startCity = store(LAST_KEY) || DEFAULT_CITY, warm = loadWx(startCity);
  if (warm && Date.now() - warm.t <= FRESH_MS && navigator.onLine !== false) {
    // Taze önbellek: ağ beklenmeden hemen çiz, arka planda sessizce yenile
    applyFresh(startCity, warm.data, { noReveal: true, fromCache: true });
    hideSplash();
    loadCity(startCity, { silent: true });
  } else loadCity(startCity, { cold: true });
})();
