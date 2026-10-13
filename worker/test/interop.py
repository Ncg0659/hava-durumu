# Bağımsız doğrulama: RFC 8291 / RFC 8292'yi Python 'cryptography' ile sıfırdan uygulayıp Worker'ın ürettiği isteği çözer.
import json, sys, base64, hmac, hashlib
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
d = json.load(sys.stdin)
b = lambda s: base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))
def hkdf(salt, ikm, info, n):
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()                      # Extract
    out, t, i = b'', b'', 1
    while len(out) < n: t = hmac.new(prk, t + info + bytes([i]), hashlib.sha256).digest(); out += t; i += 1   # Expand
    return out[:n]
body = b(d['body']); salt, rs, idlen = body[:16], int.from_bytes(body[16:20], 'big'), body[20]
asPub = body[21:21 + idlen]; ct = body[21 + idlen:]
assert rs == 4096 and idlen == 65 and len(body) <= 4096
priv = ec.derive_private_key(int.from_bytes(b(d['privD']), 'big'), ec.SECP256R1())
uaPub = b(d['p256dh']); assert priv.public_key().public_bytes(__import__('cryptography.hazmat.primitives.serialization', fromlist=['x']).Encoding.X962, __import__('cryptography.hazmat.primitives.serialization', fromlist=['x']).PublicFormat.UncompressedPoint) == uaPub
shared = priv.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), asPub))
ikm = hkdf(b(d['auth']), shared, b'WebPush: info\x00' + uaPub + asPub, 32)
cek = hkdf(salt, ikm, b'Content-Encoding: aes128gcm\x00', 16); nonce = hkdf(salt, ikm, b'Content-Encoding: nonce\x00', 12)
plain = AESGCM(cek).decrypt(nonce, ct, None)
assert plain[-1] == 2, 'dolgu ayırıcı'
msg = json.loads(plain[:-1].decode('utf-8')); assert msg == d['payload'], msg
# VAPID (RFC 8292)
h = d['headers']; assert h['Content-Encoding'] == 'aes128gcm' and h['Authorization'].startswith('vapid t=')
t, k = h['Authorization'][len('vapid t='):].split(', k='); assert k == d['vapidPub']
hd, pl, sg = t.split('.'); sig = b(sg); assert len(sig) == 64
pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), b(k))
pub.verify(encode_dss_signature(int.from_bytes(sig[:32], 'big'), int.from_bytes(sig[32:], 'big')), (hd + '.' + pl).encode(), ec.ECDSA(hashes.SHA256()))
claims = json.loads(b(pl)); assert claims['aud'] == 'https://fcm.googleapis.com' and claims['sub'].startswith('https://') and claims['exp'] - d['now'] // 1000 == 12 * 3600
assert json.loads(b(hd)) == {'typ': 'JWT', 'alg': 'ES256'}
print('OK: Python (bağımsız) şifreyi çözdü:', msg['title'], '|', msg['body'][:40], '| VAPID imzası geçerli, aud/exp/sub doğru')
