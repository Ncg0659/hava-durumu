// Python'daki bağımsız çözücü için gerçek bir push isteği üretir (JSON olarak stdout'a).
import { sendPush, generateVapid, b64uEnc } from '../src/webpush.js';
const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const auth = crypto.getRandomValues(new Uint8Array(16)), vapid = await generateVapid();
const payload = { title: 'Fırtına uyarısı · İstanbul', body: '15:00–17:00 arasında gök gürültülü fırtına bekleniyor. çğıöşü İ', tag: 'x', url: './' };
let cap; globalThis.fetch = async (u, i) => { cap = { u, i }; return new Response(null, { status: 201 }); };
const now = Date.parse('2026-10-07T06:00:00Z');
const st = await sendPush({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: b64uEnc(raw), auth: b64uEnc(auth) } }, payload, vapid, 'https://kullanici.github.io', { nowMs: now });
console.log(JSON.stringify({ status: st, privD: jwk.d, p256dh: b64uEnc(raw), auth: b64uEnc(auth), body: b64uEnc(cap.i.body), headers: cap.i.headers, vapidPub: vapid.pub, payload, now }));
