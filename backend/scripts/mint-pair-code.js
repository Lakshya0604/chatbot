// Usage: SERVER_SECRET=... node scripts/mint-pair-code.js <ownerId> [ttlMinutes] [backendUrl]
// Code 30 min (default) mein expire hota hai, extension options mein ek baar paste karna hai.
import { makeSigned } from '../src/pairing.js';
const [owner, ttl, url] = process.argv.slice(2);
if (!process.env.SERVER_SECRET || !owner) { console.error('SERVER_SECRET env aur ownerId chahiye'); process.exit(1); }
console.log(makeSigned(process.env.SERVER_SECRET, 'pair', { o: owner, ...(url ? { u: url } : {}) }, (Number(ttl) || 30) * 60000));
