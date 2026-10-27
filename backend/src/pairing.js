// pairing.js - bina hardcoded secret ke per-device login.
// Flow: owner ek chhota-umar (30 min) pairing code banata hai -> extension options mein
// paste -> POST /pair/redeem -> extension ko lamba-umar device token milta hai
// (storage.local mein rehta hai). Sab HMAC-signed hai, server par koi DB nahi chahiye.
// Revoke karna ho to SERVER_SECRET badal do (saare tokens band).
import crypto from 'node:crypto';

const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

function safeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// kind: 'pair' (30 min, ek baar) ya 'dev' (device token)
export function makeSigned(secret, kind, fields, ttlMs, now = Date.now()) {
  const payload = b64(JSON.stringify({ k: kind, e: now + ttlMs, n: crypto.randomBytes(8).toString('hex'), ...fields }));
  return `${kind === 'pair' ? 'cc1p' : 'cc1d'}.${payload}.${sign(secret, kind + payload)}`;
}

export function verifySigned(secret, kind, str, now = Date.now()) {
  if (!secret || typeof str !== 'string') return null;
  const [pre, payload, sig] = str.split('.');
  if (pre !== (kind === 'pair' ? 'cc1p' : 'cc1d') || !payload || !sig) return null;
  if (!safeEq(sig, sign(secret, kind + payload))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (d.k !== kind || typeof d.e !== 'number' || d.e < now) return null;
    return d;
  } catch { return null; }
}

const usedPair = new Map(); // nonce -> expiry (best-effort replay guard; restart par reset)
export function redeemPairCode(secret, code, now = Date.now()) {
  const d = verifySigned(secret, 'pair', code, now);
  if (!d) return null;
  for (const [n, e] of usedPair) if (e < now) usedPair.delete(n);
  if (usedPair.has(d.n)) return null;
  usedPair.set(d.n, d.e);
  return makeSigned(secret, 'dev', { o: d.o }, 90 * 24 * 3600 * 1000, now);
}
