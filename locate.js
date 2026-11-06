/* EYRIVO açılışta mevcut konum (0.8.x): saf yardımcılar (tarayıcısız test edilebilir, module.exports).
   Uygulama her yeni açılışta önce son kullanılan konumu gösterir; arka planda tarayıcının konumu alınır ve başarılıysa o koordinata geçilir.
   Bu dosya yalnızca karar mantığını içerir (koordinat doğrulama, favoriye/mevcut konuma yakınlık, izin hatırlama); ağ ve DOM yok.
   Favoriler ASLA burada değiştirilmez. Konum yalnızca cihazda ve hava verisi istenirken (3 ondalık, ~100 m) kullanılır. */
'use strict';
(function (g) {
  var NEAR_KM = 1.5;          // mevcut/favori konuma bu kadar yakınsa konum değiştirilmez (kullanıcı zaten orada)
  var MAX_ACC_M = 50000;      // bundan kaba (IP tabanlı vb.) konum kullanılmaz
  var DENY_DAYS = 7;          // izin reddedildiyse (ve izin sorgusu desteklenmiyorsa) bu süre tekrar istenmez
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function validCoords(lat, lon, acc) {
    return num(lat) && num(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) && (acc == null || !num(acc) || acc <= MAX_ACC_M);
  }
  function round3(x) { return Math.round(x * 1000) / 1000; }
  function km(aLat, aLon, bLat, bLon) {
    var R = 6371, r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // Konum şehri. İlçe/mahalle adı TAHMİN EDİLMEZ (en yakın ilçe merkezi yanlış ilçe olabilir): başlık yalnızca 'Mevcut konum'; il/ilçe alanı yok, bölge anahtarı koordinat hücresinden türer.
  function makeCity(lat, lon) {
    lat = round3(lat); lon = round3(lon);
    return { id: 'gps:' + lat.toFixed(2) + ',' + lon.toFixed(2), name: 'Mevcut konum', admin: '', country: '', lat: lat, lon: lon, gps: 1 };
  }
  // Karar: { act:'keep' } (zaten orada) | { act:'fav', city } (favoriye çok yakın: o favori gösterilir, favori listesi değişmez) | { act:'gps' } (yeni konum şehri üret)
  function decide(lat, lon, cur, favs) {
    if (cur && num(cur.lat) && km(lat, lon, cur.lat, cur.lon) <= NEAR_KM) return { act: 'keep' };
    var best = null;
    (favs || []).forEach(function (f) { if (f && num(f.lat) && num(f.lon)) { var k = km(lat, lon, f.lat, f.lon); if (k <= NEAR_KM && (!best || k < best.k)) best = { k: k, f: f }; } });
    return best ? { act: 'fav', city: best.f } : { act: 'gps' };
  }
  // İzin: 'denied' → asla; 'granted' → sessizce; 'prompt'/bilinmiyor → tarayıcının kendi istemi (reddedilmişse DENY_DAYS boyunca tekrar istenmez)
  function shouldAsk(permState, rec, now) {
    if (permState === 'denied') return false;
    if (permState === 'granted') return true;
    return !(rec && num(rec.deny) && now - rec.deny < DENY_DAYS * 86400000);
  }
  var API = { validCoords: validCoords, round3: round3, km: km, makeCity: makeCity, decide: decide, shouldAsk: shouldAsk, NEAR_KM: NEAR_KM, MAX_ACC_M: MAX_ACC_M, DENY_DAYS: DENY_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  g.HDLocate = API;
})(typeof window !== 'undefined' ? window : globalThis);
