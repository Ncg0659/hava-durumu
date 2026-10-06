# Üçüncü taraf notları

Tüm servisler ücretsizdir; API anahtarı gerekmez; yapay zekâ servisi kullanılmaz.

## Veri ve servisler
- **Hava durumu, şehir arama:** [Open-Meteo.com](https://open-meteo.com/) — veri CC BY 4.0. Ücretsiz kullanım yalnızca ticari olmayan projeler içindir. Atıf uygulamanın alt kısmında gösterilir.
- **Hava kalitesi:** Open-Meteo Air Quality API. Veri, Copernicus Atmosphere Monitoring Service (CAMS) ENSEMBLE modelinden türetilmiştir. Open-Meteo kuralı gereği CAMS ve Open-Meteo'ya atıf hem hava kalitesi kartında hem altbilgide verilir. Avrupa Hava Kalitesi Endeksi (EAQI) sınıf eşikleri EEA'nın 2024 revizyonundandır (ETC HE Report 2024/17). Veri bir model sonucudur, yerel istasyon ölçümü değildir.
- **Harita altlığı:** [OpenFreeMap](https://openfreemap.org) (ücretsiz, API anahtarsız vektör karolar; stil: Positron). Atıf (haritanın üstünde ve altbilgide, OpenFreeMap'in istediği biçimde): "OpenFreeMap © OpenMapTiles, veri © OpenStreetMap katkıcıları". OpenStreetMap'in kendi karo sunucusu (tile.openstreetmap.org) kullanılmaz; bu sunucu Referer göndermeyen (`file://`) sayfaları engelliyor. Karolar tarayıcının normal HTTP önbelleğiyle saklanır, servis çalışanı bunlara dokunmaz.
- **Yağış radarı:** [RainViewer](https://www.rainviewer.com/) ücretsiz Weather Maps API'si (kişisel/eğitim amaçlı kullanım; atıf zorunlu ve harita üzerinde ile altbilgide verilir). Ücretsiz katman: yalnızca son 2 saat (10 dk aralıklı), en fazla yakınlaştırma 7, tek renk şeması, IP başına dakikada 100 istek. Gelecek tahmini (nowcast) ücretsiz katmanda yoktur, bu yüzden radar "Son 2 Saat" olarak adlandırılır. İstek sayısını düşük tutmak için 512 px karolar kullanılır (13 karenin tamamı ~50 istek). Kullanım koşulları değişirse yeniden kontrol edilmelidir.

## Kütüphaneler
- **MapLibre GL JS 5.24.0** — BSD-3-Clause, Copyright © 2023 MapLibre contributors. Resmî sürüm paketinden (GitHub releases, dist.zip) değiştirilmeden alındı: `vendor/maplibre/` (lisans: `vendor/maplibre/LICENSE.txt`). v6 yalnızca ES modülü olduğundan `file://` ve tek dosya kullanımı için v5 UMD sürümü seçildi. (Önceki Leaflet altlığı kaldırıldı.)

## Ürettiğimiz kod
- `icons.js`: hava ve arayüz ikonları bu proje için çizilmiş özgün SVG'lerdir. (Planlanan: [Meteocons](https://github.com/basmilius/meteocons), MIT. Eklenirse lisans metni bu klasöre konacak.)
- `insights.js`: günlük özet, aktivite önerileri, hava kalitesi sınıfları. Kural tabanlı JavaScript; dış servis çağırmaz.
- `mapview.js`, `sw.js`: harita/radar arayüzü ve yalnızca radar karoları için önbellek. Üçüncü taraf kod kopyalanmadı.
- GitHub projelerinden (julianverse-weather dahil) hiçbir kod kopyalanmadı.

## Aşama 3 (PWA)
- Uygulama simgeleri (`icons/`) ve iPhone açılış görselleri (`icons/splash/`) bu projede çizilmiş özgün çalışmalardır (`tools/make_icons.py`, `tools/make_splash.py`); üçüncü taraf simge/görsel kullanılmadı.
- `sw.js` yalnızca bu sitenin kendi dosyalarını önbelleğe alır. OpenFreeMap, OpenStreetMap, RainViewer ve Open-Meteo yanıtları servis çalışanından geçirilmez ve saklanmaz; bu hizmetlerin kendi önbellek/kullanım kuralları geçerlidir.

## Aşama 4 — Bildirimler
- Web Push, RFC 8030/8291/8292'ye göre bu projede yazıldı; yalnızca tarayıcı/Workers yerleşik WebCrypto kullanılır. Üçüncü taraf kod/kütüphane yok.
- Sunucu: Cloudflare Workers Free + KV Free (ücretsiz katman; kart gerekmez). Veri: Open-Meteo (CC BY 4.0).
- Sunucuda saklanan: push abonelik adresi/anahtarları, en çok 3 şehrin yuvarlanmış koordinatı, saat dilimi, gönderim kayıtları.

## Aşama 5 — Türkiye il → ilçe seçimi
- **Veri:** `locations-tr.json` (81 il, 973 ilçe; il adı, ilçe adı, ilçe merkezi enlem/boylam, 3 ondalık; 27,7 KB). Hiçbir servise sorulmaz, yerel dosyadır.
- **Kaynak:** [osadikoglu/turkey-admin-units-osm](https://github.com/osadikoglu/turkey-admin-units-osm) sürüm `osm-2026-09-13` (`admin-tr.csv`; SHA-256 yayıncının SHA256SUMS listesiyle doğrulandı). Bu veri tabanı OpenStreetMap'ten (Geofabrik Türkiye özeti 2026-09-13) türetilmiştir.
- **Lisans:** © OpenStreetMap katkıcıları, **ODbL 1.0**. `locations-tr.json` türev veri tabanı olduğu için aynı lisansla ve atıfla paylaşılır; atıf uygulama altbilgisinde ve dosyanın `src` alanında vardır. Tam metin ve ayrıntı: `licenses/ODbL-1.0.txt`, `licenses/locations-tr-NOTICE.md`. Uygulamanın kendi kodu bu lisansa tabi değildir.
- **Doğrulama:** Çayeli ve Akçakoca merkez koordinatları Open-Meteo geocoder'ıyla karşılaştırıldı (fark ≈ 200 m); her ilçenin ilinden uzaklığı makul sınırlar içinde.
- **Üretim:** `node tools/build_locations.mjs admin-tr.csv locations-tr.json` (yalnızca il/ilçe/lat/lon alınır, Türkçe alfabe sırası). Mahalle ve köy alınmaz.
- `places.js`: seçim paneli (bu projede yazıldı; üçüncü taraf kod yok). İlk kullanımda yüklenir.
