// Türkiye il/ilçe veri dosyasını (locations-tr.json) üretir.
// Kullanım: node tools/build_locations.mjs <admin-tr.csv> [çıkış.json]
// Kaynak: github.com/osadikoglu/turkey-admin-units-osm, sürüm osm-2026-09-13 (admin-tr.csv, SHA-256 4443454376eb72c3be9be4d50376f56937a386fd0d5badf2c88cda10e7ff4d44)
//         Veri: © OpenStreetMap katkıcıları, ODbL 1.0 (Geofabrik Türkiye özeti 2026-09-13).
// Alınan alanlar: il adı + il merkezi enlem/boylam, ilçe adı + ilçe merkezi enlem/boylam (3 ondalık ≈ 110 m). Mahalle/köy, alt adlar, yarıçap alınmaz.
// Biçim (v2): { v, src, il: [ [ilAdı, lat, lon, [ [ilçeAdı, lat, lon], ... ]], ... ] }
import { readFileSync, writeFileSync } from 'node:fs';

const [, , src, out = 'locations-tr.json'] = process.argv;
if (!src) { console.error('Kullanım: node tools/build_locations.mjs admin-tr.csv [locations-tr.json]'); process.exit(1); }

function parseCsv(txt) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const [head, ...rows] = parseCsv(readFileSync(src, 'utf8'));
const ix = Object.fromEntries(head.map((h, i) => [h, i]));
const recs = rows.filter((r) => r.length >= head.length).map((r) => ({ id: r[ix.osm_id], parent: r[ix.parent_osm_id], level: r[ix.level], name: r[ix.name].trim(), lat: +r[ix.lat], lon: +r[ix.lon] }));
const tr = new Intl.Collator('tr');
const provs = recs.filter((r) => r.level === 'il'), dists = recs.filter((r) => r.level === 'ilce');
if (provs.length !== 81) throw new Error('81 il bekleniyordu: ' + provs.length);
const r3 = (n) => Math.round(n * 1000) / 1000;
const il = provs.sort((a, b) => tr.compare(a.name, b.name)).map((p) => {
  const d = dists.filter((x) => x.parent === p.id).sort((a, b) => tr.compare(a.name, b.name));
  if (!d.length) throw new Error('ilçesiz il: ' + p.name);
  if (!(p.lat > 35 && p.lat < 43 && p.lon > 25 && p.lon < 45)) throw new Error('il koordinatı sınır dışı: ' + p.name);
  return [p.name, r3(p.lat), r3(p.lon), d.map((x) => {
    if (!(x.lat > 35 && x.lat < 43 && x.lon > 25 && x.lon < 45)) throw new Error('koordinat sınır dışı: ' + x.name);
    return [x.name, r3(x.lat), r3(x.lon)];
  })];
});
const total = il.reduce((n, p) => n + p[3].length, 0);
if (total !== dists.length) throw new Error('ilçe sayısı tutmuyor');
const data = {
  v: 2,
  src: '© OpenStreetMap katkıcıları, ODbL 1.0 — github.com/osadikoglu/turkey-admin-units-osm osm-2026-09-13 (Geofabrik 2026-09-13). İl ve ilçe merkezi koordinatları.',
  il
};
writeFileSync(out, JSON.stringify(data));
console.log(il.length + ' il, ' + total + ' ilçe → ' + out + ' (' + readFileSync(out).length + ' bayt)');
