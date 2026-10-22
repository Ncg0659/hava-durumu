'use strict';
/* Türkiye il → ilçe seçici (alt panel). Tembel yüklenir: ilk "konum" dokunuşunda app.js getirir.
   Veri: locations-tr.json (lokal; hiçbir servise sorulmaz) — © OpenStreetMap katkıcıları, ODbL 1.0 (bkz. THIRD_PARTY.md).
   Çıktı: seçilen ilçe window.HD.load({ id: 'İl|İlçe', name, admin: il, lat, lon, prov, dist }) ile yüklenir. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var wrap = $('locSheet'), panel = wrap.querySelector('.sheet'), body = $('locBody'), app = $('app');
  var data = null, loading = null;
  var S = { view: 'root', prov: -1, dist: -1, mah: -1, opener: null, mlist: null, mtok: 0 }, closeT = 0;
  var mahCache = {};   // il adı → Promise<{ ilçe: [[ad,lat,lon],...] }>  (mah/<il>.json, ilk ihtiyaçta, yalnızca o il)

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Arama için katlama: İ I ı i → i; Ç Ğ Ş Ö Ü ve â/î/û gibi şapkalılar → c g s o u a i u (büyük/küçük fark etmez)
  function fold(s) {
    return String(s).replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i').normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // ---------- Veri ----------
  function load() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    var inline = $('lazy-locations-json');
    loading = (inline ? Promise.resolve(JSON.parse(inline.textContent)) : fetch('locations-tr.json').then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }))
      .then(function (j) {
        if (!j || !Array.isArray(j.il) || !j.il.length) throw new Error('veri bozuk');
        var count = {};
        var il = j.il.map(function (p) {
          return { n: p[0], f: fold(p[0]), lat: p[1], lon: p[2], d: p[3].map(function (d) { count[d[0]] = (count[d[0]] || 0) + 1; return { n: d[0], f: fold(d[0]), lat: d[1], lon: d[2] }; }) };
        });
        data = { il: il, dup: count };
        return data;
      }).catch(function (e) { loading = null; throw e; });
    return loading;
  }
  // Mahalle verisi: yalnızca seçilen ilin dosyası istenir (≈5–40 KB); açılışta ve ilçe seçilirken hiçbir şey indirilmez.
  function mahFile(provName) { return 'mah/' + fold(provName).replace(/ /g, '-') + '.json'; }
  function loadMah(provName) {
    if (mahCache[provName]) return mahCache[provName];
    var p = fetch(mahFile(provName)).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) { if (!j || !j.d || typeof j.d !== 'object') throw new Error('veri bozuk'); return j.d; });
    p.catch(function () { delete mahCache[provName]; });   // hata kalıcı olmasın: tekrar denenebilir
    mahCache[provName] = p; return p;
  }
  function mahItems() { return (S.mlist || []).map(function (m) { return { n: m[0], f: fold(m[0]), lat: m[1], lon: m[2] }; }); }
  function provIndex(name) { var f = fold(name), i; for (i = 0; i < data.il.length; i++) if (data.il[i].f === f) return i; return -1; }
  function distIndex(pi, name) { var d = data.il[pi].d, i; for (i = 0; i < d.length; i++) if (d[i].n === name) return i; return -1; }

  // ---------- Görünümler ----------
  function head(title, sub, back) {
    return '<header class="sh-head">' +
      (back ? '<button type="button" class="sh-nav" data-back aria-label="Geri">' + uiIcon('left', 20) + '</button>' : '<span class="sh-sp" aria-hidden="true"></span>') +
      '<div class="sh-title"><h2 id="locTitle">' + title + '</h2><p>' + sub + '</p></div>' +
      '<button type="button" class="sh-x" data-close aria-label="Kapat">' + uiIcon('close', 20) + '</button></header>';
  }
  function row(label, value, act, ph) {
    return '<span class="lp-lab">' + label + '</span><button type="button" class="lp-row" data-act="' + act + '"><span' + (ph ? ' class="ph"' : '') + '>' + esc(value) + '</span>' + uiIcon('right', 18) + '</button>';
  }
  function show(html, view) {
    S.view = view;
    body.className = 'lp-view';
    body.innerHTML = html;
    var f = view === 'root' ? body.querySelector('.lp-row') : body.querySelector('.sh-nav');
    if (view !== 'root' && window.matchMedia && matchMedia('(pointer: fine)').matches) f = body.querySelector('.lp-q') || f;   // klavyesiz cihazda (dokunmatik) giriş odaklanmaz: klavye kendiliğinden açılmasın
    if (f) f.focus({ preventScroll: true });
  }
  function root() {
    var pr = S.prov >= 0 ? data.il[S.prov] : null, ds = pr && S.dist >= 0 ? pr.d[S.dist] : null;
    var mh = ds && S.mah >= 0 && S.mlist && S.mlist[S.mah] ? S.mlist[S.mah][0] : '';
    show(head('Konum seç', 'Türkiye · il, ilçe ve mahalle') +
      '<div class="lp-fields">' + row('İL', pr ? pr.n : 'İl seç', 'prov', !pr) + (pr ? row('İLÇE', ds ? ds.n : 'İlçe seç', 'dist', !ds) : '') +
      (ds ? row('MAHALLE (İSTEĞE BAĞLI)', mh || 'Mahalle seç', 'mah', !mh) : '') + '</div>' +
      '<p class="lp-note">Türkiye dışındaki şehirler için ana ekrandaki “Şehir, ilçe veya mahalle ara” alanını kullan.</p>' +
      '<div class="lp-foot"><button type="button" class="lp-go" data-go' + (ds ? '' : ' disabled') + '>Bu konumu kullan</button></div>', 'root');
  }
  function list(kind) {
    var isP = kind === 'prov', isM = kind === 'mah', nm = isP ? 'İl' : isM ? 'Mahalle' : 'İlçe';
    if (isM && !S.mlist) { mahLoading(); return; }
    show(head(nm + ' seç', isP ? data.il.length + ' il' : isM ? esc(data.il[S.prov].d[S.dist].n + ' · ' + data.il[S.prov].n) : esc(data.il[S.prov].n), true) +
      '<label class="lp-search"><span aria-hidden="true">' + uiIcon('search', 18) + '</span>' +
      '<input class="lp-q" type="search" placeholder="' + nm + ' ara" aria-label="' + nm + ' ara" enterkeyhint="go" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>' +
      '<ul class="lp-list" id="lpList"></ul><p class="lp-empty" id="lpEmpty" hidden>Sonuç bulunamadı.</p>', kind);
    fill('');
  }
  // Mahalle listesi: ilin dosyası gelene kadar kısa bir bekleme; olmazsa ilçe konumuyla devam edilebilir
  function mahLoading() {
    var p = data.il[S.prov], d = p.d[S.dist], pn = p.n, dn = d.n, tok = ++S.mtok;
    show(head('Mahalle seç', esc(dn + ' · ' + pn), true) + '<p class="lp-empty" role="status">Mahalleler yükleniyor…</p>', 'mah-wait');
    loadMah(pn).then(function (dd) {
      if (tok !== S.mtok || S.view !== 'mah-wait') return;
      S.mlist = dd[dn] || [];
      if (!S.mlist.length) { mahFail('Bu ilçe için mahalle verisi yok. İlçe konumunu kullanabilirsin.'); return; }
      list('mah');
    }).catch(function () { if (tok === S.mtok && S.view === 'mah-wait') mahFail('Mahalle listesi yüklenemedi (çevrimdışı olabilirsin). İlçe konumunu kullanabilirsin.'); });
  }
  function mahFail(msg) {
    show(head('Mahalle seç', esc(data.il[S.prov].d[S.dist].n), true) + '<p class="lp-empty" role="status">' + esc(msg) + '</p>', 'mah-wait');
  }
  function items() { return S.view === 'prov' ? data.il : S.view === 'mah' ? mahItems() : data.il[S.prov].d; }
  function fill(q) {
    var all = items(), f = fold(q), pre = [], inn = [], sel = S.view === 'prov' ? S.prov : S.view === 'mah' ? S.mah : S.dist;
    all.forEach(function (x, i) {
      if (!f) pre.push(i);
      else if (x.f.indexOf(f) === 0) pre.push(i);
      else if (x.f.indexOf(f) > 0) inn.push(i);
    });
    var out = pre.concat(inn), ul = $('lpList');
    ul.innerHTML = out.map(function (i) {
      return '<li><button type="button" class="lp-item' + (i === sel ? ' on' : '') + '" data-i="' + i + '"' + (i === sel ? ' aria-current="true"' : '') + '><span>' + esc(all[i].n) + '</span>' + uiIcon('right', 16) + '</button></li>';
    }).join('');
    $('lpEmpty').hidden = out.length > 0;
    ul.scrollTop = 0;
    S.first = out.length ? out[0] : -1;
    if (!q) { var on = ul.querySelector('.on'); if (on) { var lt = on.parentNode.offsetTop - ul.clientHeight / 3; ul.scrollTop = lt > 0 ? lt : 0; } }
  }
  function choose(i) {
    if (i < 0) return;
    if (S.view === 'prov') {
      var changed = i !== S.prov; S.prov = i; if (changed) { S.dist = -1; S.mah = -1; S.mlist = null; }
      if (S.dist < 0) list('dist'); else root();   // il seçilince doğrudan ilçe listesi: akış kısa
    } else if (S.view === 'mah') { S.mah = i; root(); }
    else { if (i !== S.dist) { S.mah = -1; S.mlist = null; } S.dist = i; root(); }
  }
  // Konum nesneleri (panel ve arama çubuğu aynı biçimi kullanır): ilçe kimliği 'İl|İlçe', il kimliği 'İl'
  function distCity(p, d) { return { id: p.n + '|' + d.n, name: d.n, admin: p.n, country: '', lat: d.lat, lon: d.lon, prov: p.n, dist: d.n, dup: data.dup[d.n] > 1 ? 1 : 0 }; }
  // Mahalle kimliği 'İl|İlçe|Mahalle'; ad "Göztepe", üst satır "Kadıköy", il "İstanbul" (eski 'İl|İlçe' kimlikleri aynen çalışır)
  function mahCity(p, d, m) { return { id: p.n + '|' + d.n + '|' + m[0], name: m[0], admin: d.n, country: '', lat: m[1], lon: m[2], prov: p.n, dist: d.n, mah: m[0], dup: data.dup[d.n] > 1 ? 1 : 0 }; }
  function provCity(p) { return { id: p.n, name: p.n, admin: p.n, country: 'Türkiye', lat: p.lat, lon: p.lon, prov: p.n }; }
  function use() {
    if (S.prov < 0 || S.dist < 0) return;
    var p = data.il[S.prov];
    var m = S.mah >= 0 && S.mlist ? S.mlist[S.mah] : null;
    close(true);
    window.HD.load(m ? mahCity(p, p.d[S.dist], m) : distCity(p, p.d[S.dist]));
  }

  // ---------- Mahalle arama indeksi (0.7.3) ----------
  // mah-index.json (yalnızca adlar, ≈60 KB gzip) ilk aramada bir kez iner; açılışta ve il seçiminde indirilmez.
  // Koordinat indekste yok: bir mahalle seçilince yalnızca ilgili il dosyası (mah/<il>.json) istenir.
  var DIST_PRIOR = ['Kadıköy', 'Beşiktaş', 'Üsküdar', 'Şişli', 'Fatih', 'Çankaya', 'Konak', 'Karşıyaka', 'Bornova', 'Nilüfer', 'Muratpaşa', 'Keçiören', 'Maltepe', 'Ataşehir', 'Bakırköy'];
  var mrows = null, mrowsP = null, BIG = ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Konya', 'Gaziantep', 'Kocaeli', 'Mersin'];
  function loadMahIndex() {
    if (mrows) return Promise.resolve(mrows);
    if (mrowsP) return mrowsP;
    if (location.protocol === 'file:') return Promise.reject(new Error('file'));   // tek dosya sürümünde mahalle verisi yok (konsol hatası üretme)
    mrowsP = fetch('mah-index.json').then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).then(function (j) {
      if (!j || !j.p) throw new Error('indeks bozuk');
      var rows = [];
      Object.keys(j.p).forEach(function (pv) {
        var pf = fold(pv);
        Object.keys(j.p[pv]).forEach(function (ds) {
          var df = fold(ds), seen = {};
          j.p[pv][ds].forEach(function (mn) { if (seen[mn]) return; seen[mn] = 1; rows.push({ n: mn, f: fold(mn), d: ds, df: df, p: pv, pf: pf, ctx: ' ' + df + ' ' + pf }); });
        });
      });
      mrows = rows; return rows;
    });
    mrowsP.catch(function () { mrowsP = null; });   // hata kalıcı olmasın (çevrimdışı iken sonra tekrar denenir)
    return mrowsP;
  }
  function ctxOk(r, toks) {   // bağlam sözcüklerinin her biri ilçe/il adındaki bir sözcüğün başı olmalı
    var i, t, ok;
    for (i = 0; i < toks.length; i++) { t = toks[i]; ok = r.ctx.indexOf(' ' + t) >= 0; if (!ok) return false; }
    return true;
  }
  // Sorgu (katlanmış) → mahalle eşleşmeleri: ad = sorgunun ardışık bir parçası, kalan sözcükler il/ilçe bağlamı
  // ('göztepe', 'göztepe kadıköy', 'kadıköy göztepe', 'istanbul kadıköy göztepe'). Dönüş: {ex: tam ad eşleşmeleri, pre: ad başı eşleşmeleri}
  function mahMatch(rows, f, hints) {
    var toks = f.split(' '), n = toks.length, best = {}, i, j, k, r, name, ctx, kind, sc, key;
    if (n > 6) return { ex: [], pre: [] };
    var splits = [];
    for (i = 0; i < n; i++) for (j = i + 1; j <= n; j++) splits.push({ name: toks.slice(i, j).join(' '), ctx: toks.slice(0, i).concat(toks.slice(j)) });
    for (k = 0; k < rows.length; k++) {
      r = rows[k];
      for (i = 0; i < splits.length; i++) {
        name = splits[i].name; ctx = splits[i].ctx;
        if (r.f === name) kind = 0; else if (name.length >= 2 && r.f.indexOf(name) === 0) kind = 1; else continue;
        if (ctx.length && !ctxOk(r, ctx)) continue;
        sc = kind * 10 - ctx.length;   // tam ad önce; daha çok bağlam eşleşmesi (daha belirgin) önce
        key = r.p + '|' + r.d + '|' + r.n;
        if (!best[key] || sc < best[key].sc) best[key] = { r: r, sc: sc, kind: kind, nctx: ctx.length };
      }
    }
    var hs = (hints || []).concat(BIG), all = Object.keys(best).map(function (k2) { return best[k2]; });
    function pr(p) { var i = hs.indexOf(p); return i < 0 ? 999 : i; }
    all.sort(function (a, b) {
      if (a.sc !== b.sc) return a.sc - b.sc;
      var ha = pr(a.r.p), hb = pr(b.r.p);   // hafif tie-break (yalnızca eşit puanda): açık şehir/favori il, sonra büyük iller; yanlış sonucu yukarı taşımaz
      if (ha !== hb) return ha - hb;
      var da = DIST_PRIOR.indexOf(a.r.d), db = DIST_PRIOR.indexOf(b.r.d);   // aynı ilde eşit puan: bilinen merkez ilçeler hafifçe öne
      if (a.r.p === b.r.p && da !== db) return (da < 0 ? 999 : da) - (db < 0 ? 999 : db);
      return a.r.p === b.r.p ? (a.r.d === b.r.d ? a.r.n.localeCompare(b.r.n, 'tr') : a.r.d.localeCompare(b.r.d, 'tr')) : a.r.p.localeCompare(b.r.p, 'tr');
    });
    return { ex: all.filter(function (x) { return x.kind === 0; }), pre: all.filter(function (x) { return x.kind === 1; }) };
  }
  function mahResult(x) {   // koordinatsız sonuç: seçilince resolve() ile il dosyasından tamamlanır
    var r = x.r;
    return { id: r.p + '|' + r.d + '|' + r.n, name: r.n, admin: r.d, country: '', lat: null, lon: null, prov: r.p, dist: r.d, mah: r.n, dup: data.dup[r.d] > 1 ? 1 : 0, pend: 1 };
  }
  function resolve(c) {   // koordinatı olmayan mahalle sonucunu il dosyasından tamamlar; dosya yoksa/çevrimdışıysa reddeder
    if (!c || !c.pend) return Promise.resolve(c);
    return load().then(function () { return loadMah(c.prov); }).then(function (dd) {
      var l = dd[c.dist] || [], k;
      for (k = 0; k < l.length; k++) if (l[k][0] === c.mah) return mahCity({ n: c.prov }, { n: c.dist }, l[k]);
      throw new Error('mahalle bulunamadı');
    });
  }
  function mahCached(prov) {   // çevrimdışıyken: il dosyası önbellekte mi?
    if (!window.caches || !caches.match) return Promise.resolve(false);
    return caches.match(mahFile(prov)).then(function (h) { return !!h; }, function () { return false; });
  }

  // ---------- Arama çubuğu için yerel arama (Türkiye il/ilçe) ----------
  // Sıra: 1) tam eşleşen ilçe 2) tam eşleşen il 3) adı sorguyla başlayanlar (önce iller) 4) diğer eşleşmeler
  function search(q, limit, hints) {
    var f = fold(q); limit = limit || 8;
    if (f.length < 2) return Promise.resolve([]);
    return load().then(function () {
      var t1 = [], t2 = [], t3p = [], t3d = [], t4 = [];
      data.il.forEach(function (p) {
        if (p.f === f) t2.push(provCity(p));
        else if (p.f.indexOf(f) === 0) t3p.push(provCity(p));
        else if (f.length >= 3 && p.f.indexOf(f) > 0) t4.push(provCity(p));
        p.d.forEach(function (d) {
          var dp = d.f + ' ' + p.f, pd = p.f + ' ' + d.f;   // "kadikoy istanbul" ve "istanbul kadikoy" biçimleri de bulunur
          if (d.f === f || dp === f) t1.push(distCity(p, d));
          else if (d.f.indexOf(f) === 0 || dp.indexOf(f) === 0) t3d.push(distCity(p, d));
          else if ((f.indexOf(' ') > 0 && pd.indexOf(f) === 0) || (f.length >= 3 && d.f.indexOf(f) > 0)) t4.push(distCity(p, d));   // 'il ilçe' sırası yalnızca iki sözcük yazılınca (İstanbul yazınca tüm ilçeleri dökmesin)
        });
      });
      function done(mm, info) {
        // Sıra: tam ilçe → tam il (yazılan ifade bir ilçe/il adıysa) → bağlamla (il/ilçe yazılmış) tam mahalle → bağlamsız tam mahalle (≤4) → önek (il, ilçe, mahalle) → diğer.
        // Bağlamsız yazılan bir ad aynı zamanda ilçe/il adıysa ("Kadıköy", "Çankaya") ilçe/il önce gelir; köy/mahalle eşleşmeleri hemen arkasında.
        var ex = mm ? mm.ex : [], exC = ex.filter(function (x) { return x.nctx > 0; }).map(mahResult), exN = ex.filter(function (x) { return x.nctx === 0; }).map(mahResult);
        var pre = mm && !t1.length && !t2.length ? mm.pre.map(mahResult) : [];   // önek mahalleleri yalnızca tam il/ilçe eşleşmesi yokken (İstanbul → İstanbulboğazı köyü dökülmez)
        var out = t1.concat(t2, exC, exN.slice(0, 4), t3p, t3d, pre.slice(0, 3), t4), seen = {}, res = [];
        out.forEach(function (c) { var k = c.id; if (!seen[k]) { seen[k] = 1; res.push(c); } });
        res = res.slice(0, limit);
        res._mahFail = !!info.fail; res._blocked = 0;
        return res;
      }
      return loadMahIndex().then(function (rows) { return mahMatch(rows, f, hints); }).then(function (mm) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {   // çevrimdışı: yalnızca il dosyası önbellekte olan mahalleler listelenir
          var provs = {}; mm.ex.concat(mm.pre).slice(0, 40).forEach(function (x) { provs[x.r.p] = 1; });
          return Promise.all(Object.keys(provs).map(function (pv) { return mahCached(pv).then(function (ok) { return [pv, ok]; }); })).then(function (arr) {
            var okp = {}; arr.forEach(function (a) { okp[a[0]] = a[1]; });
            var all = mm.ex.length + mm.pre.length;
            mm = { ex: mm.ex.filter(function (x) { return okp[x.r.p]; }), pre: mm.pre.filter(function (x) { return okp[x.r.p]; }) };
            var res = done(mm, {}); res._blocked = Math.max(0, all - mm.ex.length - mm.pre.length); return res;
          });
        }
        return done(mm, {});
      }, function (e) { return done(null, { fail: !(e && e.message === 'file') }); });
    });
  }

  // ---------- Panel aç/kapat (günlük ayrıntı paneliyle aynı kabuk) ----------
  function reduced() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function open(opener) {
    return load().then(function () {
      document.dispatchEvent(new CustomEvent('hd2:sheet', { detail: 'loc' }));   // aynı anda tek alt panel
      S.opener = opener || null;
      var cur = window.HD.current(), pi = -1, di = -1;
      S.mah = -1; S.mlist = null; S.mtok++;
      if (cur && cur.prov) { pi = provIndex(cur.prov); if (pi >= 0) di = distIndex(pi, cur.dist); }
      else if (cur && cur.country === 'Türkiye' && cur.admin) pi = provIndex(cur.admin);   // aramayla bulunan Türkiye şehri: ili önceden seçili
      S.prov = pi; S.dist = di;
      if (di >= 0 && cur.mah) {   // açık mahalle seçiliyse kutu önceden dolu gelsin (veri gelirse)
        loadMah(cur.prov).then(function (dd) { var l = dd[cur.dist] || [], k; for (k = 0; k < l.length; k++) if (l[k][0] === cur.mah) { if (S.view === 'root' && S.prov === pi && S.dist === di && S.mah < 0) { S.mlist = l; S.mah = k; root(); } return; } }).catch(function () {});
      }
      root();
      clearTimeout(closeT);   // kapanırken hemen yeniden açılırsa eski zamanlayıcı paneli gizlemesin
      if (wrap.hidden || !wrap.classList.contains('open')) {
        wrap.hidden = false;
        void wrap.offsetWidth;
        wrap.classList.add('open');
        document.documentElement.classList.add('lock');
        app.setAttribute('aria-hidden', 'true'); if ('inert' in app) app.inert = true;
        fit();
      }
    });
  }
  document.addEventListener('hd2:sheet', function (e) { if (e.detail !== 'loc') close(true); });
  function close(noFocus) {
    if (wrap.hidden) return;
    wrap.classList.remove('open');
    document.documentElement.classList.remove('lock');
    app.removeAttribute('aria-hidden'); if ('inert' in app) app.inert = false;
    var done = function () { wrap.hidden = true; panel.style.transform = ''; wrap.style.top = wrap.style.height = wrap.style.bottom = ''; };
    clearTimeout(closeT); if (reduced()) done(); else closeT = setTimeout(done, 260);
    if (!noFocus && S.opener && document.contains(S.opener)) S.opener.focus();
  }
  // Ekran klavyesi açılınca panel görünür alana oturur (iOS'ta sabit öğeler klavyenin altında kalabilir)
  function fit() {
    var vv = window.visualViewport; if (!vv || wrap.hidden) return;
    if (window.innerHeight - vv.height > 120) { wrap.style.top = vv.offsetTop + 'px'; wrap.style.height = vv.height + 'px'; wrap.style.bottom = 'auto'; }
    else { wrap.style.top = wrap.style.height = wrap.style.bottom = ''; }
  }
  if (window.visualViewport) { visualViewport.addEventListener('resize', fit); visualViewport.addEventListener('scroll', fit); }

  wrap.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]') || e.target.classList.contains('sheet-bg')) { close(); return; }
    if (e.target.closest('[data-back]')) { root(); return; }
    var a = e.target.closest('[data-act]');
    if (a) { list(a.dataset.act); return; }
    var it = e.target.closest('.lp-item');
    if (it) { choose(+it.dataset.i); return; }
    if (e.target.closest('[data-go]')) use();
  });
  wrap.addEventListener('input', function (e) { if (e.target.classList.contains('lp-q')) fill(e.target.value); });
  wrap.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList.contains('lp-q')) { e.preventDefault(); choose(S.first); }
  });
  document.addEventListener('keydown', function (e) {
    if (wrap.hidden) return;
    if (e.key === 'Escape') { if (S.view !== 'root' && e.target.classList && e.target.classList.contains('lp-q') && e.target.value) { e.target.value = ''; fill(''); } else close(); return; }
    if (e.key === 'Tab') {   // odak panelin içinde kalsın
      var f = Array.prototype.filter.call(wrap.querySelectorAll('button:not([disabled]), input'), function (b) { return b.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  // Kaydırarak kapatma (tutamaktan aşağı çek)
  (function () {
    var grip = $('locGrip'), y0 = null, dy = 0;
    grip.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; panel.style.transition = 'none'; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; });
    function end() { if (y0 == null) return; y0 = null; panel.style.transition = ''; if (dy > 90) close(); else panel.style.transform = ''; }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  })();

  window.HDPlaces = { open: open, fold: fold, load: load, search: search, resolve: resolve, loadMahIndex: loadMahIndex, loadMah: loadMah, mahCity: mahCity, _data: function () { return data; } };
})();
