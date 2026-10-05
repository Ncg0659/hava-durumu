/* Harita + yağış radarı. MapLibre GL JS (BSD-3-Clause, vendor/maplibre/) yüklendikten sonra,
   kullanıcı "Haritayı aç" deyince tembel yüklenir. Kendi kodumuzdur; üçüncü taraf harita kodu kopyalanmadı.
   Altlık: OpenFreeMap (ücretsiz, API anahtarsız vektör karolar; © OpenMapTiles, veri © OpenStreetMap katkıcıları).
   OSM'nin kendi karo sunucusu (tile.openstreetmap.org) KULLANILMAZ.
   Radar: RainViewer (ücretsiz katman, 512 px karo, en fazla 6. seviye = eski 7. yakınlaştırma). */
'use strict';
(function (global) {
  var STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'; // açık, sade; radarın üstünde okunur kalır
  var BASE_ATTR = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
    '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
    'Veri: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> katkıcıları';
  var RV_ATTR = ' · Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>';
  var RV_JSON = 'https://api.rainviewer.com/public/weather-maps.json';
  var RV_TTL = 5 * 60 * 1000;
  var FRAME_MS = 700, HOLD_MS = 1500;
  var MAP_ZOOM = 9, RADAR_ZOOM = 6;       // MapLibre (512 px) seviyeleri
  var rvCache = { t: 0, data: null };
  var S = null;

  function $(root, sel) { return root.querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dg(n) { var x = Math.round(n); if (x === 0) x = 0; return (x < 0 ? '−' + (-x) : x) + '°'; }
  function clockAt(epoch, offset) { var d = new Date((epoch + offset) * 1000); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function relLabel(rel) { return rel === 0 ? 'Şimdi' : '−' + Math.abs(rel) + ' dk'; }

  function registerSW() {
    try {
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () {});
    } catch (e) { /* önbellek olmadan da çalışır */ }
  }

  // ---------- Radar kareleri ----------
  function fetchFrames() {
    if (rvCache.data && Date.now() - rvCache.t < RV_TTL) return Promise.resolve(rvCache.data);
    return fetch(RV_JSON).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).then(function (j) {
      var past = j && j.radar && j.radar.past, host = j && j.host;
      if (!past || !past.length || typeof host !== 'string' || host.indexOf('https://') !== 0) throw new Error('radar verisi yok');
      var last = past[past.length - 1].time, frames = past.filter(function (f) { return typeof f.path === 'string' && f.path.charAt(0) === '/' && f.path.indexOf('..') < 0; })
        .map(function (f, i) { return { id: 'rv' + i, time: f.time, path: f.path, rel: Math.round((f.time - last) / 600) * 10, added: false }; });
      if (!frames.length) throw new Error('radar verisi yok');
      rvCache = { t: Date.now(), data: { host: host, frames: frames } };
      return rvCache.data;
    });
  }

  // ---------- Kurulum ----------
  function open(box, ctx, onClose) {
    destroy();
    box.innerHTML =
      '<div class="seg" role="tablist" aria-label="Harita türü"><button type="button" role="tab" id="tabMap" aria-selected="true" data-m="map">Harita</button>' +
      '<button type="button" role="tab" id="tabRadar" aria-selected="false" data-m="radar">Yağış Radarı</button></div>' +
      '<div class="mapwrap"><div class="mapcanvas" id="glmap"></div><div class="mapattr" id="mAttr"></div></div>' +
      '<div class="map-bar"><div><div class="map-title" id="mTitle"></div><div class="map-sub" id="mSub"></div></div>' +
      '<button type="button" class="map-x" id="mClose">Haritayı kapat</button></div>' +
      '<div id="radarUI" hidden>' +
        '<div class="radar-ctl"><button type="button" class="play" id="rPlay" aria-label="Radarı oynat"></button>' +
        '<div class="tl"><div class="tl-now"><b id="rLbl">Şimdi</b><span id="rClock"></span></div>' +
        '<input type="range" id="rRange" min="0" max="0" value="0" step="1" aria-label="Radar zamanı">' +
        '<div class="tl-ticks"><span id="tkA"></span><span id="tkB"></span><span id="tkC"></span></div></div></div>' +
        '<div class="legend"><span>Hafif</span><i></i><span>Yoğun</span></div></div>' +
      '<p class="map-msg" id="mMsg" role="status" hidden></p>' +
      '<p class="map-tip">Haritayı iki parmakla kaydır ve yakınlaştır; sayfa kaydırması bozulmasın diye tek parmak sayfayı kaydırır.</p>';

    var map;
    try {
      map = new maplibregl.Map({
        container: $(box, '#glmap'), style: STYLE_URL, center: [ctx.city.lon, ctx.city.lat], zoom: MAP_ZOOM, minZoom: 2, maxZoom: 17,
        attributionControl: false, cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, fadeDuration: 150,
        locale: {
          'CooperativeGesturesHandler.WindowsHelpText': 'Haritayı yakınlaştırmak için Ctrl + kaydırma kullan',
          'CooperativeGesturesHandler.MacHelpText': 'Haritayı yakınlaştırmak için ⌘ + kaydırma kullan',
          'CooperativeGesturesHandler.MobileHelpText': 'Haritayı iki parmakla kaydır'
        }
      });
    } catch (e) { box.textContent = ''; throw e; }   // WebGL yoksa: app.js hata mesajı gösterir
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

    var el = document.createElement('div');
    el.className = 'wm';
    el.innerHTML = '<div class="wm-pin" role="img" aria-label="' + esc(ctx.city.name + ', ' + dg(ctx.temp) + ', ' + ctx.text) + '">' +
      global.weatherIcon(ctx.kind, ctx.isDay, 26, false) + '<span>' + dg(ctx.temp) + '</span></div>';
    var marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat([ctx.city.lon, ctx.city.lat]).addTo(map);

    S = { box: box, map: map, marker: marker, ctx: ctx, mode: 'map', onClose: onClose, radar: null, cur: -1, timer: 0, playing: false,
          radarMsg: false, styleErr: false, loaded: false, dead: false };
    map.on('load', function () { if (S && S.map === map) { S.loaded = true; if (S.styleErr) { S.styleErr = false; if (S.mode === 'map') say(''); } } });
    map.on('error', function (e) {
      if (!S || S.map !== map) return;
      var id = e && e.sourceId;
      if (id && /^rv\d+$/.test(id)) return;                    // tek bir radar karosunun hatası haritayı bozmaz
      if (!S.loaded && S.mode === 'map') { S.styleErr = true; say('Harita yüklenemedi. İnternet bağlantını kontrol et.'); }
    });
    $(box, '#rPlay').innerHTML = global.uiIcon('play', 20);
    box.addEventListener('click', onClick);
    $(box, '#rRange').addEventListener('input', onRange);
    document.addEventListener('visibilitychange', onVis);
    setTitle(); setAttr();
    registerSW();
    setTimeout(function () { if (S && !S.dead) map.resize(); }, 60);
  }

  function setTitle() {
    var t = $(S.box, '#mTitle'), s = $(S.box, '#mSub');
    if (S.mode === 'radar') { t.textContent = 'Son 2 Saat Yağış Radarı'; s.textContent = 'Geçmiş gözlem; gelecek tahmini değildir · 10 dakikalık kareler'; }
    else { t.textContent = S.ctx.city.name; s.textContent = 'Şu an ' + dg(S.ctx.temp) + ' · ' + S.ctx.text; }
  }
  function setAttr() { $(S.box, '#mAttr').innerHTML = BASE_ATTR + (S.mode === 'radar' ? RV_ATTR : ''); }
  function say(text) { var m = $(S.box, '#mMsg'); S.radarMsg = !!text && S.mode === 'radar'; m.textContent = text || ''; m.hidden = !text; }
  function whenStyle(fn) { if (S.loaded) fn(); else S.map.once('load', function () { if (S) fn(); }); }   // 'load' bir kez gelir; sonrasında kaynak eklemek güvenli

  function onClick(e) {
    var tab = e.target.closest('[data-m]');
    if (tab) { setMode(tab.dataset.m); return; }
    if (e.target.closest('#mClose')) { var cb = S && S.onClose; destroy(); if (cb) cb(); return; }
    if (e.target.closest('#rPlay')) { S.playing ? pause() : play(); return; }
    if (e.target.closest('#rRetry')) { setMode('radar', true); }
  }
  function onVis() { if (document.hidden) pause(); }

  // ---------- Harita / radar geçişi ----------
  function setMode(m, force) {
    if (!S || (S.mode === m && !force)) return;
    S.mode = m;
    var tabs = S.box.querySelectorAll('[data-m]'), i, c = [S.ctx.city.lon, S.ctx.city.lat];
    for (i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-selected', tabs[i].dataset.m === m ? 'true' : 'false');
    setTitle(); setAttr(); say('');
    if (m === 'map') {
      pause(); clearRadar();
      $(S.box, '#radarUI').hidden = true;
      S.map.setMaxZoom(17); S.map.jumpTo({ center: c, zoom: MAP_ZOOM });
      return;
    }
    S.map.jumpTo({ center: c, zoom: RADAR_ZOOM }); S.map.setMaxZoom(8); // radar verisi bundan fazla ayrıntılı değil
    $(S.box, '#radarUI').hidden = false;
    say('Radar kareleri alınıyor…');
    var my = S;
    fetchFrames().then(function (data) {
      if (S !== my || S.mode !== 'radar') return;
      S.radar = data; say('');
      var n = data.frames.length, rg = $(S.box, '#rRange');
      rg.max = n - 1; rg.value = n - 1;
      $(S.box, '#tkA').textContent = relLabel(data.frames[0].rel);
      $(S.box, '#tkB').textContent = n > 2 ? relLabel(data.frames[Math.floor((n - 1) / 2)].rel) : '';
      $(S.box, '#tkC').textContent = relLabel(0);
      S.cur = -1;
      whenStyle(function () {
        if (S !== my || S.mode !== 'radar') return;
        show(n - 1);
        var age = Math.round((Date.now() / 1000 - data.frames[n - 1].time) / 60);
        say(age > 30 ? 'Son radar karesi yaklaşık ' + age + ' dakika önce; güncelleme gecikmiş olabilir.' : 'Radar kapsama alanı dışında kalan yerlerde görüntü boş olabilir.');
        S.radarMsg = false;
      });
    }).catch(function () {
      if (S !== my || S.mode !== 'radar') return;
      S.radarMsg = true;
      var mm = $(S.box, '#mMsg'); mm.hidden = false;
      mm.innerHTML = 'Radar verisi şu an alınamadı. <button type="button" class="map-x" id="rRetry">Tekrar dene</button>';
    });
  }

  function addFrame(i) {
    var f = S.radar.frames[i];
    if (f.added) return;
    var map = S.map, before;
    (map.getStyle().layers || []).some(function (l) { if (l.type === 'symbol') { before = l.id; return true; } });   // etiketlerin altında kalsın
    // 512 px karo: aynı görüntü için 4 kat daha az istek (ücretsiz katman dakikada 100 istek)
    map.addSource(f.id, { type: 'raster', tiles: [S.radar.host + f.path + '/512/{z}/{x}/{y}/2/1_1.png'], tileSize: 512, maxzoom: 6 });
    map.addLayer({ id: f.id, type: 'raster', source: f.id, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } }, before);
    f.added = true;
  }
  function clearRadar() {
    if (!S.radar) return;
    S.radar.frames.forEach(function (f) {
      if (f.added) { try { if (S.map.getLayer(f.id)) S.map.removeLayer(f.id); if (S.map.getSource(f.id)) S.map.removeSource(f.id); } catch (e) { /* stil yeniden yüklenmiş olabilir */ } f.added = false; }
    });
    S.cur = -1;
  }
  function show(i) {
    var fr = S.radar.frames;
    if (i < 0 || i >= fr.length) return;
    addFrame(i);
    if (S.cur >= 0 && S.cur !== i && fr[S.cur].added) S.map.setPaintProperty(fr[S.cur].id, 'raster-opacity', 0);
    S.map.setPaintProperty(fr[i].id, 'raster-opacity', 0.78);
    S.cur = i;
    var f = fr[i];
    $(S.box, '#rRange').value = i;
    $(S.box, '#rLbl').textContent = relLabel(f.rel);
    $(S.box, '#rClock').textContent = clockAt(f.time, S.ctx.offset);
    $(S.box, '#rRange').setAttribute('aria-valuetext', relLabel(f.rel) + ', saat ' + clockAt(f.time, S.ctx.offset));
  }
  function onRange(e) { if (!S || !S.radar) return; pause(); show(+e.target.value); }

  // Kareleri sırayla yükle (aynı anda az istek), sonra oynat
  function preload(done) {
    var fr = S.radar.frames, my = S, idx = 0;
    function next() {
      if (S !== my || S.mode !== 'radar' || !S.playing) return;
      if (idx >= fr.length) { say(''); done(); return; }
      say('Kareler yükleniyor ' + (idx + 1) + '/' + fr.length + '…');
      addFrame(idx);
      var id = fr[idx].id, t0 = Date.now();
      (function wait() {
        if (S !== my || !S.playing) return;
        if (my.map.isSourceLoaded(id) || Date.now() - t0 > 6000) { idx++; next(); } else setTimeout(wait, 150);
      })();
    }
    next();
  }
  function play() {
    if (!S || !S.radar || S.playing) return;
    S.playing = true; setPlayIcon(true);
    var my = S, n = S.radar.frames.length;
    preload(function () {
      if (S !== my) return;
      var i = S.cur >= n - 1 ? 0 : S.cur + 1;
      (function step() {
        if (S !== my || !S.playing) return;
        show(i);
        var last = i >= n - 1;
        i = last ? 0 : i + 1;
        S.timer = setTimeout(step, last ? HOLD_MS : FRAME_MS);
      })();
    });
  }
  function pause() {
    if (!S) return;
    clearTimeout(S.timer); S.timer = 0;
    if (S.playing) { S.playing = false; setPlayIcon(false); var m = $(S.box, '#mMsg'); if (m && /yükleniyor/.test(m.textContent)) say(''); }
  }
  function setPlayIcon(on) {
    var b = $(S.box, '#rPlay'); b.innerHTML = global.uiIcon(on ? 'pause' : 'play', 20); b.setAttribute('aria-label', on ? 'Radarı durdur' : 'Radarı oynat');
  }

  function destroy() {
    if (!S) return;
    var s = S; S = null; s.dead = true;
    clearTimeout(s.timer);
    document.removeEventListener('visibilitychange', onVis);
    try { s.box.removeEventListener('click', onClick); s.map.remove(); } catch (e) { /* DOM zaten kalkmış olabilir */ }
  }

  global.WeatherMap = { open: open, destroy: destroy, _state: function () { return S; } };
})(window);
