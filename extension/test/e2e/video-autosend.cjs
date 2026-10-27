// FULL-CHAIN demo on a MOCK WhatsApp page (local, not real WhatsApp): real extension build v0.7.1,
// real content script + adapter, real service-worker relay, real Groq call. No relay bypass.
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require('playwright-core');
const SRC = path.resolve(__dirname, '../..');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-vid-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}`) && !s.includes('node_modules') });
const mf = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
mf.host_permissions.push('http://127.0.0.1:8788/*');
mf.content_scripts.forEach((c) => { if (c.matches.some((m) => m.includes('web.whatsapp.com'))) c.matches = ['http://127.0.0.1:8788/*']; });
fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(mf));
const KEY = fs.readFileSync(process.argv[2], 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COMP = '#main footer div[contenteditable="true"]';
const log = [];
const ok = (c, l) => { log.push((c ? 'PASS: ' : 'FAIL: ') + l); console.log(c ? 'PASS:' : 'FAIL:', l); if (!c) throw new Error('FAIL ' + l); };
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-vid-p-')), {
    headless: false, viewport: null,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--no-sandbox', '--window-size=1100,740', '--window-position=0,0'],
  });
  try {
    let sw; for (let i = 0; i < 40 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
    await sw.evaluate((k) => new Promise((r) => chrome.storage.sync.set({ character: { name: 'Meera', gender: 'female', tone: 'funny', replyLength: 'short' } }, () => chrome.storage.local.set({ aiConfig: { provider: 'groq', apiKey: k, model: '' } }, r))), KEY);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto('http://127.0.0.1:8788/mock-whatsapp.html');
    const cap = (t) => page.evaluate((t) => { let c = document.getElementById('demo-cap'); if (!c) { c = document.createElement('div'); c.id = 'demo-cap'; c.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#111;color:#fff;font:600 18px sans-serif;padding:12px 16px;border-top:3px solid #f5a623'; document.body.appendChild(c); } c.textContent = t; }, t);
    await page.waitForSelector('#cc-toggle-btn', { timeout: 15000 });
    await cap('MOCK chat page on localhost (NOT real WhatsApp). Real extension v0.7.1 + real AI call. Step 1: extension buttons appear');
    await sleep(3500);
    await cap('Step 2: AI on -> consent steps. The mock simulates the other person agreeing; in real use they must actually agree');
    await page.click('#cc-toggle-btn');
    await sleep(2500);
    ok(/AI-drafted replies/.test(await page.evaluate((s) => document.querySelector(s).innerText, COMP)), 'consent-request text placed in composer (not sent)');
    await page.evaluate((s) => { document.querySelector(s).innerText = ''; }, COMP);
    await page.click('#cc-toggle-btn'); await sleep(1500);
    ok((await page.getAttribute('#cc-toggle-btn', 'data-enabled')) === 'true', 'chat is consent-active');
    await cap('Step 3: SUGGEST mode. New incoming message -> AI draft in composer, nothing is sent');
    await page.evaluate(() => window.mockIncoming('bhai kal movie chale?'));
    let comp = ''; for (let i = 0; i < 40 && !comp.trim(); i++) { await sleep(1000); comp = await page.evaluate((s) => document.querySelector(s).innerText, COMP); }
    ok(comp.trim().length > 3, 'real AI draft appeared via real service-worker relay: len ' + comp.trim().length);
    ok((await page.evaluate(() => window.sentLog.length)) === 0, 'nothing sent in suggest mode');
    await sleep(3500);
    await page.evaluate((s) => { document.querySelector(s).innerText = ''; }, COMP);
    await cap('Step 4: Auto: on. New incoming -> AI reply is sent by itself (composer empty, last-moment checks)');
    await page.click('#cc-auto-btn'); await sleep(1500);
    await page.evaluate(() => window.mockIncoming('kitne baje milna hai?'));
    let sent = ''; for (let i = 0; i < 45 && !sent; i++) { await sleep(1000); sent = await page.evaluate(() => window.sentLog.length ? window.sentLog[window.sentLog.length - 1] : ''); }
    ok(sent.length > 3, 'AUTO-SEND happened (mock send button clicked by extension): ' + JSON.stringify(sent).slice(0, 60));
    await sleep(4000);
    await cap('Step 5: other person says "ruk jao" -> chat stops permanently, no more replies');
    const before = await page.evaluate(() => window.sentLog.length);
    await page.evaluate(() => window.mockIncoming('ruk jao yaar, stop'));
    await sleep(9000);
    ok((await page.evaluate(() => window.sentLog.length)) === before, 'no reply after stop phrase');
    await cap('Step 6: Stop all / consent off = nothing more is sent. Test complete');
    await sleep(4000);
    await page.screenshot({ path: '/downloads/autosend-final.png' });
    ok(errs.length === 0, 'no page errors ' + errs.join('|').slice(0, 100));
    console.log('FULL-CHAIN MOCK AUTO-SEND ALL PASS');
  } finally {
    try { await ctx.pages()[ctx.pages().length - 1].evaluate(() => { const b = document.getElementById('cc-stopall-btn'); if (b && !/resume/i.test(b.textContent)) b.click(); }); } catch (e) {}
    await sleep(500);
    try { await sw.evaluate(() => new Promise((r) => chrome.storage.local.remove('aiConfig', r))); } catch (e) {}
    await ctx.close();
  }
})().catch((e) => { console.log('ERR', String(e.message).slice(0, 200)); process.exit(1); });
