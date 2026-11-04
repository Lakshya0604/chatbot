// reply-route.test.js - /reply route ka deterministic integration test (mock provider).
// Real express server child process mein; AI_MOCK=true se reply = last incoming ka echo,
// isliye grounding (kya provider tak pahuncha) exactly assert ho sakta hai.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4899;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'route-test-secret';
const post = (path, body, headers = {}) =>
  fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('/reply: auth 401, last-incoming grounding, loop-prevention 400, followUp exception', async (t) => {
  const child = spawn('node', ['src/server.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, SERVER_SECRET: SECRET, AI_MOCK: 'true', PORT: String(PORT), HOST: '127.0.0.1', TRUST_PROXY: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { const r = await fetch(BASE + '/health'); up = r.status === 200; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  assert.ok(up, 'test server up');

  // Bina token 401 (hosted mode mein credit-protection).
  let r = await post('/reply', { character: {}, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.status, 401, 'token ke bina unauthorized');

  const code = execSync(`SERVER_SECRET="${SECRET}" node scripts/mint-pair-code.js route-test 30`, { cwd: BACKEND_DIR }).toString().trim();
  const red = await post('/pair/redeem', { code });
  assert.equal(red.status, 200, 'pair code redeem');
  const { token } = await red.json();
  const H = { 'X-Chatbot-Token': token };

  // GROUNDING: mock provider last incoming ka echo karta hai - jo provider tak gaya wahi reply mein dikhta hai.
  r = await post('/reply', {
    character: { name: 'Meera', gender: 'girl' },
    messages: [
      { role: 'assistant', content: 'mera pehla message' },
      { role: 'user', content: 'AAKHRI-INCOMING-FACT-123' },
    ],
  }, H);
  assert.equal(r.status, 200);
  const d1 = await r.json();
  assert.ok(String(d1.reply).includes('AAKHRI-INCOMING-FACT-123'), 'provider tak last incoming hi pahuncha (grounding exact)');

  // LOOP PREVENTION: last message incoming (user) nahi to 400.
  r = await post('/reply', { character: {}, messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] }, H);
  assert.equal(r.status, 400, 'last=assistant par reply nahi');

  // FOLLOW-UP exception: last=assistant + followUp=true -> 200, aur system-note provider input mein.
  r = await post('/reply', { character: {}, messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }], followUp: true }, H);
  assert.equal(r.status, 200, 'followUp exception');
  const d2 = await r.json();
  assert.ok(String(d2.reply).includes('SYSTEM NOTE'), 'followUp system-note provider input tak pahuncha');
});
