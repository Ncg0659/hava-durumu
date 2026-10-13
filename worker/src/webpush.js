// Web Push (RFC 8030) + mesaj şifreleme (RFC 8291, aes128gcm) + VAPID (RFC 8292).
// Yalnızca tarayıcı/Workers'ın yerleşik WebCrypto'su kullanılır; üçüncü taraf kod yok.

const enc = new TextEncoder();

export function b64uEnc(bytes) {
  let s = ''; const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDec(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let p = 0; a.forEach((x) => { o.set(x, p); p += x.length; }); return o; };

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

// RFC 8291: gövdeyi şifrele. opts.salt / opts.asKeyPair yalnızca test için.
export async function encryptPayload(plain, p256dhB64, authB64, opts = {}) {
  const uaPub = b64uDec(p256dhB64), auth = b64uDec(authB64);
  if (uaPub.length !== 65 || uaPub[0] !== 4 || auth.length < 16) throw new Error('geçersiz abonelik anahtarı');
  const as = opts.asKeyPair || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = cat(plain, new Uint8Array([2]));                       // 0x02: son (tek) kayıt
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  const rs = new Uint8Array([0, 0, 0x10, 0]);                         // kayıt boyutu 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

// ---------- VAPID ----------
export async function generateVapid() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { pub: b64uEnc(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
}
export async function vapidAuth(endpoint, vapid, subject, nowMs) {
  const aud = new URL(endpoint).origin, exp = Math.floor((nowMs || Date.now()) / 1000) + 12 * 3600;
  const head = b64uEnc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64uEnc(enc.encode(JSON.stringify({ aud, exp, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', vapid.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body)));   // ham r||s = JOSE biçimi
  return 'vapid t=' + head + '.' + body + '.' + b64uEnc(sig) + ', k=' + vapid.pub;
}

// İzin verilen push servisleri (kötüye kullanımı / rastgele adrese istek göndermeyi önler)
const HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function allowedEndpoint(ep) {
  try { const u = new URL(ep); return u.protocol === 'https:' && HOSTS.some((r) => r.test(u.hostname)); } catch (e) { return false; }
}

// Bildirimi gönder. Döner: HTTP durum kodu (201 = kabul edildi, 404/410 = abonelik artık geçersiz)
export async function sendPush(sub, payload, vapid, subject, o = {}) {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub.keys.p256dh, sub.keys.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      TTL: String(o.ttl ?? 3600), Urgency: o.urgency || 'normal',
      Authorization: await vapidAuth(sub.endpoint, vapid, subject, o.nowMs)
    },
    body
  });
  return res.status;
}
