// Derleme: node worker/build.mjs  →  worker/dist/worker.js (Cloudflare panelinde tek dosya olarak yapıştırılır)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const strip = (f) => readFileSync(join(root, 'src', f), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export default /gm, 'const __default = ')
  .replace(/^export (async function|function|const|let)/gm, '$1');
const shared = ['eaqi.js', 'meteo.js'].map((f) => readFileSync(join(root, '..', f), 'utf8').replace(/^'use strict';\n/m, '')).join('\n');   // uygulamayla ortak tanımlar (EAQI, meteoroloji riski)
const out = '// hava-uyari Worker (tek dosya). Kaynak: worker/src/*.js — elle düzenleme, "node worker/build.mjs" ile üretilir.\n' +
  strip('webpush.js') + '\n' + shared + '\n' + strip('rules.js') + '\n' + strip('index.js') + '\nexport default __default;\n';
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'worker.js'), out);
console.log('worker/dist/worker.js', Math.round(out.length / 1024) + ' KB');
