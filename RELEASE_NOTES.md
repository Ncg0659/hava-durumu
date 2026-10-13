# EYRIVO 0.7.0 — sürüm notları

## Neler var (paketlere göre)
- **Paket 1 — Hata ve tutarlılık:** ortak EAQI sınıflandırması (`eaqi.js`; 60 = "Kötü", uygulama/öneriler/Worker aynı tanım), bildirimlerde "şu an" ile "gelecekte kötüleşme" ayrımı, masaüstü PWA'da arka plandan dönünce sessiz yenileme (<5 dk istek yok, >5 dk bir yenileme, çevrimdışıyken istek yok; iPhone/Android'e uygulanmaz), iOS klavye/otomatik doldurma/dokunma düzeltmeleri.
- **Paket 2/3 — Saatlik ayrıntı ve meteorolojik riskler:** saatlik ayrıntı paneli; basınç trendi, dolu ve fırtına riski (CAPE, lifted index, CIN, donma seviyesi). Eksik veri "Düşük risk" değil "Veri yok" gösterilir.
- **Paket 4 — Ayrıntı panelleri:** sıcaklık, hissedilen, rüzgâr, UV, yağış, basınç, görüş, nem/çiy noktası, güneş/gün ışığı, sürüş sekmeleri; dünle ve geçmiş 10 yılla karşılaştırma.
- **Paket 5 — Yaşam ve sürüş önerileri:** güvenlik öncelikli kural motoru (fırtına/dolu/kötü hava kalitesinde açık hava önerileri bastırılır), oturum içinde sabit öneri metinleri, sürüş havası.
- **Paket 6 — Tam ekran harita:** aynı MapLibre örneği büyür (yeniden kurulmaz); radar (son 2 saat, oynat/durdur) ve noktasal sıcaklık / bulut / rüzgâr / hava kalitesi / basınç / hissedilen katmanları, dokunma kartı, favori ve konum işaretleri, geri tuşu/Escape ile kapanış, çevrimdışı sakin mod.
- **Paket 7 — Gelişmiş altyapı:** `advanced/` (Ensemble, Flood, Climate, Seasonal, Marine, gelişmiş AQ) — bayrak, konum uygunluğu, modül bazlı önbellek, iptal/yarış koruması. **Arayüzde kapalı.**
- **Final QA:** gizli `#adv-debug` ve `?perf` konsol çıktısı kaldırıldı; aynı anda tek alt panel (bir sheet açılınca diğerleri sessizce kapanır); Open-Meteo bir saatlik değişkeni reddederse (HTTP 400) temel değişkenlerle tek yeniden deneme; sürüm numarası (0.7.0) alt bilgide.

## Bilinen sınırlamalar
- Gelişmiş modüller (Ensemble, Flood, Climate, Seasonal, Marine, gelişmiş AQ) arayüzde **kapalıdır**; bu sürümde kullanıcıya hiçbir şey göstermez ve ağ isteği yapmaz. Ayrıştırıcıları Open-Meteo belgelerinden yazıldı, **canlı yanıtla doğrulanmadı** (`verified:false`).
- Radar geçmişi yaklaşık 2 saattir (RainViewer ücretsiz katman); gelecek tahmini yok.
- Gerçek alan (karo) katmanı yalnızca radardır. Diğer harita katmanları sorgulanan noktalar için model değeridir; ısı haritası, interpolasyon veya izobar üretilmez.
- Bazı Open-Meteo alanları (görüş, CAPE, çiy noktası, polen vb.) konuma/modele göre boş gelebilir; ilgili kart gizlenir veya "Veri yok" yazar.
- Alt panellerde tarayıcı geri tuşu paneli kapatmaz (yalnızca tam ekran harita geri tuşuyla kapanır).
- Testler Chromium emülasyonuyla yapıldı; **gerçek iPhone/Mac/Android cihaz testleri kullanıcı tarafından yapılmalıdır** (safe-area, iOS PWA, Web Push, dokunma ve klavye davranışı).
- Canlı Open-Meteo/RainViewer/OpenFreeMap erişimi geliştirme ortamında yoktu; ağ yanıtları gerçek biçimli sahte yanıtlarla test edildi.
