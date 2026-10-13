/* Harita + yağış radarı + tam ekran katmanlı harita. MapLibre GL JS (BSD-3-Clause, vendor/maplibre/) yüklendikten sonra,
   kullanıcı "Haritayı aç" deyince tembel yüklenir. Kendi kodumuzdur; üçüncü taraf harita kodu kopyalanmadı.
   Altlık: OpenFreeMap (ücretsiz, API anahtarsız vektör karolar; © OpenMapTiles, veri © OpenStreetMap katkıcıları).
   OSM'nin kendi karo sunucusu (tile.openstreetmap.org) KULLANILMAZ.
   Radar: RainViewer (ücretsiz katman, 512 px karo, en fazla 6. seviye = eski 7. yakınlaştırma).
   TAM EKRAN: aynı MapLibre örneği CSS ile ekranı kaplar (yok edilip yeniden kurulmaz; yalnızca resize()). Sıcaklık, bulut, rüzgâr, hava kalitesi,
   basınç ve hissedilen katmanları NOKTASALDIR (maplayers.js): alan boyayan sahte harita üretilmez. */
'use strict';
(function (global) {
  var ML = global.MapLayers;
  var STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'; // açık, sade; radarın üstünde okunur kalır
  var BASE_ATTR = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
    '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
    'Veri: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> katkıcıları';
  var RV_ATTR = ' · Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>';
  var PT_ATTR = ' · Hava verisi: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>';
  var RV_JSON = 'https://api.rainviewer.com/public/weather-maps.json';
  var RV_TTL = 5 * 60 * 1000;
  var FRAME_MS = 700, HOLD_MS = 1500;
  var MAP_ZOOM = 9, RADAR_ZOOM = 6;       // MapLibre (512 px) seviyeleri
  var RADAR_MAXZ = 8;                      // radar verisi bundan fazla ayrıntılı değil (mevcut sınır korunur)
  var TAP_DELAY = 280;                     // dokunma → sorgu gecikmesi (çift dokunma/yakınlaştırma sorgu atmasın)
  var rvCache = { t: 0, data: null };
  var C = ML ? ML.cacheNew() : null;       // nokta verisi önbelleği (açıp kapatınca korunur; TTL ile tazelenir)
  var S = null;

  function $(root, sel) { return root.querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dg(n) { var x = Math.round(n); if (x === 0) x = 0; return (x < 0 ? '−' + (-x) : x) + '°'; }
  function clockAt(epoch, offset) { var d = new Date((epoch + offset) * 1000); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function relLabel(rel) { return rel === 0 ? 'Şimdi' : '−' + Math.abs(rel) + ' dk'; }
  function offline() { return typeof navigator !== 'undefined' && navigator.onLine === false; }

  function registerSW() {
    try {
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () {});
    } catch (e) { /* önbellek olmadan da çalışır */ }
  }

  // ---------- Radar kareleri ----------
  function fetchFrames() {
    if (rvCache.data && (Date.now() - rvCache.t < RV_TTL || offline())) return Promise.resolve(rvCache.data);   // çevrimdışı: eldeki kareler
    if (offline()) return Promise.reject(new Error('çevrimdışı'));                                              // çevrimdışıyken ağ denenmez (hata yığını/spam yok)
    return fetch(RV_JSON).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).then(function (j) {
      var past = j && j.radar && j.radar.past, host = j && j.host;
      if (!past || !past.length || typeof host !== 'string' || host.indexOf('https://') !== 0) throw new Error('radar verisi yok');
      var last = past[past.length - 1].time, frames = past.filter(function (f) { return typeof f.path === 'string' && f.path.charAt(0) === '/' && f.path.indexOf('..') < 0; })
        .map(function (f, i) { return { id: 'rv' + i, time: f.time, path: f.path, rel: Math.round((f.time - last) / 600) * 10, added: false }; });
      if (!frames.length) throw new Error('radar verisi yok');
      rvCache = { t: Date.now(), data: { host: host, frames: frames } };
      return rvCache.data;
    }).catch(function (e) { if (rvCache.data) return rvCache.data; throw e; });   // ağ hatası: varsa son bilinen kareler (hata yığını yok)
  }

  // ---------- Kurulum ----------
  var FS_LAYER_BTNS = function () {
    return ML.LAYERS.map(function (l) {
      return '<button type="button" class="fs-chip" data-ly="' + l.id + '" aria-pressed="false" aria-label="' + esc(l.aria) + '">' + esc(l.label) + '</button>';
    }).join('');
  };
  function fsHtml() {
    return '<div class="fs-top fso" id="fsTop"><div class="fs-row">' +
        '<button type="button" class="fs-btn" id="fsClose" aria-label="Tam ekran haritayı kapat">' + global.uiIcon('close', 20) + '</button>' +
        '<div class="fs-ttl"><b id="fsTitle"></b><span id="fsSub"></span></div>' +
        '<span class="fs-off" id="fsOff" role="status" hidden>Çevrimdışı</span></div>' +
      '<div class="fs-layers" id="fsLayers" role="group" aria-label="Harita katmanları">' + FS_LAYER_BTNS() + '</div>' +
      '<p class="fs-note" id="fsNote" role="status"></p></div>' +
      '<div class="fs-side fso" id="fsSide">' +
        '<button type="button" class="fs-btn" id="fsZin" aria-label="Yakınlaştır"><svg class="ui" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>' +
        '<button type="button" class="fs-btn" id="fsZout" aria-label="Uzaklaştır"><svg class="ui" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button>' +
        '<button type="button" class="fs-btn" id="fsCity" aria-label="Seçili şehre dön">' + global.uiIcon('pin', 20) + '</button>' +
        '<button type="button" class="fs-btn" id="fsLoc" aria-label="Konumuma dön">' + global.uiIcon('locate', 20) + '</button></div>' +
      '<div class="fs-card fso" id="fsCard" role="region" aria-label="Seçilen nokta hava bilgisi" aria-live="polite" hidden></div>' +
      '<div class="fs-steps fso" id="fsSteps" role="group" aria-label="Tahmin saati" hidden></div>' +
      '<div class="fs-legend fso" id="fsLegend" hidden></div>';
  }

  function open(box, ctx, onClose) {
    destroy();
    box.innerHTML =
      '<div class="seg" role="tablist" aria-label="Harita türü"><button type="button" role="tab" id="tabMap" aria-selected="true" data-m="map">Harita</button>' +
      '<button type="button" role="tab" id="tabRadar" aria-selected="false" data-m="radar">Yağış Radarı</button></div>' +
      '<div class="mapwrap"><div class="mapcanvas" id="glmap"></div><div class="mapattr" id="mAttr"></div>' +
      '<button type="button" class="mx-expand" id="mExpand" aria-label="Haritayı tam ekran aç" title="Tam ekran">' + global.uiIcon('expand', 18) + '</button></div>' +
      '<div class="map-bar"><div><div class="map-title" id="mTitle"></div><div class="map-sub" id="mSub"></div></div>' +
      '<button type="button" class="map-x" id="mClose">Haritayı kapat</button></div>' +
      '<div id="radarUI" hidden>' +
        '<div class="radar-ctl"><button type="button" class="play" id="rPlay" aria-label="Radarı oynat"></button>' +
        '<div class="tl"><div class="tl-now"><b id="rLbl">Şimdi</b><span id="rClock"></span></div>' +
        '<input type="range" id="rRange" min="0" max="0" value="0" step="1" aria-label="Radar zamanı">' +
        '<div class="tl-ticks"><span id="tkA"></span><span id="tkB"></span><span id="tkC"></span></div></div></div>' +
        '<div class="legend"><span>Hafif</span><i></i><span>Yoğun</span></div></div>' +
      '<p class="map-msg" id="mMsg" role="status" hidden></p>' +
      '<p class="map-tip">Büyütmek için haritaya dokun. Haritayı iki parmakla kaydır ve yakınlaştır; sayfa kaydırması bozulmasın diye tek parmak sayfayı kaydırır.</p>' +
      fsHtml();

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
    var nav = new maplibregl.NavigationControl({ showCompass: false });
    map.addControl(nav, 'top-left');

    var el = document.createElement('div');
    el.className = 'wm';
    el.innerHTML = pinHtml(ctx);
    var marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat([ctx.city.lon, ctx.city.lat]).addTo(map);

    S = { box: box, map: map, marker: marker, ctx: ctx, mode: 'map', onClose: onClose, radar: null, cur: -1, timer: 0, playing: false,
          radarMsg: false, styleErr: false, loaded: false, dead: false, favSig: JSON.stringify((ctx.favs || []).map(function (f) { return [f.id, f.lat, f.lon]; })),
          // tam ekran
          fs: false, layer: null, pl: null, step: 0, user: null, grid: [], pts: [], pm: {}, fl: { wx: null, aq: null }, tok: 0, opener: null, hist: false, ro: null, lay: 0, hasWinResize: false,
          sel: null, tapTimer: 0, tapCtl: null, tapTok: 0, tapMarker: null, err: '', busy: false, onMapClick: null };
    map.on('load', function () { if (S && S.map === map) { S.loaded = true; if (S.styleErr) { S.styleErr = false; if (S.mode === 'map') say(''); } } });
    map.on('error', function (e) {
      if (!S || S.map !== map) return;
      var id = e && e.sourceId;
      if (id && /^rv\d+$/.test(id)) return;                    // tek bir radar karosunun hatası haritayı bozmaz
      if (!S.loaded && S.mode === 'map') { S.styleErr = true; say(offline() ? 'Çevrimdışı: harita karoları alınamıyor.' : 'Harita yüklenemedi. İnternet bağlantını kontrol et.'); }
    });
    // Haritaya dokunma: küçük haritada tam ekranı açar; tam ekranda nokta sorgusu başlatır. Sürükleme/çift dokunma click üretmez/iptal eder.
    S.onMapClick = function (e) { if (!S || S.map !== map) return; if (!S.fs) enterFS(null); else onMapTap(e.lngLat); };
    map.on('click', S.onMapClick);
    map.on('dblclick', cancelTap); map.on('movestart', cancelTap); map.on('zoomstart', cancelTap);
    $(box, '#rPlay').innerHTML = global.uiIcon('play', 20);
    box.addEventListener('click', onClick);
    box.addEventListener('keydown', onKey);
    $(box, '#rRange').addEventListener('input', onRange);
    document.addEventListener('visibilitychange', onVis);
    setTitle(); setAttr();
    registerSW();
    setTimeout(function () { if (S && !S.dead) map.resize(); }, 60);
  }

  function pinHtml(ctx) {
    return '<div class="wm-pin" role="img" aria-label="' + esc(ctx.city.name + ', ' + dg(ctx.temp) + ', ' + ctx.text) + '">' +
      global.weatherIcon(ctx.kind, ctx.isDay, 26, false) + (ctx.city.dist ? '<span class="wm-n">' + esc(ctx.city.name) + '</span>' : '') + '<span>' + dg(ctx.temp) + '</span></div>';
  }

  function setTitle() {
    var t = $(S.box, '#mTitle'), s = $(S.box, '#mSub');
    if (S.mode === 'radar') { t.textContent = 'Son 2 Saat Yağış Radarı'; s.textContent = 'Geçmiş gözlem; gelecek tahmini değildir · 10 dakikalık kareler'; }
    else { t.textContent = S.ctx.city.name; s.textContent = 'Şu an ' + dg(S.ctx.temp) + ' · ' + S.ctx.text; }
    if (S.fs) setFsTitle();
  }
  function setAttr() { $(S.box, '#mAttr').innerHTML = BASE_ATTR + (S.mode === 'radar' ? RV_ATTR : '') + (S.fs && S.pl ? PT_ATTR : ''); }
  function say(text) { var m = $(S.box, '#mMsg'); S.radarMsg = !!text && S.mode === 'radar'; m.textContent = text || ''; m.hidden = !text; }
  function whenStyle(fn) { if (S.loaded) fn(); else S.map.once('load', function () { if (S) fn(); }); }   // 'load' bir kez gelir; sonrasında kaynak eklemek güvenli

  function onClick(e) {
    if (!S) return;
    var t = e.target;
    var tab = t.closest('[data-m]');
    if (tab) { if (tab.dataset.m === 'radar') S.layer = 'radar'; else S.layer = null; S.pl = null; setMode(tab.dataset.m); return; }
    if (t.closest('#mClose')) { var cb = S && S.onClose; destroy(); if (cb) cb(); return; }
    if (t.closest('#mExpand')) { enterFS(t.closest('#mExpand')); return; }
    if (t.closest('#rPlay')) { S.playing ? pause() : play(); return; }
    if (t.closest('#rRetry')) { setMode('radar', true, S.fs); return; }
    if (!S.fs) return;
    var ly = t.closest('[data-ly]'); if (ly) { setLayer(S.layer === ly.dataset.ly ? null : ly.dataset.ly); return; }
    var st = t.closest('[data-st]'); if (st) { setStep(+st.dataset.st); return; }
    if (t.closest('#fsClose')) { closeFS(); return; }
    if (t.closest('#fsZin')) { S.map.zoomIn({ duration: 200 }); return; }
    if (t.closest('#fsZout')) { S.map.zoomOut({ duration: 200 }); return; }
    if (t.closest('#fsCity')) { S.map.easeTo({ center: [S.ctx.city.lon, S.ctx.city.lat], duration: 350 }); return; }
    if (t.closest('#fsLoc')) { locate(); return; }
    if (t.closest('#fsSample')) { sampleView(); return; }
    if (t.closest('.fc-x')) { closeCard(); return; }
    if (t.closest('[data-act="retry"]')) { S.err = ''; if (S.pl) ensure(ML.layer(S.pl).src === 'aq' ? 'aq' : 'wx'); renderNote(); return; }
    if (t.closest('[data-act="cretry"]')) { if (S.sel) showPoint(S.sel, true); return; }
  }
  function onVis() { if (document.hidden) pause(); }

  // ---------- Harita / radar geçişi ----------
  // Tam ekranda katman değişince radar kareleri silinmez: opaklık 0 + görünmez yapılır (görünmeyen katman karo istemez), geri dönüşte yalnızca gösterilen kare görünür olur
  function hideRadarLayers() {
    if (!S.radar) return;
    S.radar.frames.forEach(function (f) {
      if (f.added && !f.hid && S.map.getLayer(f.id)) {
        try { S.map.setPaintProperty(f.id, 'raster-opacity', 0); S.map.setLayoutProperty(f.id, 'visibility', 'none'); f.hid = true; } catch (e) { /* stil yenilenmiş olabilir */ }
      }
    });
    S.cur = -1;
  }
  function setMode(m, force, keep) {
    if (!S || (S.mode === m && !force)) return;
    S.mode = m;
    var tabs = S.box.querySelectorAll('[data-m]'), i, c = [S.ctx.city.lon, S.ctx.city.lat];
    for (i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-selected', tabs[i].dataset.m === m ? 'true' : 'false');
    setTitle(); setAttr(); say('');
    if (m === 'map') {
      pause();
      if (keep) hideRadarLayers(); else { clearRadar(); }   // tam ekranda katman değişince kareler silinmez; yalnızca gizlenir (yeniden indirme/kurma yok)
      $(S.box, '#radarUI').hidden = true;
      S.map.setMaxZoom(17); if (!keep) S.map.jumpTo({ center: c, zoom: MAP_ZOOM });
      return;
    }
    if (keep) S.map.setMaxZoom(RADAR_MAXZ); else { S.map.jumpTo({ center: c, zoom: RADAR_ZOOM }); S.map.setMaxZoom(RADAR_MAXZ); } // radar verisi bundan fazla ayrıntılı değil
    $(S.box, '#radarUI').hidden = false;
    say('Radar kareleri alınıyor…');
    var my = S;
    fetchFrames().then(function (data) {
      if (S !== my || S.mode !== 'radar') return;
      if (S.radar && S.radar !== data) clearRadar();           // yeni kare listesi: eski kaynaklar çakışmasın
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
        say(offline() ? 'Çevrimdışı: son alınan radar kareleri gösteriliyor.' : age > 30 ? 'Son radar karesi yaklaşık ' + age + ' dakika önce; güncelleme gecikmiş olabilir.' : 'Radar kapsama alanı dışında kalan yerlerde görüntü boş olabilir.');
        S.radarMsg = false;
      });
    }).catch(function () {
      if (S !== my || S.mode !== 'radar') return;
      S.radarMsg = true;
      var mm = $(S.box, '#mMsg'); mm.hidden = false;
      mm.innerHTML = offline() ? 'Çevrimdışı: radar kareleri alınamıyor.' : 'Radar verisi şu an alınamadı. <button type="button" class="map-x" id="rRetry">Tekrar dene</button>';
    });
  }

  function addFrame(i) {
    var f = S.radar.frames[i], map = S.map;
    if (f.added) {
      if (f.hid && map.getLayer(f.id)) { map.setLayoutProperty(f.id, 'visibility', 'visible'); f.hid = false; }
      return;
    }
    if (map.getSource(f.id)) { f.added = true; return; }        // aynı kaynak ikinci kez eklenmez
    var before;
    (map.getStyle().layers || []).some(function (l) { if (l.type === 'symbol') { before = l.id; return true; } });   // etiketlerin altında kalsın
    // 512 px karo: aynı görüntü için 4 kat daha az istek (ücretsiz katman dakikada 100 istek)
    map.addSource(f.id, { type: 'raster', tiles: [S.radar.host + f.path + '/512/{z}/{x}/{y}/2/1_1.png'], tileSize: 512, maxzoom: 6 });
    map.addLayer({ id: f.id, type: 'raster', source: f.id, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } }, before);
    f.added = true;
  }
  function clearRadar() {
    if (!S.radar) return;
    S.radar.frames.forEach(function (f) {
      if (f.added) { try { if (S.map.getLayer(f.id)) S.map.removeLayer(f.id); if (S.map.getSource(f.id)) S.map.removeSource(f.id); } catch (e) { /* stil yeniden yüklenmiş olabilir */ } f.added = false; f.hid = false; }
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
        if (my.map.isSourceLoaded(id) || Date.now() - t0 > 6000 || offline()) { idx++; next(); } else setTimeout(wait, 150);
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

  // =====================================================================
  // TAM EKRAN
  // =====================================================================
  function enterFS(opener) {
    if (!S || S.fs) return;
    var box = S.box;
    S.fs = true; S.opener = opener || $(box, '#mExpand');
    if (S.mode === 'radar') S.layer = 'radar'; else if (!S.pl) S.layer = null;
    box.classList.add('fs'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Hava haritası');
    document.documentElement.classList.add('lock');
    try { S.map.cooperativeGestures.disable(); } catch (e) { /* eski sürüm */ }
    try { history.pushState({ hdfs: 1 }, ''); S.hist = true; } catch (e) { S.hist = false; }
    document.addEventListener('keydown', onDocKey, true);
    window.addEventListener('popstate', onPop);
    window.addEventListener('online', onNet); window.addEventListener('offline', onNet);
    onNet();
    buildPoints(); syncMarkers();
    syncLayerUI();
    resizeSoon();
    var cl = $(box, '#fsClose'); if (cl) cl.focus({ preventScroll: true });
    watchLayout();
    silentLocate();
  }
  // Yan düğmeler (zoom / şehir / konum) üstteki başlık bloğu ile alttaki yığın arasındaki boşluğa ölçülerek yerleştirilir: sığmazsa tek sıraya,
  // o da sığmazsa geçici olarak gizlenir (kontroller birbirini örtmez). Boyut değişimini ResizeObserver izler.
  function layoutFs() {
    if (!S || !S.fs) return;
    S.lay = 0;
    var box = S.box, top = $(box, '#fsTop'), side = $(box, '#fsSide'); if (!top || !side) return;
    var vh = box.clientHeight, tb = top.getBoundingClientRect().bottom, st = vh - 34, i, r, sl = box.clientWidth - side.offsetWidth - 14;
    ['#mMsg', '#fsCard', '#fsSteps', '#radarUI', '#fsLegend'].forEach(function (sel) {
      var e = $(box, sel);
      if (e && !e.hidden) { r = e.getBoundingClientRect(); if (r.height > 0 && r.top < st && r.right > sl) st = r.top; }   // yalnızca yan düğmelerle aynı sütuna denk gelenler
    });
    var avail = st - tb - 12, btn = side.querySelector('.fs-btn').offsetHeight || 44, col = btn * 4 + 8 * 3;
    side.classList.remove('row'); side.style.visibility = '';
    if (avail >= col) { side.style.top = Math.round(tb + 8 + Math.min(40, (avail - col) / 2)) + 'px'; }
    else if (avail >= btn) { side.classList.add('row'); side.style.top = Math.round(tb + 6 + (avail - btn) / 2) + 'px'; }
    else { side.style.visibility = 'hidden'; }       // çok dar: kart kapanana kadar gizli (kıstırma/pinch ile yakınlaştırma sürer)
    var g = side.querySelectorAll('.fs-btn'); for (i = 0; i < g.length; i++) g[i].tabIndex = side.style.visibility === 'hidden' ? -1 : 0;
  }
  function scheduleLayout() { if (S && S.fs && !S.lay) S.lay = requestAnimationFrame(layoutFs); }
  function watchLayout() {
    if (S.ro || typeof ResizeObserver === 'undefined') { window.addEventListener('resize', scheduleLayout); S.hasWinResize = true; scheduleLayout(); return; }
    S.ro = new ResizeObserver(scheduleLayout);
    ['#fsTop', '#mMsg', '#fsCard', '#fsSteps', '#radarUI', '#fsLegend'].forEach(function (sel) { var e = $(S.box, sel); if (e) S.ro.observe(e); });
    S.ro.observe(S.box); scheduleLayout();
  }
  function unwatchLayout(s) {
    if (s.ro) { s.ro.disconnect(); s.ro = null; }
    if (s.hasWinResize) { window.removeEventListener('resize', scheduleLayout); s.hasWinResize = false; }
    if (s.lay) { cancelAnimationFrame(s.lay); s.lay = 0; }
  }
  function resizeSoon() {
    var my = S;
    my.map.resize();
    requestAnimationFrame(function () { if (S === my && !my.dead) my.map.resize(); });
    setTimeout(function () { if (S === my && !my.dead) my.map.resize(); }, 120);
  }
  function closeFS() {
    if (!S || !S.fs) return;
    var back = S.hist && history.state && history.state.hdfs;
    exitFS();
    if (back) { try { history.back(); } catch (e) { /* geçmiş yoksa sorun değil */ } }
  }
  function onPop() { if (S && S.fs) { S.hist = false; exitFS(); } }
  function exitFS() {
    if (!S || !S.fs) return;
    var box = S.box, op = S.opener;
    cancelTap(); abortAll(); closeCard(true); unwatchLayout(S);
    S.fs = false; S.hist = false;
    document.removeEventListener('keydown', onDocKey, true);
    window.removeEventListener('popstate', onPop); window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet);
    // tam ekran açıkken seçilen nokta katmanı küçük haritada görünmez; radar açıksa küçük haritada da radar sürer
    removeMarkers();
    if (S.pl) { S.pl = null; S.layer = null; setAttr(); }
    S.grid = []; S.pts = [];
    box.classList.remove('fs'); box.removeAttribute('role'); box.removeAttribute('aria-modal'); box.removeAttribute('aria-label');
    box.removeAttribute('data-pl'); box.removeAttribute('data-layer'); box.classList.remove('has-card');
    document.documentElement.classList.remove('lock');
    try { S.map.cooperativeGestures.enable(); } catch (e) { /* eski sürüm */ }
    resizeSoon();
    setTitle();
    var q = $(box, '#fsNote'); if (q) q.textContent = '';
    if (op && op.isConnected && op.focus) op.focus({ preventScroll: true });
  }
  function onNet() {
    if (!S || !S.fs) return;
    var off = offline(), b = $(S.box, '#fsOff');
    b.hidden = !off;
    if (!off && S.pl) ensure(ML.layer(S.pl).src === 'aq' ? 'aq' : 'wx');
    renderNote(); paintMarkers();
  }
  function onKey(e) {                                        // katman düğmeleri arasında ok tuşları
    if (!S || !S.fs) return;
    var chip = e.target.closest && e.target.closest('.fs-chip');
    if (chip && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      var all = Array.prototype.slice.call(S.box.querySelectorAll('.fs-chip')), i = all.indexOf(chip), n = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
      if (n) { n.focus(); e.preventDefault(); }
    }
  }
  function focusables() {
    var q = S.box.querySelectorAll('button:not([disabled]), [tabindex="0"], input:not([disabled]), a[href]'), out = [], i;
    for (i = 0; i < q.length; i++) { var n = q[i]; if (n.offsetParent !== null || n === document.activeElement) out.push(n); }
    return out;
  }
  function onDocKey(e) {
    if (!S || !S.fs) return;
    if (e.key === 'Escape') {
      if (!$(S.box, '#fsCard').hidden) { closeCard(); e.stopPropagation(); e.preventDefault(); return; }
      closeFS(); e.stopPropagation(); e.preventDefault(); return;
    }
    if (e.key === 'Tab') {                                   // odak tam ekran içinde kalır
      var f = focusables(); if (!f.length) return;
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (!S.box.contains(a)) { first.focus(); e.preventDefault(); }
      else if (e.shiftKey && a === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && a === last) { first.focus(); e.preventDefault(); }
    }
  }

  function setFsTitle() {
    var t = $(S.box, '#fsTitle'), s = $(S.box, '#fsSub'), sub;
    t.textContent = S.ctx.city.name;
    if (S.layer === 'radar') sub = 'Son 2 saat yağış radarı';
    else if (S.pl) {
      var l = ML.layer(S.pl), c = S.pts.length ? S.pts[0] : null, r = c && C[l.src === 'aq' ? 'aq' : 'wx'][c.key], tm = r && r.time[S.step];
      sub = l.label + ' · ' + ML.stepLabel(S.step) + (tm ? ' (' + ML.clock(tm) + ')' : '');
    } else sub = 'Şu an ' + dg(S.ctx.temp) + ' · ' + S.ctx.text;
    s.textContent = sub;
  }

  // ---------- Katmanlar ----------
  function setLayer(id) {
    if (!S || !S.fs) return;
    var prev = S.layer;
    if (id === prev) return;
    S.layer = id; S.pl = ML.isPoint(id) ? id : null;
    if (id === 'radar') setMode('radar', false, true);
    else if (S.mode === 'radar') setMode('map', false, true);
    S.err = '';
    syncLayerUI();
    if (S.pl) ensure(ML.layer(S.pl).src === 'aq' ? 'aq' : 'wx');
  }
  function syncLayerUI() {
    var box = S.box, chips = box.querySelectorAll('.fs-chip'), i;
    for (i = 0; i < chips.length; i++) chips[i].setAttribute('aria-pressed', chips[i].dataset.ly === S.layer ? 'true' : 'false');
    box.setAttribute('data-pl', S.pl ? '1' : '0'); box.setAttribute('data-layer', S.layer || '');
    var steps = $(box, '#fsSteps');
    if (S.pl) {
      steps.hidden = false;
      steps.innerHTML = '<div class="st-row">' + ML.CFG.steps.map(function (s) {
        return '<button type="button" class="fs-chip st" data-st="' + s + '" aria-pressed="' + (s === S.step) + '">' + ML.stepLabel(s) + '</button>';
      }).join('') + '</div><div class="st-row"><button type="button" class="fs-chip sm" id="fsSample">Bu görünümü örnekle</button><span class="st-n">Saatlik model tahmini · en çok 9 nokta</span></div>';
    } else { steps.hidden = true; steps.textContent = ''; }
    renderLegend(); renderNote(); setFsTitle(); setAttr();
    paintMarkers();
  }
  function setStep(s) {
    if (!S || !S.pl || s === S.step) return;
    S.step = s;
    var bs = S.box.querySelectorAll('.fs-chip.st'), i;
    for (i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', +bs[i].dataset.st === s ? 'true' : 'false');
    paintMarkers(); setFsTitle(); if (S.sel) renderCard();
  }
  function renderNote() {
    var n = $(S.box, '#fsNote'); if (!n) return;
    var html;
    if (S.layer === null) html = 'Bir katman seç. Radar gerçek yağış görüntüsüdür; diğerleri noktasal model değerleridir (alan haritası değil).';
    else html = esc(ML.layer(S.layer).note);
    if (S.pl) {
      var kind = ML.layer(S.pl).src === 'aq' ? 'aq' : 'wx';
      if (S.err) html += ' <b>' + esc(S.err) + '</b> <button type="button" class="fs-link" data-act="retry">Tekrar dene</button>';
      else if (offline()) html += ' <b>Çevrimdışı' + (hasAny(kind) ? ': son alınan veriler.' : ': veri alınamıyor.') + '</b>';
      else if (S.fl[kind]) html += ' <b>Yükleniyor…</b>';
    }
    n.innerHTML = html; n.hidden = false;
  }
  function renderLegend() {
    var box = $(S.box, '#fsLegend'), lg = S.pl ? ML.legend(S.pl) : null;
    if (!lg) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    if (lg.kind === 'gradient') {
      box.innerHTML = '<div class="lg-bar" style="background:' + lg.css + '"></div><div class="lg-t">' + lg.ticks.map(function (t) { return '<span>' + t + '</span>'; }).join('') + '<em>' + esc(lg.unit) + '</em></div>';
    } else {
      box.innerHTML = '<div class="lg-seg">' + lg.items.map(function (x) { return '<i style="background:' + x.color + '" title="' + esc(x.label) + '"></i>'; }).join('') + '</div><div class="lg-t"><span>' + esc(lg.items[0].label) + '</span><span>' + esc(lg.items[lg.items.length - 1].label) + '</span></div>';
    }
  }
  function hasAny(kind) { return S.pts.some(function (p) { return !!C[kind][p.key]; }); }

  // ---------- Noktalar + işaretler ----------
  function favList() { return (S.ctx.favs || []).filter(function (f) { return f && typeof f.lat === 'number' && typeof f.lon === 'number'; }); }
  function buildPoints() {
    S.pts = ML.buildPoints({ city: { name: S.ctx.city.name, lat: S.ctx.city.lat, lon: S.ctx.city.lon, id: 'city' }, favs: favList(), user: S.user, grid: S.grid });
  }
  function ptByKey(k) { for (var i = 0; i < S.pts.length; i++) if (S.pts[i].key === k) return S.pts[i]; return null; }
  function markerEl(pt) {
    var el = document.createElement('div');
    el.className = 'pm pm-' + pt.role; el.tabIndex = 0; el.setAttribute('role', 'button');
    el.addEventListener('click', function (e) { e.stopPropagation(); onPointTap(pt.key); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPointTap(pt.key); } });
    return el;
  }
  function syncMarkers() {
    if (!S) return;
    var want = {}, k;
    S.pts.forEach(function (p) { want[p.key] = 1; });
    for (k in S.pm) if (!want[k]) { S.pm[k].marker.remove(); delete S.pm[k]; }
    S.pts.forEach(function (p) {
      var cur = S.pm[p.key];
      if (cur) { cur.pt = p; cur.el.className = 'pm pm-' + p.role; return; }
      var el = markerEl(p);
      S.pm[p.key] = { pt: p, el: el, h: '', marker: new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(S.map) };
    });
    paintMarkers();
  }
  function removeMarkers() {
    var k; for (k in S.pm) S.pm[k].marker.remove();
    S.pm = {};
    if (S.tapMarker) { S.tapMarker.remove(); S.tapMarker = null; }
  }
  function dataOk(kind, key) { var r = C[kind][key]; return !!r && (ML.fresh(r, kind, Date.now()) || offline()); }
  function pillHtml(pt, name) {
    var l = ML.layer(S.pl), kind = l.src === 'aq' ? 'aq' : 'wx', n = name ? '<i class="pm-n">' + esc(name) + '</i>' : '';
    if (!dataOk(kind, pt.key)) return n + '<b class="pm-v pm-e">' + (S.fl[kind] ? '…' : '–') + '</b>';
    var p = ML.pill(C, S.pl, pt.key, S.step);
    if (!p) return n + '<b class="pm-v pm-e">–</b>';
    var arrow = p.rot != null ? '<svg class="pm-ar" viewBox="0 0 24 24" width="14" height="14" style="transform:rotate(' + Math.round(p.rot) + 'deg)" aria-hidden="true"><path d="M12 3v18M6 9l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
    return n + '<b class="pm-v" style="background:' + p.bg + ';color:' + p.fg + '">' + arrow + esc(p.text) + '</b>';
  }
  function paintMarkers() {
    if (!S || !S.fs) return;
    var k;
    for (k in S.pm) {
      var o = S.pm[k], pt = o.pt, h, label;
      if (S.pl) {
        h = pillHtml(pt, pt.role === 'grid' ? '' : pt.name);
        var pv = ML.pill(C, S.pl, pt.key, S.step);
        label = (pt.name || 'Örnek nokta') + ', ' + ML.layer(S.pl).label.toLowerCase() + (pv ? ' ' + pv.text + (S.pl === 'pressure' ? ' hPa' : S.pl === 'wind' ? ' km/sa' : '') : ' verisi yok');
      } else if (pt.role === 'fav') { h = '<span class="pm-s">' + global.uiIcon('star', 12, 'filled') + esc(pt.name) + '</span>'; label = pt.name + ', favori şehir'; }
      else if (pt.role === 'user') { h = '<span class="pm-u"></span>'; label = 'Konumum'; }
      else { h = ''; label = pt.name; }
      if (o.h !== h) { o.el.innerHTML = h; o.h = h; }
      o.el.setAttribute('aria-label', label || '');
      o.el.classList.toggle('pm-fav-on', !!pt.fav);
      o.el.classList.toggle('old', !!S.pl && offline() && !ML.fresh(C[ML.layer(S.pl).src === 'aq' ? 'aq' : 'wx'][pt.key], ML.layer(S.pl).src === 'aq' ? 'aq' : 'wx', Date.now()));
    }
    setFsTitle();
  }

  // ---------- Toplu veri (katman) ----------
  function abortAll() {
    ['wx', 'aq'].forEach(function (k) { if (S.fl[k]) { try { S.fl[k].ctl.abort(); } catch (e) { /* zaten bitti */ } S.fl[k] = null; } });
    if (S.tapCtl) { try { S.tapCtl.abort(); } catch (e) { /* zaten bitti */ } S.tapCtl = null; }
  }
  // Eksik noktalar için TEK toplu istek; aynı noktalar zaten yoldaysa yenisi atılmaz; farklıysa öncekini iptal edip birleşiğini ister
  function ensure(kind) {
    if (!S || !S.fs) return;
    var miss = ML.missing(C, S.pts, kind, Date.now());
    if (!miss.length || offline()) { renderNote(); paintMarkers(); return; }
    var fl = S.fl[kind];
    if (fl && miss.every(function (p) { return fl.keys[p.key]; })) return;
    if (fl) fl.ctl.abort();
    var ctl = new AbortController(), keys = {};
    miss.forEach(function (p) { keys[p.key] = 1; });
    var my = S, job = S.fl[kind] = { ctl: ctl, keys: keys, tok: ++S.tok };
    S.err = '';
    fetch(kind === 'aq' ? ML.aqUrl(miss) : ML.wxUrl(miss), { signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) {
        if (S !== my || my.dead || my.fl[kind] !== job) return;
        my.fl[kind] = null;
        var got = ML.parseBundle(j, miss, kind, Date.now()), any = false, k;
        for (k in got) { ML.cachePut(C, kind, k, got[k]); any = true; }
        if (!any) my.err = 'Bu katman için veri gelmedi.';
        renderNote(); paintMarkers(); if (my.sel) renderCard();
      })
      .catch(function (e) {
        if (S !== my || my.dead || my.fl[kind] !== job) return;
        my.fl[kind] = null;
        if (e && e.name === 'AbortError') return;
        my.err = offline() ? '' : 'Veriler şu an alınamadı.';
        renderNote(); paintMarkers();
      });
    renderNote(); paintMarkers();
  }
  // Örnek noktalar yalnızca üst başlık ile alt paneller arasındaki GÖRÜNEN harita alanından seçilir (panellerin altında kalmasın)
  function freeBounds() {
    var box = S.box, top = $(box, '#fsTop'), w = box.clientWidth, h = box.clientHeight, tb = top.getBoundingClientRect().bottom, st = h - 34, side = $(box, '#fsSide');
    ['#mMsg', '#fsCard', '#fsSteps', '#radarUI', '#fsLegend'].forEach(function (sel) { var e = $(box, sel); if (e && !e.hidden) { var r = e.getBoundingClientRect(); if (r.height > 0 && r.top < st) st = r.top; } });
    var left = 16, right = w - 16 - (side && side.style.visibility !== 'hidden' && !side.classList.contains('row') ? side.offsetWidth + 6 : 0), y0 = tb + 14, y1 = st - 14;
    if (y1 - y0 < 120 || right - left < 140) { y0 = 8; y1 = h - 8; left = 8; right = w - 8; }     // alan çok darsa tüm görünüm
    var a = S.map.unproject([left, y1]), b = S.map.unproject([right, y0]);
    return { south: a.lat, west: a.lng, north: b.lat, east: b.lng };
  }
  function sampleView() {
    if (!S || !S.fs || !S.pl) return;
    if (offline()) { S.err = ''; renderNote(); return; }
    var fb = freeBounds(), z = S.map.getZoom(), minDeg = 64 * 360 / (512 * Math.pow(2, z));   // ≈64 px'ten yakın örnek atılır (üst üste binmesin)
    var avoid = S.pts.filter(function (p) { return p.role !== 'grid'; });
    S.grid = ML.gridPoints(fb, avoid, minDeg);
    buildPoints(); syncMarkers();
    ensure(ML.layer(S.pl).src === 'aq' ? 'aq' : 'wx');
  }

  // ---------- Nokta penceresi (dokununca) ----------
  function cancelTap() { if (S && S.tapTimer) { clearTimeout(S.tapTimer); S.tapTimer = 0; } }
  function coordText(lat, lon) { return Math.abs(lat).toFixed(2) + '°' + (lat >= 0 ? 'K' : 'G') + ' ' + Math.abs(lon).toFixed(2) + '°' + (lon >= 0 ? 'D' : 'B'); }
  function onMapTap(ll) {
    cancelTap();
    var my = S, lat = ll.lat, lon = ll.lng;
    my.tapTimer = setTimeout(function () {
      if (S !== my || !my.fs) return;
      my.tapTimer = 0;
      var sp = ML.snapPoint(lat, lon);
      showPoint({ lat: sp.lat, lon: sp.lon, name: 'Seçilen nokta', sub: coordText(lat, lon), exact: false });
    }, TAP_DELAY);
  }
  function onPointTap(key) {
    var pt = ptByKey(key); if (!pt) return;
    cancelTap();
    S.map.easeTo({ center: [pt.lon, pt.lat], duration: 300 });
    showPoint({ lat: pt.lat, lon: pt.lon, name: pt.name || 'Örnek nokta', sub: pt.role === 'fav' || pt.role === 'city' ? '' : coordText(pt.lat, pt.lon), exact: true });
  }
  function tapMarker(lat, lon) {
    if (!S.tapMarker) {
      var el = document.createElement('div'); el.className = 'pm-tap'; el.setAttribute('aria-hidden', 'true');
      S.tapMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lon, lat]).addTo(S.map);
    } else S.tapMarker.setLngLat([lon, lat]);
  }
  function showPoint(sel, retry) {
    if (!S || !S.fs) return;
    S.sel = sel; sel.key = ML.keyOf(sel.lat, sel.lon);
    tapMarker(sel.lat, sel.lon);
    var my = S, tok = ++S.tapTok;
    if (S.tapCtl) { try { S.tapCtl.abort(); } catch (e) { /* bitti */ } S.tapCtl = null; }
    var now = Date.now(), need = ['wx', 'aq'].filter(function (k) { return !ML.fresh(C[k][sel.key], k, now); });
    sel.state = need.length && !offline() ? 'loading' : 'ready';
    sel.failed = false;
    renderCard();
    if (!need.length || offline()) return;
    var ctl = new AbortController(); S.tapCtl = ctl;
    var pts = [{ key: sel.key, lat: sel.lat, lon: sel.lon }];
    Promise.all(need.map(function (kind) {
      return fetch(kind === 'aq' ? ML.aqUrl(pts) : ML.wxUrl(pts), { signal: ctl.signal })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (j) { return { kind: kind, got: ML.parseBundle(j, pts, kind, Date.now()) }; })
        .catch(function (e) { if (e && e.name === 'AbortError') throw e; return { kind: kind, got: {}, err: true }; });   // hava kalitesi yoksa kart yine açılır
    })).then(function (res) {
      if (S !== my || my.dead || tok !== my.tapTok) return;      // eski dokunuşun geç yanıtı yenisini ezmez
      my.tapCtl = null;
      res.forEach(function (r) { var k; for (k in r.got) ML.cachePut(C, r.kind, k, r.got[k]); });
      var wxRes = res.filter(function (r) { return r.kind === 'wx'; })[0];
      sel.state = 'ready'; sel.failed = !!(wxRes && (wxRes.err || !C.wx[sel.key]));
      renderCard();
      if (S.pl) paintMarkers();
    }).catch(function () { /* iptal */ });
  }
  function closeCard(silent) {
    var c = $(S.box, '#fsCard');
    S.sel = null; S.tapTok++;
    if (S.tapCtl) { try { S.tapCtl.abort(); } catch (e) { /* bitti */ } S.tapCtl = null; }
    if (S.tapMarker) { S.tapMarker.remove(); S.tapMarker = null; }
    c.hidden = true; c.textContent = ''; S.box.classList.remove('has-card');
  }
  function renderCard() {
    var c = $(S.box, '#fsCard'), sel = S.sel; if (!sel) return;
    var step = S.pl ? S.step : 0, w = ML.wxVals(C, sel.key, step), a = ML.aqVals(C, sel.key, step), wr = C.wx[sel.key];
    var head = '<div class="fc-h"><div class="fc-t"><b>' + esc(sel.name) + '</b><small>' + (sel.sub ? esc(sel.sub) + ' · ' : '') + esc(ML.stepLabel(step)) + (wr && wr.time[step] ? ' ' + ML.clock(wr.time[step]) : '') + '</small></div>' +
      '<button type="button" class="fc-x" aria-label="Kartı kapat">' + global.uiIcon('close', 18) + '</button></div>';
    var body;
    if (sel.state === 'loading') body = '<p class="fc-m">Yükleniyor…</p>';
    else if (!w && offline()) body = '<p class="fc-m">Çevrimdışı: bu nokta için veri alınamıyor.</p>';
    else if (!w) body = '<p class="fc-m">Bu nokta için veri alınamadı. <button type="button" class="fs-link" data-act="cretry">Tekrar dene</button></p>';
    else {
      var rain = w.precipitation, tiles = [
        ['Sıcaklık', w.temperature_2m != null ? ML.dg(w.temperature_2m) : '—', ''],
        ['Hissedilen', w.apparent_temperature != null ? ML.dg(w.apparent_temperature) : '—', ''],
        ['Yağış', rain != null ? ML.mm(rain) + ' mm' : '—', ''],
        ['Rüzgâr', w.wind_speed_10m != null ? Math.round(w.wind_speed_10m) + ' km/sa' : '—',
          (w.wind_direction_10m != null ? ML.windFromText(w.wind_direction_10m) : '') + (w.wind_gusts_10m != null ? (w.wind_direction_10m != null ? ' · ' : '') + 'hamle ' + Math.round(w.wind_gusts_10m) : '')],
        ['Bulut', w.cloud_cover != null ? '%' + Math.round(w.cloud_cover) : '—', ''],
        ['Basınç', w.pressure_msl != null ? Math.round(w.pressure_msl) + ' hPa' : '—', w.pressure_msl != null ? ML.pressureWord(w.pressure_msl) : ''],
        ['Hava kalitesi', a && a.european_aqi != null ? String(global.EAQI.round(a.european_aqi)) : '—', a && a.european_aqi != null ? ML.aqLabel(a.european_aqi) : (offline() ? '' : 'veri yok')]
      ];
      body = '<div class="fc-g">' + tiles.map(function (t, i) {
        var dot = i === 6 && a && a.european_aqi != null ? '<i class="fc-d" style="background:' + ML.aqColor(a.european_aqi) + '"></i>' : '';
        return '<div class="fc-c"><span>' + t[0] + '</span><b>' + dot + esc(t[1]) + '</b>' + (t[2] ? '<small>' + esc(t[2]) + '</small>' : '') + '</div>';
      }).join('') + '</div>' +
      '<p class="fc-s">Open-Meteo model verisi (en yakın model noktası)' + (offline() ? ' · çevrimdışı: son alınan değerler' : '') + '</p>';
    }
    c.innerHTML = head + body; c.hidden = false; S.box.classList.add('has-card');
  }

  // ---------- Konum ----------
  function setUser(lat, lon, fly) {
    if (!S || !S.fs) return;
    S.user = { lat: lat, lon: lon };
    buildPoints(); syncMarkers();
    if (fly) S.map.easeTo({ center: [lon, lat], zoom: Math.max(S.map.getZoom(), S.layer === 'radar' ? 6 : 9), duration: 400 });
    if (S.pl) ensure(ML.layer(S.pl).src === 'aq' ? 'aq' : 'wx');
  }
  function locate() {
    if (!S || !S.fs) return;
    if (S.user) { S.map.easeTo({ center: [S.user.lon, S.user.lat], zoom: Math.max(S.map.getZoom(), 9), duration: 400 }); return; }
    if (!navigator.geolocation) { S.err = ''; flash('Bu cihaz konum vermiyor.'); return; }
    var my = S;
    navigator.geolocation.getCurrentPosition(function (p) {
      if (S !== my || !my.fs) return;
      setUser(p.coords.latitude, p.coords.longitude, true);
    }, function (e) {
      if (S !== my || !my.fs) return;
      flash(e && e.code === 1 ? 'Konum izni verilmedi.' : 'Konum alınamadı.');
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  }
  function silentLocate() {                                // izin zaten verilmişse sessizce konumu al; yoksa SORMA (yalnızca düğmeye basınca sorulur)
    try {
      if (!navigator.permissions || !navigator.geolocation) return;
      var my = S;
      navigator.permissions.query({ name: 'geolocation' }).then(function (st) {
        if (st.state !== 'granted' || S !== my || !my.fs || my.user) return;
        navigator.geolocation.getCurrentPosition(function (p) { if (S === my && my.fs && !my.user) setUser(p.coords.latitude, p.coords.longitude, false); }, function () {}, { enableHighAccuracy: false, timeout: 6000, maximumAge: 600000 });
      }).catch(function () {});
    } catch (e) { /* konum olmadan da çalışır */ }
  }
  function flash(text) {
    var n = $(S.box, '#fsNote'); if (!n) return;
    n.innerHTML = esc(text); var my = S; setTimeout(function () { if (S === my && my.fs) renderNote(); }, 2600);
  }

  // Şehir değişince harita yeniden kurulmaz: yalnızca merkez + işaret güncellenir.
  // Yalnızca sıcaklık/ikon gibi veri tazelenmesi haritayı yeniden ORTALAMAZ (kullanıcı tam ekranda gezinirken geri sıçramasın).
  function update(ctx) {
    if (!S || S.dead) return false;
    var favSig = JSON.stringify((ctx.favs || []).map(function (f) { return [f.id, f.lat, f.lon]; })), oldSig = S.favSig, o = S.ctx;
    var cityChanged = o.city.lat !== ctx.city.lat || o.city.lon !== ctx.city.lon || o.city.name !== ctx.city.name;
    var dataChanged = o.temp !== ctx.temp || o.kind !== ctx.kind || o.text !== ctx.text, favChanged = favSig !== oldSig;
    S.ctx = ctx; S.favSig = favSig;
    if (!cityChanged && !dataChanged && !favChanged) return true;
    S.marker.getElement().innerHTML = pinHtml(ctx);
    if (cityChanged) {
      var c = [ctx.city.lon, ctx.city.lat];
      S.marker.setLngLat(c);
      S.map.jumpTo({ center: c });
      var my = S; setTimeout(function () { if (S === my && !my.dead) my.map.resize(); }, 0);
    }
    setTitle();
    if (S.fs && (cityChanged || favChanged)) {
      buildPoints(); syncMarkers();
      if (cityChanged && S.sel) closeCard();
      if (S.pl) ensure(ML.layer(S.pl).src === 'aq' ? 'aq' : 'wx');
    }
    return true;
  }

  function destroy() {
    if (!S) return;
    var s = S, wasFs = s.fs; S = null; s.dead = true;
    clearTimeout(s.timer); clearTimeout(s.tapTimer); unwatchLayout(s);
    ['wx', 'aq'].forEach(function (k) { if (s.fl[k]) { try { s.fl[k].ctl.abort(); } catch (e) { /* bitti */ } } });
    if (s.tapCtl) { try { s.tapCtl.abort(); } catch (e) { /* bitti */ } }
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('keydown', onDocKey, true);
    window.removeEventListener('popstate', onPop); window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet);
    if (wasFs) {
      document.documentElement.classList.remove('lock');
      if (s.hist && history.state && history.state.hdfs) { try { history.back(); } catch (e) { /* geçmiş yoksa sorun değil */ } }
    }
    try {
      var k; for (k in s.pm) s.pm[k].marker.remove();
      if (s.tapMarker) s.tapMarker.remove();
      s.box.removeEventListener('click', onClick); s.box.removeEventListener('keydown', onKey); s.map.remove();
    } catch (e) { /* DOM zaten kalkmış olabilir */ }
  }

  global.WeatherMap = {
    open: open, update: update, destroy: destroy,
    fullscreen: function (on) { if (!S) return; if (on) enterFS(null); else closeFS(); },
    setLayer: setLayer,
    _state: function () { return S; }, _cache: function () { return C; }
  };
})(window);
