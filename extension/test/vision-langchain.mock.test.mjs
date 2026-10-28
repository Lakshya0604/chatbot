// vision-langchain.mock.test.mjs - LangChain bundle ka END-TO-END dummy test:
// local mock OpenAI-compatible server ke against real ChatOpenAI call (no real provider).
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../lib/vision.js');
require('../lib/vendor/langchain-vision.bundle.js');
const V = globalThis.CCVision;
const LC = globalThis.CCLangChainVision;

const canned = '{"messages":[{"side":"left","text":"kya haal hai?"},{"side":"right","text":"badhiya, tu bata"},{"side":"left","text":"kal movie chale?"}]}';
let seenBody = null;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seenBody = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: canned }, finish_reason: 'stop' }] }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const cfg = V.resolveVisionProvider({ provider: 'custom', apiKey: 'dummy-key', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'dummy-vision-model' });
const messages = V.buildVisionMessages('aGVsbG8=', 'image/png');
const raw = await LC.interpretChatImage({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, messages, timeoutMs: 15000 });
const parsed = V.parseVisionResponse(raw);
const chat = V.toChatMessages(parsed);

// LangChain ne sahi request bheji?
assert.equal(seenBody.model, 'dummy-vision-model');
const content = seenBody.messages[0].content;
assert.equal(content[0].type, 'text');
assert.ok(content[0].text.includes('Extract every visible chat message'));
assert.equal(content[1].type, 'image_url');
assert.equal(content[1].image_url.url, 'data:image/png;base64,aGVsbG8=');
// Chain output sahi parse + map hua?
assert.equal(chat.length, 3);
assert.deepEqual(chat[2], { role: 'user', content: 'kal movie chale?' });
console.log('PASS langchain mock e2e: request shape + parse + role mapping OK');
server.close();
process.exit(0);
