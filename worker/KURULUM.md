# Bildirim sunucusu kurulumu (Cloudflare Workers — ücretsiz, kredi kartı gerekmez)

Bunu bir kez yapacaksın (~10 dk). Yapmazsan uygulama aynen çalışır, sadece "Önemli hava uyarıları" kartı görünmez.

1. https://dash.cloudflare.com adresinde ücretsiz hesap aç (e-posta + şifre).
2. Sol menü **Storage & Databases → KV → Create** → ad: `hava-uyari` → Create.
3. Sol menü **Workers & Pages → Create → Create Worker** → ad: `hava-uyari` → **Deploy**.
4. Açılan sayfada **Edit code** → soldaki dosyadaki her şeyi sil → `worker/dist/worker.js` dosyasının TAMAMINI yapıştır → **Deploy**.
5. Worker sayfası → **Settings → Bindings → Add → KV namespace** → Variable name: `KV` (büyük harf), namespace: `hava-uyari` → Deploy.
6. **Settings → Variables and Secrets → Add** → Tür: Text → Ad: `ALLOWED_ORIGIN`, değer: `https://KULLANICIADIN.github.io` (sonunda `/` ve `/hava-durumu` YOK) → Deploy.
7. **Settings → Trigger Events → Cron Triggers → Add** → `*/30 * * * *` → Add.
8. Worker adresini kopyala (örn. `https://hava-uyari.KULLANICI.workers.dev`).
9. GitHub'da `config.js` dosyasını düzenle: `window.HD_PUSH_URL = 'https://hava-uyari.KULLANICI.workers.dev';` → Commit.
10. Uygulamayı aç (iPhone'da önce Ana Ekrana ekle) → "Önemli hava uyarıları" anahtarını aç → "Bildirim türleri" → "Deneme bildirimi gönder".

Sorun olursa: Worker sayfası → **Logs**. "Exceeded CPU" görürsen cron'u saatlik yap (`0 * * * *`).
