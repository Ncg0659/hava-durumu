// Derleme: node tools/build.mjs
//  1) dist/site/ : GitHub Pages'e yüklenecek klasör (PWA: manifest, ikonlar, servis çalışanı; harita dosyaları tıklanınca iner).
//  2) dist/hava-durumu-v2.html : tek dosya sürümü (yalnızca yedek/önizleme; PWA parçaları çıkarılır, servis çalışanı yok).
// BUILD kimliği: kabuk dosyalarının içeriğinden hesaplanır; sw.js ve pwa.js içine yazılır. Dosya değişirse kimlik değişir,
// tarayıcı yeni sürümü görür ve eski önbelleği siler.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.7.1';   // EYRIVO sürümü (alt çizgideki BUILD, dosya içeriğinden hesaplanan özet)
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const blob = (id, txt) => {
  if (/<\/script/i.test(txt)) throw new Error(id + ': </script içeriyor');
  return `<script type="text/plain" id="${id}">${txt}</script>\n`;
};
const walk = (d) => readdirSync(join(root, d)).sort().flatMap((n) => {
  const p = d + '/' + n; return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});

const SHELL = ['index.html', 'style.css', 'app.js', 'icons.js', 'eaqi.js', 'insights.js', 'meteo.js', 'advice.js', 'daily.js', 'hourly.js', 'detailcalc.js', 'detail.js', 'pwa.js', 'notify.js', 'maplayers.js', 'mapview.js', 'places.js', 'locations-tr.json', 'manifest.webmanifest', 'THIRD_PARTY.md'];
// Gelişmiş veri modülleri (Paket 7): kaynakta ayrı dosyalar, yayında tek lazy paket (advanced.js). Uygulama açılışında yüklenmez.
const ADV = ['config', 'core', 'capability', 'ensemble', 'flood', 'climate', 'seasonal', 'marine', 'airquality', 'index'].map((n) => `advanced/${n}.js`);
const ASSETS = [...walk('icons'), ...walk('vendor/maplibre'), ...walk('mah')];   // mah/*.json: il bazlı mahalle verisi (tembel; önbelleğe ilk kullanımda girer)
const hash = createHash('sha1');
for (const f of [...SHELL, ...ADV, ...ASSETS, 'sw.js']) { hash.update(f); hash.update(readFileSync(join(root, f))); }
const BUILD = hash.digest('hex').slice(0, 8);
const advBundle = () => '/* EYRIVO gelişmiş veri modülleri (advanced/*.js birleşimi) */\n' + ADV.map((f) => read(f)).join('\n;\n') + '\n';
const stamp = (txt) => txt.replace(/__BUILD__/g, BUILD).replace(/__VERSION__/g, VERSION);

// ---------- 1) site ----------
const site = join(root, 'dist', 'site');
rmSync(site, { recursive: true, force: true });
mkdirSync(join(site, 'vendor', 'maplibre'), { recursive: true });
mkdirSync(join(site, 'icons', 'splash'), { recursive: true });
mkdirSync(join(site, 'mah'), { recursive: true });
writeFileSync(join(site, '.nojekyll'), '');
let siteHtml = read('index.html').replace(/<!--nopwa-->[\s\S]*?<!--\/nopwa-->\n?/, '');
writeFileSync(join(site, 'index.html'), siteHtml);
for (const f of ['style.css', 'icons.js', 'eaqi.js', 'insights.js', 'meteo.js', 'advice.js', 'daily.js', 'hourly.js', 'detailcalc.js', 'detail.js', 'app.js', 'notify.js', 'maplayers.js', 'mapview.js', 'places.js', 'locations-tr.json', 'manifest.webmanifest', 'THIRD_PARTY.md']) copyFileSync(join(root, f), join(site, f));
copyFileSync(join(root, 'config.js'), join(site, 'config.js'));   // sürüm özetine girmez: sonradan elle düzenlenir
mkdirSync(join(site, 'licenses'), { recursive: true });
copyFileSync(join(root, 'licenses', 'ODbL-1.0.txt'), join(site, 'licenses', 'ODbL-1.0.txt'));
copyFileSync(join(root, 'licenses', 'locations-tr-NOTICE.md'), join(site, 'licenses', 'locations-tr-NOTICE.md'));
copyFileSync(join(root, 'licenses', 'Inter-OFL-NOTICE.md'), join(site, 'licenses', 'Inter-OFL-NOTICE.md'));
writeFileSync(join(site, 'advanced.js'), advBundle());
writeFileSync(join(site, 'sw.js'), stamp(read('sw.js')));
writeFileSync(join(site, 'pwa.js'), stamp(read('pwa.js')));
for (const f of ASSETS) if (!f.endsWith('index.txt')) copyFileSync(join(root, f), join(site, f));

// ---------- 2) tek dosya ----------
let html = read('index.html').replace(/<!--pwa-start-->[\s\S]*?<!--pwa-end-->\n?/, '').replace(/<section class="card notify"[^>]*><\/section>\n?/, '').replace('<script src="config.js"></script>\n', '').replace('<script src="notify.js"></script>\n', '');
const swap = (a, b) => { if (!html.includes(a)) throw new Error('bulunamadı: ' + a); html = html.replace(a, () => b); };
swap('<link rel="stylesheet" href="style.css">', `<style>\n${read('style.css')}\n</style>`);
swap('<script src="icons.js"></script>', `<script>\n${read('icons.js')}\n</script>`);
swap('<script src="eaqi.js"></script>', `<script>\n${read('eaqi.js')}\n</script>`);
swap('<script src="insights.js"></script>', `<script>\n${read('insights.js')}\n</script>`);
swap('<script src="meteo.js"></script>', `<script>\n${read('meteo.js')}\n</script>`);
swap('<script src="advice.js"></script>', `<script>\n${read('advice.js')}\n</script>`);
swap('<script src="daily.js"></script>', `<script>\n${read('daily.js')}\n</script>`);
swap('<script src="hourly.js"></script>', `<script>\n${read('hourly.js')}\n</script>`);
swap('<script src="detailcalc.js"></script>', `<script>\n${read('detailcalc.js')}\n</script>`);
swap('<script src="detail.js"></script>', `<script>\n${read('detail.js')}\n</script>`);
swap('<script src="app.js"></script>', `<script>\n${read('app.js')}\n</script>`);
swap('<script src="pwa.js"></script>', `<script>\n${stamp(read('pwa.js'))}\n</script>`);
swap('</body>', blob('lazy-maplibre-css', read('vendor/maplibre/maplibre-gl.css')) + blob('lazy-maplibre-js', read('vendor/maplibre/maplibre-gl.js')) + blob('lazy-maplayers-js', read('maplayers.js')) + blob('lazy-mapview-js', read('mapview.js')) + blob('lazy-advanced-js', advBundle()) + blob('lazy-places-js', read('places.js')) + blob('lazy-locations-json', read('locations-tr.json')) + '</body>');
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'hava-durumu-v2.html'), html);
rmSync(join(root, 'dist', 'sw.js'), { force: true });

console.log('EYRIVO ' + VERSION + ' | BUILD ' + BUILD + ' | dist/site/ + dist/hava-durumu-v2.html (' + Math.round(html.length / 1024) + ' KB)');
