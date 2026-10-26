// e2e-whatsapp.cjs - MOCK WhatsApp page par dummy E2E (real Chromium, real
// extension+adapter, backend AI_MOCK). Live WhatsApp ka proof NAHI.
// Run: backend (AI_MOCK=true AUTH_TOKEN=tok123 PORT=8787) + mock page
// (http.server 8788) chal rahe hon. Runner hamesha explicit STOP karta hai.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright-core');

const SRC = path.join(__dirname, '..', '..');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-wa-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync(path.join(__dirname, 'manifest.test-whatsapp.json'), path.join(BUILD, 'manifest.json'));
// E2E-ONLY BUILD PATCH (dbg11 se documented): is Playwright env mein MV3
// service worker ka async sendResponse hang hota hai (env issue, production
// code ka nahi - production abhi bhi background relay use karta hai, aur SW
// relay alag se health-probe se verify hota hai). Dummy http origin par
// host_permissions hain, isliye BUILD copy mein content script seedha fetch
// karti hai (Origin: chrome-extension:// -> backend allow).
{
  let eng = fs.readFileSync(path.join(BUILD, 'content', 'engine.js'), 'utf8');
  const target = `        const response = await chrome.runtime.sendMessage({
          type: 'GENERATE_REPLY',
          payload: { character, messages, backendUrl, followUp: !!(opts && opts.followUp) },
        });`;
  const repl = `        const response = await fetch((backendUrl || 'http://127.0.0.1:8787') + '/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Chatbot-Token': 'tok123' },
          body: JSON.stringify({ character, messages, followUp: !!(opts && opts.followUp) }),
        }).then(async (res) => ({ ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) }))
          .catch((err) => ({ ok: false, error: String(err) }));`;
  if (!eng.includes(target)) { throw new Error('engine relay patch target not found'); }
  eng = eng.replace(target, repl);
  fs.writeFileSync(path.join(BUILD, 'content', 'engine.js'), eng);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { throw new Error('FAIL: ' + label); } console.log('PASS:', label); };
const WA_COMPOSER = '#main footer div[contenteditable="true"]';

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'cc-e2e-wa-profile'), {
    headless: false, args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
  });
  let page;
  try {
    let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
    ok(sw, 'service worker registered');
    await sw.evaluate(() => new Promise((r) => {
      chrome.storage.sync.set({ character: { name: 'Meera', tone: 'funny' }, backendUrl: 'http://127.0.0.1:8788' }, () =>
        chrome.storage.local.set({ authToken: 'tok123' }, r));
    }));
    ok(true, 'settings seeded');

    page = await ctx.newPage();
    page.on('console', (m) => { if (m.text().includes('CCDBG')) console.log(m.text()); });
    page.on('pageerror', (e) => console.log('PGERR>', String(e).slice(0,150)));
    page.on('dialog', (d) => d.accept());
    await page.goto('http://127.0.0.1:8788/mock-whatsapp.html');
    await page.waitForSelector('#cc-toggle-btn', { timeout: 15000 });
    ok(true, 'open mock chat par toggle inject hua (header)');

    // Consent 2-step
    await page.click('#cc-toggle-btn');
    let composer = '';
    for (let i = 0; i < 8 && !composer; i++) { await sleep(700); composer = await page.evaluate((s) => document.querySelector(s).innerText, WA_COMPOSER); }
    ok(/AI-drafted replies/.test(composer), 'consent-request draft composer mein (owner khud bhejta hai)');
    await page.evaluate((s) => { document.querySelector(s).innerText = ''; }, WA_COMPOSER);
    await page.click('#cc-toggle-btn'); await sleep(600);
    ok((await page.getAttribute('#cc-toggle-btn', 'data-enabled')) === 'true', 'chat consent-active');

    // SUGGEST: incoming -> draft, send NAHI
    await page.evaluate(() => window.mockIncoming('bhai kal movie chale?'));
    composer = '';
    for (let i = 0; i < 14 && !/\(mock reply\)/.test(composer); i++) { await sleep(1000); composer = await page.evaluate((s) => document.querySelector(s).innerText, WA_COMPOSER); }
    const __banner = await page.evaluate(() => ((document.getElementById('cc-banner')||{}).innerText||'').slice(0,120));
    ok(/\(mock reply\)/.test(composer), 'SUGGEST: draft composer mein aayi | banner=' + JSON.stringify(__banner) + ' comp=' + JSON.stringify(composer.slice(0,60)));
    let sent = await page.evaluate(() => window.sentLog.length);
    ok(sent === 0, 'SUGGEST: kuch auto-send NAHI hua');
    await page.evaluate((s) => { document.querySelector(s).innerText = ''; }, WA_COMPOSER);

    // AUTO: incoming -> auto-send (pacing 2-10s)
    await page.click('#cc-auto-btn'); await sleep(400);
    ok((await page.getAttribute('#cc-auto-btn', 'data-mode')) === 'auto', 'AUTO mode on');
    await page.evaluate(() => window.mockIncoming('kitne baje milna hai?'));
    let sentText = '';
    for (let i = 0; i < 16 && !sentText; i++) {
      await sleep(1000);
      sentText = await page.evaluate(() => window.sentLog.length ? window.sentLog[window.sentLog.length - 1] : '');
    }
    ok(/\(mock reply\)/.test(sentText), 'AUTO: reply apne aap send hui: ' + JSON.stringify(sentText).slice(0, 70));
    const outRows = await page.evaluate(() => document.querySelectorAll('#main div.message-out').length);
    ok(outRows === 2, 'sent message thread mein message-out row bani (seed 1 + auto 1)');
    composer = await page.evaluate((s) => document.querySelector(s).innerText.trim(), WA_COMPOSER);
    ok(composer === '', 'send ke baad composer khaali');

    // STOP ALL: incoming -> kuch nahi
    await page.click('#cc-stopall-btn'); await sleep(500);
    await page.evaluate(() => window.mockIncoming('stop all ke baad msg'));
    await sleep(5000);
    const sentAfter = await page.evaluate(() => window.sentLog.length);
    ok(sentAfter === 1, 'STOP ALL ke baad koi send nahi (1 hi thi)');

    await page.screenshot({ path: '/tmp/cc-wa-mock-final.png', fullPage: true });
    console.log('E2E-WHATSAPP-MOCK ALL PASS');
  } finally {
    // explicit STOP (idempotent) - koi bhi fail ho, engine ruke
    try {
      if (page) {
        const btn = await page.$('#cc-stopall-btn');
        if (btn && !/resume/i.test(await btn.innerText())) { await btn.click(); await sleep(400); }
        console.log('EXPLICIT STOP done');
      }
    } catch (e) { console.log('STOP attempt err (non-fatal):', e.message); }
    await ctx.close();
  }
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
