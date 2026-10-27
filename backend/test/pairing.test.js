import test from 'node:test';
import assert from 'node:assert';
import { makeSigned, verifySigned, redeemPairCode } from '../src/pairing.js';
const S = 'x'.repeat(40);
test('pair code redeem ek baar, device token verify', () => {
  const code = makeSigned(S, 'pair', { o: 'u1' }, 60000);
  const tok = redeemPairCode(S, code);
  assert.ok(tok);
  assert.equal(verifySigned(S, 'dev', tok).o, 'u1');
  assert.equal(redeemPairCode(S, code), null); // replay
});
test('expired, tampered, wrong secret, wrong kind reject', () => {
  const now = Date.now();
  const old = makeSigned(S, 'pair', { o: 'u1' }, 1000, now - 5000);
  assert.equal(redeemPairCode(S, old), null);
  const c = makeSigned(S, 'pair', { o: 'u1' }, 60000);
  assert.equal(redeemPairCode(S, c.slice(0, -2) + 'AA'), null);
  assert.equal(redeemPairCode('y'.repeat(40), c), null);
  assert.equal(verifySigned(S, 'dev', c), null);
  assert.equal(verifySigned('', 'dev', c), null);
});
