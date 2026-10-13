// RFC 8291 Ek A test vektörü: şifreleme çıktısı bire bir aynı olmalı.
import test from 'node:test'; import assert from 'node:assert/strict';
import { encryptPayload, b64uDec, b64uEnc } from '../src/webpush.js';
test('RFC 8291 Appendix A vektörü', async () => {
  const asPriv = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
  const asPub = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
  const uaPub = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
  const auth = 'BTBZMqHH6r4Tts7J_aSIgg', salt = 'DGv6ra1nlYgDCS1FRnbzlw';
  const pub = b64uDec(asPub);
  const jwkBase = { kty: 'EC', crv: 'P-256', x: b64uEnc(pub.slice(1, 33)), y: b64uEnc(pub.slice(33, 65)) };
  const privateKey = await crypto.subtle.importKey('jwk', { ...jwkBase, d: asPriv }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const publicKey = await crypto.subtle.importKey('jwk', jwkBase, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const body = await encryptPayload(new TextEncoder().encode('When I grow up, I want to be a watermelon'), uaPub, auth, { salt: b64uDec(salt), asKeyPair: { privateKey, publicKey } });
  const expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  assert.equal(b64uEnc(body), expected);
});
