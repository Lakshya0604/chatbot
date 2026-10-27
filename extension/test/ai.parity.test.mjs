import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { buildMessages } from '../../backend/src/prompt.js';
const require = createRequire(import.meta.url);
require('../lib/ai.js');
const { CCAI } = globalThis;
const chars = [{}, { name: 'Meera', gender: 'female', tone: 'funny', age: '21', backstory: 'Pune', vocabulary: 'scene', replyLength: 'medium', topics: 'movies', boundaries: 'no politics', styleExamples: 'haha sahi', flirting: true, playful: false, defaultMood: 'calm', humour: 'high', role: 'college friend' }];
const msgs = [{ role: 'user', content: 'hey' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: '  kya chal raha  ' }, { role: 'user', content: '' }];
test('prompt parity with backend', () => { for (const c of chars) assert.deepEqual(CCAI.buildMessages(c, msgs), buildMessages(c, msgs)); });
test('resolveProvider', () => {
  assert.throws(() => CCAI.resolveProvider({ provider: 'groq', apiKey: '' }));
  assert.equal(CCAI.resolveProvider({ provider: 'groq', apiKey: 'k' }).baseUrl, 'https://api.groq.com/openai/v1');
  assert.throws(() => CCAI.resolveProvider({ provider: 'custom', apiKey: 'k', baseUrl: 'http://evil.example.com', model: 'm' }));
  assert.throws(() => CCAI.resolveProvider({ provider: 'custom', apiKey: 'k', baseUrl: 'https://x.example.com/v1' }));
  assert.equal(CCAI.resolveProvider({ provider: 'custom', apiKey: 'k', baseUrl: 'https://x.example.com/v1/', model: 'm' }).baseUrl, 'https://x.example.com/v1');
});
test('last message must be incoming', async () => {
  await assert.rejects(CCAI.generateReply({ apiKey: 'k' }, { character: {}, messages: [{ role: 'assistant', content: 'x' }] }), /last message/);
});
test('error text never contains key', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'bad key SECRETKEY123 here' });
  try { await assert.rejects(CCAI.callProvider({ apiKey: 'SECRETKEY123' }, [{ role: 'user', content: 'x' }]), (e) => !/SECRETKEY123/.test(e.message) && /401/.test(e.message)); }
  finally { globalThis.fetch = realFetch; }
});
