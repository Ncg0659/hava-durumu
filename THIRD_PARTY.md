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
