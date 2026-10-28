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
assert.equal(seen.url, 'https://api.cloudflare.com/client/v4/accounts/1efd55911297ca9fcf01f7baaa93d644/ai/run/@cf/meta/llama-3.2-11b-vision-instruct');
assert.equal(seen.body.image, 'aGVsbG8=');
assert.ok(seen.body.prompt.includes('Transcribe every visible chat message'));
assert.equal(seen.body.messages, undefined);
assert.match(String(seen.headers.Authorization || seen.headers.authorization || ''), /^Bearer dummy-token$/);
assert.deepEqual(V.parseTranscriptResponse(raw), ['kya haal hai?', 'kal movie chale?']);
// CF error -> thrown (fail-closed), key not leaked by us
globalThis.fetch = async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'AiError: boom' }] }), { status: 400 });
await assert.rejects(() => LC.interpretChatImage({ baseUrl: r.baseUrl, apiKey: r.apiKey, model: r.model, provider: 'cloudflare', messages: V.buildTranscribeMessages('aGVsbG8=', 'image/png') }));
globalThis.fetch = realFetch;
console.log('PASS cloudflare native path via LangChain: request shape + parse + error fail-closed');
process.exit(0);
