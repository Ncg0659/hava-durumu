# Aşama 4 — Önemli Hava Uyarıları (push bildirimi): mimari ve eşikler

**Felsefe:** "Telefon bildirim verdiyse bakmaya değer bir şey vardır." Düşük önemde bildirim yok, aynı olay için tekrar yok.
**Maliyet:** 0 TL. Cloudflare Workers **Free** + KV **Free** + Open-Meteo (ücretsiz, anahtarsız) + tarayıcının kendi Web Push servisi (Google/Apple/Mozilla; ücretsiz).

## 1. Akış

```
 Telefon (PWA, GitHub Pages)                Cloudflare Worker (Free)                      Open-Meteo
 ───────────────────────────                ────────────────────────                      ──────────
 [Önemli hava uyarıları] AÇ
   izin iste (kullanıcı dokunuşuyla)
   pushManager.subscribe(VAPID genel anahtar) ◄── GET /vapid
   POST /subscribe {abonelik, şehirler(≤3), saat dilimi} ──► KV'ye yaz
                                              ┌─ Cron: her 30 dk ─────────────────────┐
                                              │ KV'den abonelikleri oku               │
                                              │ Şehirler için TEK istekle tahmin al ──┼──► forecast + air-quality
                                              │ Kural motoru: 8 olay türü, eşikler    │
                                              │ Tekrar önleme + sessiz saat + günlük sınır
                                              │ Gerekirse Web Push (şifreli, VAPID) ──┼──► Google/Apple/Mozilla push servisi
                                              └───────────────────────────────────────┘                │
 sw.js 'push' olayı → bildirimi göster  ◄──────────────────────────────────────────────────────────────┘
 bildirime dokun → uygulama açılır
```
Tarayıcı kapalıyken de çalışır: bildirimi telefonun işletim sistemi/push servisi teslim eder, uygulama açık olmak zorunda değildir.

## 2. Neden bu mimari (ve sınırları)
| Konu | Karar |
|---|---|
| Sunucu | Cloudflare Workers Free: 100.000 istek/gün, cron çağrısı başına **10 ms CPU**, çağrı başına **50 alt istek**, hesapta **5 cron**. Limit aşılırsa ücret kesilmez, işlem hata verir (kartsız güvenli). |
| Zamanlayıcı | 1 cron, `*/30 * * * *` → günde 48 çağrı. |
| Depolama | KV Free: günde 100.000 okuma / **1.000 yazma**. Tüm abonelikler tek `db` anahtarında; **yalnızca değişince yazılır** (bildirim gönderilince / abonelik değişince). |
| Alt istek bütçesi | 1 tahmin (çok konumlu) + 1 hava kalitesi + nadiren 1 iklim verisi + gönderilen bildirim sayısı. Çalıştırma başına en fazla 20 push (50 sınırının çok altında). |
| CPU bütçesi | Şifreleme ve imza tarayıcının yerel `crypto` altyapısıyla yapılır; Node ölçümüne göre bir çalıştırma birkaç ms. Bu **bir kişi / birkaç cihaz** için tasarlandı. |
| Anahtarlar | VAPID anahtar çifti Worker ilk çalışınca kendisi üretir ve KV'de saklar. Elle anahtar/gizli değer yapıştırılmaz. |
| Hız sınırı riski | Open-Meteo, aynı IP'den çok istek gelirse 429 verebilir (Cloudflare IP'leri paylaşımlı). Bir çalıştırma atlanırsa 30 dk sonra yeniden denenir; olay kaçmaz, gecikir. |
| iPhone | Web Push yalnızca **Ana Ekrana eklenmiş** uygulamada, **iOS 16.4+**, izin isteği dokunuşla. Sessiz push yok: her push görünür bildirim olmalı (öyle yapıyoruz). |
| Android/Chrome | Doğrudan çalışır (tarayıcı sekmesinde de, kurulu uygulamada da). |
| Gizlilik | Worker yalnızca şunları saklar: push adresi + anahtarları, seçilen ≤3 şehrin adı ve koordinatı (2 ondalık), saat dilimi, bildirim sayaçları. Konum izni istenmez. Kapatınca kayıt silinir. |

**Hangi şehirler izlenir:** favoriler (en fazla ilk 3). Favori yoksa son baktığın şehir. Kart, hangi şehirlerin izlendiğini yazar. İl → ilçe ile seçilen konumlarda sunucuya ad, enlem/boylam ile isteğe bağlı `province` ve `district` gider (kurallar yalnızca koordinatı kullanır); aynı adlı ilçelerde ad "Aksu (Antalya)" biçimindedir. Saat dilimi cihazınkidir (sessiz saatler senin yerel saatine göre).

## 3. Uyarı türleri ve eşikler
Hepsi tek yerde: `worker/src/rules.js` → `T`. İstersen sayıları oradan değiştirirsin.

| # | Tür | Ne zaman bildirir | Bakılan süre |
|---|---|---|---|
| 1 | **Kuvvetli yağış** | Saatte ≥ **8 mm** yağmur **veya** 3 saatte ≥ **20 mm** (olasılık ≥ %60); ya da şiddetli sağanak kodu (82) ve ≥ 4 mm. Kar: saatte ≥ **2 cm** (olasılık ≥ %60). **Hafif/orta yağmur için bildirim yok.** | önümüzdeki 6 saat |
| 2 | **Kuvvetli rüzgâr** | Rüzgâr ≥ **50 km/sa** veya hamle ≥ **70 km/sa** | önümüzdeki 12 saat |
| 3a | **Aşırı sıcak** | Sıcaklık ≥ **37°** (veya hissedilen ≥ 41° ve sıcaklık ≥ 33°) **ve** son 5 yılın aynı dönem ortalamasından ≥ **6°** yüksek. Böylece "zaten hep sıcak" yerlerde sürekli uyarmaz. İklim verisi alınamazsa daha sıkı mutlak eşik: ≥ **40°**. | önümüzdeki 18 saat |
| 3b | **Aşırı soğuk** | Sıcaklık ≤ **−7°** (veya hissedilen ≤ −15° ve sıcaklık ≤ −3°) **ve** aynı dönem ortalamasından ≥ **7°** düşük. İklim verisi yoksa ≤ **−15°**. | önümüzdeki 18 saat |
| 4 | **UV** | Push yalnızca **aşırı (≥ 11)**; 08:00–16:59 arası saatler. **8–10 (çok yüksek) push göndermez**, uygulama içinde (UV kartı, öneriler) kalır. 72 saatte en fazla 1. | önümüzdeki 6 saat |
| 5 | **Hava kalitesi** | **Ölçek sabit: Avrupa Hava Kalitesi İndeksi (EAQI)**, Open-Meteo `european_aqi`; uygulamadaki kartla (`insights.js` `eaqiLevel`) aynı sınırlar: <20 çok iyi · <40 iyi · <60 orta · **60–79 Kötü** · **80–99 Çok kötü** · **≥100 Aşırı kötü**. Push yalnızca ≥ 60. ABD AQI (`us_aqi`) bildirimde kullanılmaz. Bir üst seviyeye kötüleşirse (12 sa bekleme sonrası) yeniden bildirir. Test, `insights.js`'teki sınırlarla eşitliği otomatik doğrular. | önümüzdeki 6 saat |
| 6 | **Don / buzlanma** | (a) Dondurucu yağmur/çise (kod 56, 57, 66, 67, olasılık ≥ %30) **veya** (b) önceki 6 saatte ≥ 0,3 mm yağmur ve sıcaklık ≤ **0°** (ıslak yol donar) **veya** (c) sis ve ≤ −1° (kırağı). Kuru, sadece soğuk hava için yok. | önümüzdeki 12 saat |
| 7 | **Gök gürültülü fırtına** | Fırtına kodu 95/96/99 ve olasılık ≥ %40 | önümüzdeki 6 saat |

**Hiç push gönderilmeyenler:** gün doğumu/batımı, sabah/akşam özeti, sıradan değişiklikler, hafif yağmur, normal rüzgâr, orta/yüksek UV, iyi/orta hava kalitesi. Bunlar uygulamada bilgi olarak kalır.

## 4. Bildirim bombardımanını önleme
1. **Olay kimliği:** `tür | yerel tarih | günün 6 saatlik dilimi` (örn. `storm:2026-10-07:2`). Aynı kimlik bir kez gider.
2. **Bekleme süresi (tür başına, şehir başına):** fırtına/yağış/rüzgâr 6 sa · don 12 sa · hava kalitesi 12 sa · sıcak/soğuk 20 sa · UV 72 sa. Tahmin saati kayarsa aynı olay yeniden gönderilmez.
3. **Birleştirme:** fırtına varsa aynı şehirde kuvvetli yağış ayrıca gönderilmez.
4. **Günlük sınır:** bir cihaza günde en fazla **5** bildirim (öncelik: fırtına > rüzgâr > yağış > don > sıcak > soğuk > hava kalitesi > UV).
5. **Sessiz saatler:** 23:00–07:00 (cihazın saat dilimi). Gece YALNIZCA şu 4 tür geçebilir ve yalnızca önümüzdeki 3 saat içindeyse: **ciddi fırtına** (dolu kodu 96/99 veya ihtimal ≥ %60), **çok kuvvetli yağış** (≥ 15 mm/sa ya da 3 saatte ≥ 35 mm; kar ≥ 4 cm/sa), **tehlikeli rüzgâr** (hamle/rüzgâr ≥ 90 km/sa), **ciddi buzlanma** (dondurucu yağmur, ihtimal ≥ %50). **UV, hava kalitesi, sıcak, soğuk geceleri asla gönderilmez** (kodda ayrıca engellenir). Gece ertelenen olay hâlâ sürüyorsa 07:00'den sonra TEK kez gider.
6. Olay bitip **yeni bir ciddi olay** oluşursa (bekleme süresi dolduktan sonra) yeniden bildirim gider.

## 5. Uygulama içi arayüz
Ana ekran kalabalıklaşmaz: sayfanın en altında, altbilginin üstünde **tek bir kart**:
**"Önemli hava uyarıları"** [anahtar] + açıklama. Altında kapalı gelen **"Bildirim türleri"** (7 tür ve eşikler, "Deneme bildirimi gönder").
Worker adresi `config.js` içinde boşsa kart hiç görünmez, uygulama eskisi gibi çalışır.


## KV yazma bütçesi (Free: 1.000 yazma/gün) — kural: okuma ağırlıklı, yazma yalnızca zorunluysa
| Durum | KV yazma |
|---|---|
| Cron çalıştı, bildirim yok (günün %99'u) | **0** |
| Gün dönümü, sayaç sıfırlama, eski kayıt budama | **0** (bellekte yapılır; bir sonraki gerçek yazımla kalıcı olur) |
| Bildirim gönderilen cron çalıştırması | **1** (tüm abonelikler tek `db` kaydında) |
| Başarısız push (5xx) — tekrar denenecek | 0 (gönderildi sayılmaz) |
| Abonelik / şehir listesi / kapatma değişikliği | 1 (içerik aynıysa **0**) |
| Geçersiz abonelik (404/410) silinmesi | 1 |
| Deneme bildirimi | **0** (dakikada 1 sınırı bellekte tutulur) |
| İklim ortalaması önbelleği (şehir başına, 60 gün) | ~1 / şehir / 60 gün, yalnızca sıcak/soğuk eşiği aşılınca |
| VAPID anahtarı | 1 (ömür boyu) |
En kötü gün: 48 cron × 1 = 48 yazma (gerçekçi: <10). Limit 1.000. Testler (`cron.test.mjs`) bunları sayarak doğrular.

## Tek bildirim felsefesi
Bildirim gelmişse bakmaya değer bir durum vardır. Aynı olay için tek bildirim (olay kimliği + tür başına bekleme), olay bittikten sonra yeni ciddi olay için yeniden bildirim, günlük en fazla 4. Emin olunamayan durumda bildirim **gönderilmez**.
