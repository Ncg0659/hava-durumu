/* PWA katmanı: servis çalışanı kaydı, "Yeni sürüm hazır" bildirimi, kurulum önerisi (Android) ve
   "Paylaş > Ana Ekrana Ekle" yardımı (iPhone). Hava durumu mantığına dokunmaz. */
'use strict';
(function () {
  var BUILD = 'bdbaf3db';
  var INSTALL_KEY = 'hd2:pwa-install-no';   // kapatılırsa bir daha sorulmaz
  var IOS_KEY = 'hd2:pwa-ios-no';
  var SHOW_DELAY = 6000;                    // uygulama açıldıktan sonra rahatsız etmemek için bekle

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sorun değil */ } }
  function $(id) { return document.getElementById(id); }

  var ver = $('ver');
  if (ver) ver.textContent = 'Sürüm ' + (BUILD.indexOf('__') === 0 ? 'geliştirme' : BUILD);

  var bar = document.createElement('div');
  bar.id = 'pwaBar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Uygulama bildirimleri');
  document.body.appendChild(bar);

  function pill(id, icon, text, actLabel, onAct, onClose) {
    var old = $(id); if (old) old.parentNode.removeChild(old);
    var d = document.createElement('div');
    d.className = 'pwa-pill'; d.id = id;
    d.innerHTML = (icon ? window.uiIcon(icon, 20) : '') + '<span class="t">' + text + '</span>' +
      (actLabel ? '<button type="button" class="btn" data-act>' + actLabel + '</button>' : '') +
      (onClose ? '<button type="button" class="pwa-x" data-x aria-label="Kapat">' + window.uiIcon('close', 16) + '</button>' : '');
    d.addEventListener('click', function (e) {
      if (e.target.closest('[data-act]')) onAct(d, e.target.closest('[data-act]'));
      else if (e.target.closest('[data-x]')) { remove(d); onClose(); }
    });
    bar.appendChild(d);
    return d;
  }
  function remove(d) { if (d && d.parentNode) d.parentNode.removeChild(d); }

  function standalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }

  // ---------- Servis çalışanı + güncelleme ----------
  var wantReload = false, reloading = false;
  function showUpdate(worker) {
    if ($('pwaUpdate')) return;
    pill('pwaUpdate', 'refresh', 'Yeni sürüm hazır', 'Güncelle', function (d, b) {
      wantReload = true; b.disabled = true; b.textContent = 'Güncelleniyor…';
      worker.postMessage('SKIP_WAITING');
      setTimeout(function () { if (!reloading) { reloading = true; location.reload(); } }, 4000);   // yedek: olay gelmezse
    }, function () {});
  }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!wantReload || reloading) return;      // kullanıcı onaylamadan sayfa yenilenmez
      reloading = true; location.reload();
    });
    // Kayıt, açılış (splash → ana ekran) bittikten sonra yapılır: ilk açılışta ön-önbellek indirmesi veri/çizimle yarışmasın
    var startSw = function () { navigator.serviceWorker.register('sw.js').then(function (reg) {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
        });
      });
      // Uygulama uzun süre açık kalırsa (ana ekran uygulaması) yeni sürüm için ara sıra bak
      var last = Date.now();
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && Date.now() - last > 30 * 60 * 1000) { last = Date.now(); reg.update().catch(function () {}); }
      });
    }).catch(function () { /* çevrimdışı önbellek olmadan da çalışır */ }); };
    var later = function () { setTimeout(startSw, 1200); };
    if (document.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
  }

  // ---------- Android / Chrome kurulum önerisi ----------
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    if (get(INSTALL_KEY) || standalone()) return;
    setTimeout(function () {
      if (!deferred || get(INSTALL_KEY) || $('pwaInstall')) return;
      pill('pwaInstall', 'download', 'Uygulamayı yükle', 'Yükle', function (d) {
        remove(d);
        var p = deferred; deferred = null; if (!p) return;
        p.prompt();
        if (p.userChoice) p.userChoice.then(function (c) { if (c && c.outcome !== 'accepted') put(INSTALL_KEY, '1'); });
      }, function () { put(INSTALL_KEY, '1'); });
    }, SHOW_DELAY);
  });
  window.addEventListener('appinstalled', function () { put(INSTALL_KEY, '1'); deferred = null; remove($('pwaInstall')); });

  // ---------- iPhone / iPad Safari: otomatik kurulum istemi yok, kısa yardım ----------
  var ua = navigator.userAgent || '';
  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
  if (ios && safari && !standalone() && !get(IOS_KEY)) {
    setTimeout(function () {
      if (get(IOS_KEY) || standalone() || $('pwaIos')) return;
      pill('pwaIos', 'share', 'Ana ekrana ekle: <b>Paylaş</b> › <b>Ana Ekrana Ekle</b>', '', null, function () { put(IOS_KEY, '1'); });
    }, SHOW_DELAY + 2000);
  }
})();
