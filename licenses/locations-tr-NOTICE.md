# locations-tr.json — kaynak ve lisans

`locations-tr.json` (Türkiye il ve ilçe adları + ilçe merkezi koordinatları) OpenStreetMap verisinden türetilmiştir.

**© OpenStreetMap katkıcıları.** Open Database License (ODbL) 1.0 altındadır: <https://opendatacommons.org/licenses/odbl/1-0/>
(tam metin: `ODbL-1.0.txt`) · <https://www.openstreetmap.org/copyright>

- **Doğrudan kaynak:** github.com/osadikoglu/turkey-admin-units-osm, sürüm `osm-2026-09-13` (`admin-tr.csv`,
  SHA-256 `4443454376eb72c3be9be4d50376f56937a386fd0d5badf2c88cda10e7ff4d44`; yayıncının SHA256SUMS listesiyle doğrulandı).
  Bu veri tabanı da ODbL 1.0 altındadır.
- **OSM kaynağı:** Geofabrik Türkiye özeti `260913` (2026-09-13).
- **Bizim işlememiz:** `tools/build_locations.mjs` ile yalnızca il adı, ilçe adı ve ilçe merkezi enlem/boylamı (3 ondalık) alındı;
  Türkçe alfabe sırasına dizildi. Mahalle/köy, alternatif adlar ve yarıçap alınmadı. 81 il, 973 ilçe.
- **ODbL gereği:** bu dosya türev veri tabanıdır; aynı lisansla (ODbL 1.0) ve bu atıfla paylaşılır. Uygulamanın geri kalan kodu bu lisansa tabi değildir.
