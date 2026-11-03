// vision.test.mjs - lib/vision.js ke pure parts ke unit tests (no network).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
require('../lib/vision.js');
const V = globalThis.CCVision;

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } }

// --- resolveVisionProvider ---
t('mock provider requires mockReply', () => {
  assert.throws(() => V.resolveVisionProvider({ provider: 'mock' }), /mockReply/);
  const r = V.resolveVisionProvider({ provider: 'mock', mockReply: '{"messages":[]}' });
  assert.equal(r.provider, 'mock');
});
t('cloudflare requires 32-hex accountId + key', () => {
  assert.throws(() => V.resolveVisionProvider({ provider: 'cloudflare' }), /API key/);
  assert.throws(() => V.resolveVisionProvider({ provider: 'cloudflare', apiKey: 'k', accountId: 'xyz' }), /accountId/);
  const r = V.resolveVisionProvider({ provider: 'cloudflare', apiKey: 'k', accountId: 'a'.repeat(32) });
  assert.equal(r.baseUrl, 'https://api.cloudflare.com/client/v4/accounts/' + 'a'.repeat(32) + '/ai/v1');
  assert.equal(r.model, V.CF_DEFAULT_MODEL);
});
t('cloudflare custom model override', () => {
  const r = V.resolveVisionProvider({ provider: 'cloudflare', apiKey: 'k', accountId: 'b'.repeat(32), model: '@cf/x/y' });
  assert.equal(r.model, '@cf/x/y');
});
t('custom requires https + model', () => {
  assert.throws(() => V.resolveVisionProvider({ provider: 'custom', apiKey: 'k', baseUrl: 'http://evil.com', model: 'm' }), /https/);
  assert.throws(() => V.resolveVisionProvider({ provider: 'custom', apiKey: 'k', baseUrl: 'https://ok.com/v1' }), /model/);
  const r = V.resolveVisionProvider({ provider: 'custom', apiKey: 'k', baseUrl: 'https://ok.com/v1/', model: 'm' });
  assert.equal(r.baseUrl, 'https://ok.com/v1');
});
t('unknown provider throws', () => {
  assert.throws(() => V.resolveVisionProvider({ provider: 'gemini', apiKey: 'k' }), /unknown/);
});

// --- buildVisionMessages ---
t('buildVisionMessages makes OpenAI content blocks', () => {
  const m = V.buildVisionMessages('QUJD', 'image/png');
  assert.equal(m.length, 1);
  assert.equal(m[0].role, 'user');
  assert.equal(m[0].content[0].type, 'text');
  assert.equal(m[0].content[1].type, 'image_url');
  assert.equal(m[0].content[1].image_url.url, 'data:image/png;base64,QUJD');
});
t('buildVisionMessages defaults bad mime to jpeg', () => {
  const m = V.buildVisionMessages('QUJD', 'text/html');
  assert.equal(m[0].content[1].image_url.url, 'data:image/jpeg;base64,QUJD');
});

// --- parseVisionResponse ---
t('parses clean JSON', () => {
  const out = V.parseVisionResponse('{"messages":[{"side":"left","text":"hi"},{"side":"right","text":"hello"}]}');
  assert.deepEqual(out, [{ side: 'left', text: 'hi' }, { side: 'right', text: 'hello' }]);
});
t('parses fenced JSON', () => {
  const out = V.parseVisionResponse('```json\n{"messages":[{"side":"left","text":"yo"}]}\n```');
  assert.equal(out[0].text, 'yo');
});
t('parses JSON with surrounding prose', () => {
  const out = V.parseVisionResponse('Sure! Here you go: {"messages":[{"side":"right","text":"ok"}]} hope that helps');
  assert.equal(out[0].side, 'right');
});
t('empty extraction allowed (no messages visible)', () => {
  assert.deepEqual(V.parseVisionResponse('{"messages":[]}'), []);
});
t('fail-closed on non-JSON', () => {
  assert.throws(() => V.parseVisionResponse('I cannot see anything'), /JSON nahi/);
  assert.throws(() => V.parseVisionResponse(''), /empty/);
  assert.throws(() => V.parseVisionResponse(null), /empty/);
});
t('fail-closed on bad shape', () => {
  assert.throws(() => V.parseVisionResponse('{"foo":1}'), /messages/);
  assert.throws(() => V.parseVisionResponse('{"messages":[{"side":"middle","text":"x"}]}'), /message\[0\]/);
  assert.throws(() => V.parseVisionResponse('{"messages":[{"side":"left","text":"  "}]}'), /message\[0\]/);
});

// --- toChatMessages ---
t('maps sides to roles', () => {
  const msgs = V.toChatMessages([{ side: 'left', text: 'a' }, { side: 'right', text: 'b' }, { side: 'left', text: 'c' }]);
  assert.deepEqual(msgs, [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
