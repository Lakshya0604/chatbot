// Own-key E2E: real Chromium + real extension (test build adds 127.0.0.1 host perm only).
// Mock OpenAI-compatible provider on localhost. No real keys, no real messages.
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { chromium } = require('playwright-core');
const SRC = path.resolve(__dirname, '../..');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-byok-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}`) && !s.includes('node_modules') });
const mf = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
mf.host_permissions.push('http://127.0.0.1/*'); // TEST ONLY: real custom flow asks chrome.permissions.request
fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(mf));
const KEY = 'test-key-AAAA1111BBBB2222';
const reqs = [];
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => b += d); req.on('end', () => {
    reqs.push({ url: req.url, auth: req.headers.authorization, body: b });
    if (req.headers.authorization !== 'Bearer ' + KEY) { res.writeHead(401); return res.end('invalid key ' + (req.headers.authorization || '')); }
    const j = JSON.parse(b);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '(own-key reply) ' + j.messages[j.messages.length - 1].content }, finish_reason: 'stop' }] }));
  });
});
const ok = (c, l) => { if (!c) throw new Error('FAIL: ' + l); console.log('PASS:', l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-byok-p-')), {
    headless: false, args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--no-sandbox'], viewport: { width: 900, height: 1100 },
  });
  try {
    let sw; for (let i = 0; i < 40 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
    ok(sw, 'service worker up (importScripts lib/ai.js ok)');
    const id = sw.url().split('/')[2];
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`chrome-extension://${id}/options/options.html`);
    ok(await page.isVisible('#aiKey'), 'own-key card visible');
    ok((await page.getAttribute('#aiKey', 'type')) === 'password', 'key field masked');

    // wrong key first -> rejected, nothing saved, key not echoed
    await page.selectOption('#aiProvider', 'custom');
    await page.fill('#aiBaseUrl', base); await page.fill('#aiModel', 'mock-model'); await page.fill('#aiKey', 'WRONGKEY-ZZZ999');
    await page.click('#aiSaveBtn');
    await page.waitForFunction(() => /Save nahi hua|Connected/.test(document.getElementById('aiStatus').textContent), null, { timeout: 20000 });
    let status = await page.textContent('#aiStatus');
    ok(/Save nahi hua/.test(status) && /401/.test(status), 'wrong key rejected: ' + status.slice(0, 80));
    ok(!status.includes('WRONGKEY-ZZZ999'), 'wrong key not echoed in status');
    ok(!(await sw.evaluate(() => new Promise((r) => chrome.storage.local.get('aiConfig', (x) => r(!!x.aiConfig))))), 'wrong key NOT stored');

    // right key
    await page.fill('#aiKey', KEY);
    await page.click('#aiSaveBtn');
    await page.waitForFunction(() => /Save nahi hua|Connected/.test(document.getElementById('aiStatus').textContent), null, { timeout: 20000 });
    status = await page.textContent('#aiStatus');
    ok(/Connected/.test(status), 'right key: ' + status.slice(0, 70));
    ok((await page.inputValue('#aiKey')) === '', 'key field cleared after save');
    const store = await sw.evaluate(() => new Promise((r) => chrome.storage.local.get(null, (l) => chrome.storage.sync.get(null, (s) => r({ l: JSON.stringify(l), s: JSON.stringify(s) })))));
    ok(store.l.includes(KEY), 'key stored in local storage (device only)');
    ok(!store.s.includes(KEY), 'key NOT in sync storage');

    // full bridge reply (what engine calls) + preview button
    const rep = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GENERATE_REPLY', payload: { character: { name: 'Meera', gender: 'female' }, messages: [{ role: 'user', content: 'kal movie chalein?' }] } }));
    ok(rep.ok && /own-key reply\) kal movie chalein\?/.test(rep.data.reply), 'bridge reply via own key: ' + JSON.stringify(rep).slice(0, 90));
    await page.fill('#previewInput', 'preview msg'); await page.click('#preview');
    await page.waitForFunction(() => /AI:/.test(document.getElementById('previewOut').textContent), null, { timeout: 15000 });
    ok(true, 'options preview works through same path');
    // wire check: every request went to the mock provider with the bearer key, system prompt present
    ok(reqs.every((r) => r.url === '/v1/chat/completions'), 'only provider endpoint was called');
    ok(JSON.parse(reqs[reqs.length - 1].body).messages[0].role === 'system', 'system prompt sent');
    // follow-up rule and incoming rule
    const bad = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GENERATE_REPLY', payload: { character: {}, messages: [{ role: 'assistant', content: 'x' }] } }));
    ok(!bad.ok && /last message/.test(bad.error), 'last-message-must-be-incoming rule kept');
    await page.screenshot({ path: '/downloads/byok-options.png', fullPage: false });

    // clear key -> falls back to backend path (no token -> not own key)
    await page.click('#aiClearBtn'); await sleep(300);
    ok(!(await sw.evaluate(() => new Promise((r) => chrome.storage.local.get('aiConfig', (x) => r(!!x.aiConfig))))), 'key removed');
    const n = reqs.length;
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GENERATE_REPLY', payload: { backendUrl: 'http://127.0.0.1:9', character: {}, messages: [{ role: 'user', content: 'x' }] } }));
    ok(reqs.length === n, 'after clear, provider no longer called');
    ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
    console.log('E2E-BYOK ALL PASS');
  } finally { await ctx.close(); srv.close(); }
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
