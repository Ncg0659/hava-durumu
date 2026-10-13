# EYRIVO

Ücretsiz, reklamsız, kişisel hava durumu uygulaması (PWA). Saatlik ve 10 günlük tahmin, saatlik/günlük ayrıntı panelleri (basınç trendi, dolu/fırtına riski, görüş, UV, güneş, geçmiş karşılaştırması), hava kalitesi (EAQI), yaşam ve sürüş önerileri, tam ekran katmanlı harita, son 2 saat yağış radarı, favoriler, Türkiye il/ilçe seçimi, dünya araması, isteğe bağlı Web Push uyarıları ve çevrimdışı çalışma.
Framework yok, derleme bağımlılığı yok (yalnızca Node). Sürüm: **0.7.0** (alt bilgide `Sürüm 0.7.0 · <build>`).

## Klasör yapısı
| Yol | Ne |
|---|---|
| `index.html`, `*.js`, `style.css`, `manifest.webmanifest`, `sw.js` | Uygulama kaynağı |
| `advanced/` | Gelişmiş veri modülleri altyapısı (Ensemble, Flood, Climate, Seasonal, Marine, AQ). **Arayüze bağlı değil, bayrakların hepsi kapalı** — bkz. `advanced/README.md` |
| `icons/`, `brand/`, `vendor/maplibre/`, `licenses/`, `locations-tr.json` | Simgeler, marka SVG'leri, MapLibre GL JS, lisans metinleri, il/ilçe verisi |
| `tools/` | `build.mjs` (yayın derlemesi), `build_locations.mjs`, `make_brand.py` |
| `worker/` | Cloudflare Worker (Web Push): kaynak `src/`, derlenmiş `dist/worker.js`, testler `test/`, kurulum `KURULUM.md` |
| `dist/site/` | **Yayına hazır klasör** (GitHub Pages'e bunun içeriği yüklenir) |
| `dist/hava-durumu-v2.html` | Tek dosya sürümü (yedek/önizleme; servis çalışanı ve bildirim yok) |

## Çalıştırma ve derleme
```
node tools/build.mjs          # dist/site/ ve dist/hava-durumu-v2.html üretir (BUILD kimliği içerikten hesaplanır)
cd dist/site && python3 -m http.server 8000   # http://localhost:8000 (servis çalışanı localhost'ta çalışır)
node worker/build.mjs         # worker/dist/worker.js
cd worker && node --test test/*.test.mjs      # birim testleri
```
Sürüm numarası `tools/build.mjs` içindeki `VERSION` sabitidir; `BUILD` dosya içeriklerinden hesaplanır ve servis çalışanı önbellek adına girer (dosya değişince eski önbellek güvenle silinir, kullanıcıya "Yeni sürüm hazır — Güncelle" gösterilir).

## GitHub Pages yayını
1. `node tools/build.mjs`, sonra `dist/site/` **içindekileri** (klasörün kendisini değil) deponun köküne yükle. Depo adı `hava-durumu` ise adres `https://KULLANICI.github.io/hava-durumu/` olur. Tüm yollar göreli olduğu için alt yolda çalışır.
2. Settings → Pages → Branch: `main` / root.
3. Bildirim kullanılacaksa `config.js` içindeki `window.HD_PUSH_URL` Worker adresin olmalı (boşsa bildirim kartı hiç görünmez).

## Cloudflare Worker (Web Push)
Adım adım (ücretsiz, kart gerekmez): `worker/KURULUM.md`. Kısaca: KV oluştur (`hava-uyari`), Worker'a `worker/dist/worker.js` içeriğini yapıştır, `KV` bağlamasını ve `ALLOWED_ORIGIN` değişkenini (`https://KULLANICI.github.io`) ekle, cron `*/30 * * * *`. VAPID anahtarları Worker ilk çalışınca üretip KV'de saklar; **depoda gizli anahtar yoktur**. Bildirim mimarisi: `worker/BILDIRIM_MIMARISI.md`.

## Veri kaynakları ve atıf
Open-Meteo (tahmin, hava kalitesi, geçmiş arşivi, şehir arama; CC BY 4.0, CAMS verisi), OpenFreeMap / OpenMapTiles / OpenStreetMap (harita altlığı), RainViewer (radar), MapLibre GL JS (BSD-3), OpenStreetMap tabanlı il/ilçe verisi (ODbL 1.0), Inter yazı tipi (OFL, logo yolu). Ayrıntı, kullanım koşulları ve lisanslar: `THIRD_PARTY.md`, `licenses/`. Atıflar uygulamanın alt bilgisinde de görünür. Open-Meteo'nun ücretsiz kullanımı ticari olmayan projeler içindir; ticari/herkese açık kullanımda planı ayrıca denetle.

## Gelişmiş modül bayrakları (Paket 7)
`advanced/config.js` → `FEATURES = { ensemble, flood, climate, seasonal, marine, airquality }`, hepsi `false`. Bu sürümde hiçbir kod `advanced.js` paketini yüklemez; bayraklar kapalıyken modüller ağ isteği yapmaz ve depolamaya yazmaz. İleride arayüze açma adımları: `advanced/README.md`.

## Gizlilik
Tarayıcı konumu yalnızca tam ekran haritadaki konum düğmesine basınca istenir (izin daha önce verilmişse harita bunu sessizce kullanır); konum yalnızca bellekte tutulur ve hiçbir sunucuya gönderilmez. Bildirim açılırsa Worker yalnızca push aboneliğini, en çok 3 şehrin yuvarlanmış koordinatını ve saat dilimini saklar.
