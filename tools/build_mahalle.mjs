// Mahalle verisini il bazlı küçük dosyalara böler: mah/<il-slug>.json (tembel yüklenir; açılışta hiçbiri istenmez).
// Kullanım: node tools/build_mahalle.mjs <admin-tr.csv> [çıkış-klasörü=mah]
// Kaynak: github.com/osadikoglu/turkey-admin-units-osm, osm-2026-09-13 (admin-tr.csv). Veri: © OpenStreetMap katkıcıları, ODbL 1.0.
// Alınan: yalnızca level=mahalle satırları (ad, merkez enlem/boylam 4 ondalık ≈ 11 m). Köy, alt adlar, yarıçap alınmaz.
// Biçim: { v:1, d: { "İlçe": [ [mahalleAdı, lat, lon], ... ] } }  — "Göztepe Mahallesi" → "Göztepe".
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const [, , src, out = 'mah'] = process.argv;
if (!src) { console.error('Kullanım: node tools/build_mahalle.mjs admin-tr.csv [mah]'); process.exit(1); }
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
// places.js içindeki fold ile aynı kural (dosya adı = fold(il adı) boşluk→tire)
function fold(s) { return String(s).replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
const [head, ...rows] = parseCsv(readFileSync(src, 'utf8'));
const ix = Object.fromEntries(head.map((h, i) => [h, i]));
const recs = rows.filter((r) => r.length >= head.length).map((r) => ({ id: r[ix.osm_id], parent: r[ix.parent_osm_id], level: r[ix.level], name: r[ix.name].trim(), lat: +r[ix.lat], lon: +r[ix.lon] }));
const byId = new Map(recs.map((r) => [r.id, r]));
const tr = new Intl.Collator('tr');
const clean = (n) => n.replace(/\s+(Mahallesi|Mah\.?)$/i, '').trim() || n;
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const prov = {};
let total = 0, skipped = 0;
for (const m of recs.filter((x) => x.level === 'mahalle')) {
  const d = byId.get(m.parent); const p = d && d.level === 'ilce' ? byId.get(d.parent) : null;
  if (!p || !(m.lat > 35 && m.lat < 43 && m.lon > 25 && m.lon < 45)) { skipped++; continue; }
  ((prov[p.name] ||= {})[d.name] ||= []).push([clean(m.name), r4(m.lat), r4(m.lon)]);
  total++;
}
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.json')) unlinkSync(join(out, f));
let dupFix = 0, files = 0, bytes = 0;
for (const [pn, ds] of Object.entries(prov)) {
  const o = {};
  for (const dn of Object.keys(ds).sort(tr.compare)) {
    const list = ds[dn].sort((a, b) => tr.compare(a[0], b[0]));
    const seen = {};   // aynı ilçede aynı ad (ör. iki "Yeni") → "Yeni (2)": kimlik tekil kalsın
    for (const e of list) { const k = e[0]; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) { e[0] = k + ' (' + seen[k] + ')'; dupFix++; } }
    o[dn] = list;
  }
  const s = JSON.stringify({ v: 1, d: o });
  writeFileSync(join(out, fold(pn).replace(/ /g, '-') + '.json'), s); files++; bytes += s.length;
}
console.log(total + ' mahalle, ' + files + ' il dosyası, ' + bytes + ' bayt, ' + dupFix + ' yinelenen ad numaralandı, ' + skipped + ' atlandı');
