// Cloudflare path: LangChain ChatOpenAI + custom fetch -> native /ai/run request shape (mock fetch, no network).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../lib/vision.js');
require('../lib/vendor/langchain-vision.bundle.js');
const V = globalThis.CCVision, LC = globalThis.CCLangChainVision;
const realFetch = globalThis.fetch;
let seen = null;
globalThis.fetch = async (url, init) => {
  seen = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({ success: true, result: { response: { messages: [{ text: 'kya haal hai?' }, { text: 'kal movie chale?' }] } } }), { status: 200 });
};
const r = V.resolveVisionProvider({ provider: 'cloudflare', apiKey: 'dummy-token', accountId: '1efd55911297ca9fcf01f7baaa93d644' });
const raw = await LC.interpretChatImage({ baseUrl: r.baseUrl, apiKey: r.apiKey, model: r.model, provider: 'cloudflare', messages: V.buildTranscribeMessages('aGVsbG8=', 'image/png') });
assert.equal(seen.url, 'https://api.cloudflare.com/client/v4/accounts/1efd55911297ca9fcf01f7baaa93d644/ai/run/@cf/meta/llama-4-scout-17b-16e-instruct');
assert.equal(seen.body.image, undefined);
assert.ok(seen.body.messages[0].content[0].text.includes('Transcribe every visible chat message'));
assert.equal(seen.body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,aGVsbG8=');
assert.match(String(seen.headers.Authorization || seen.headers.authorization || ''), /^Bearer dummy-token$/);
assert.deepEqual(V.parseTranscriptResponse(raw), ['kya haal hai?', 'kal movie chale?']);
// legacy 3.2 model: prompt+image shape
const r32 = V.resolveVisionProvider({ provider: 'cloudflare', apiKey: 'dummy-token', accountId: '1efd55911297ca9fcf01f7baaa93d644', model: '@cf/meta/llama-3.2-11b-vision-instruct' });
await LC.interpretChatImage({ baseUrl: r32.baseUrl, apiKey: r32.apiKey, model: r32.model, provider: 'cloudflare', messages: V.buildTranscribeMessages('aGVsbG8=', 'image/png') });
assert.equal(seen.body.image, 'aGVsbG8='); assert.equal(seen.body.messages, undefined);
// Scout choices-shaped result with Devanagari
globalThis.fetch = async () => new Response(JSON.stringify({ success: true, result: { choices: [{ message: { content: '{"messages":[{"text":"मैं ठीक हूँ"},{"text":"kal milte hain 😄"}]}' } }] } }), { status: 200 });
const rawHi = await LC.interpretChatImage({ baseUrl: r.baseUrl, apiKey: r.apiKey, model: r.model, provider: 'cloudflare', messages: V.buildTranscribeMessages('aGVsbG8=', 'image/png') });
assert.deepEqual(V.parseTranscriptResponse(rawHi), ['मैं ठीक हूँ', 'kal milte hain 😄']);
assert.equal(V.verifyLastMessage(V.parseTranscriptResponse(rawHi), 'kal milte hain 😄').ok, true);
// CF error -> thrown (fail-closed), key not leaked by us
globalThis.fetch = async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'AiError: boom' }] }), { status: 400 });
await assert.rejects(() => LC.interpretChatImage({ baseUrl: r.baseUrl, apiKey: r.apiKey, model: r.model, provider: 'cloudflare', messages: V.buildTranscribeMessages('aGVsbG8=', 'image/png') }));
globalThis.fetch = realFetch;
console.log('PASS cloudflare native path via LangChain: request shape + parse + error fail-closed');
process.exit(0);
