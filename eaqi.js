/* Avrupa Hava Kalitesi İndeksi (EAQI, Open-Meteo `european_aqi`) — TEK tanım.
   Uygulama (insights.js, app.js) ve bildirim Worker'ı (worker/src/rules.js) sınıfı yalnızca buradan alır; başka yerde eşik/etiket tanımlanmaz.
   Sınıf alt sınırları: 0 Çok iyi · 20 İyi · 40 Orta · 60 Kötü · 80 Çok kötü · 100 Aşırı kötü. Karşılaştırma önce yuvarlanmış tam sayıyla yapılır
   (uygulama kartı da yuvarlanmış değeri gösterir; 59,6 her iki yerde de "60 = Kötü" olur). ABD AQI (us_aqi) sınıflandırmada kullanılmaz. */
'use strict';
(function (g) {
  var MIN = [0, 20, 40, 60, 80, 100];
  var LABEL = ['Çok iyi', 'İyi', 'Orta', 'Kötü', 'Çok kötü', 'Aşırı kötü'];
  function round(v) { var x = Math.round(v); return x === 0 ? 0 : x; }
  function level(v) { var n = round(v), k = 0; while (k < 5 && n >= MIN[k + 1]) k++; return k; }
  function lower(s) { return s.charAt(0).toLocaleLowerCase('tr') + s.slice(1); }
  var E = { MIN: MIN, LABEL: LABEL, BAD: 3, round: round, level: level, label: function (v) { return LABEL[level(v)]; }, labelLower: function (v) { return lower(LABEL[level(v)]); } };
  g.EAQI = E;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : globalThis);
