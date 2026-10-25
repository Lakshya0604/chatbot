// e2e-telegram.cjs - MOCK Telegram page par poora dummy E2E (real Chromium,
// real extension, real backend mock-mode). Live Telegram ka proof NAHI.
// Run: backend (AI_MOCK=true, AUTH_TOKEN=tok123, port 8787) + mock page
// (python http.server 8788) chal rahe hon; phir: node e2e-telegram.cjs
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright-core');

const SRC = path.join(__dirname, '..', '..');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-ext-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync(path.join(__dirname, 'manifest.test.json'), path.join(BUILD, 'manifest.json'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { console.log('FAIL:', label); process.exit(1); } console.log('PASS:', label); };

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'cc-e2e-profile'), {
    headless: false, args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
  });
  let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
  ok(sw, 'service worker registered');
  const extHost = new URL(sw.url()).host;
  await sw.evaluate(() => new Promise((r) => {
    chrome.storage.sync.set({ character: { name: 'Meera', tone: 'funny' }, backendUrl: 'http://127.0.0.1:8787' }, () =>
      chrome.storage.local.set({ authToken: 'tok123' }, r));
  }));
  ok(true, 'settings seeded (character + backendUrl + local token)');

  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('http://127.0.0.1:8788/mock-telegram.html');
  await page.click('.chatlist-chat[href="#111"]');
  await page.waitForSelector('#cc-toggle-btn', { timeout: 10000 });
  ok(true, 'alpha open, toggle injected');

  // Consent flow: 2 clicks (dialogs auto-accepted)
  await page.click('#cc-toggle-btn'); await sleep(400);
  let composer = await page.evaluate(() => document.querySelector('.input-message-input').innerText);
  ok(/AI-drafted replies/.test(composer), 'consent-request draft composer mein aaya (owner khud bhejta hai)');
  await page.evaluate(() => { document.querySelector('.input-message-input').innerText = ''; });
  await page.click('#cc-toggle-btn'); await sleep(500);
  ok((await page.getAttribute('#cc-toggle-btn', 'data-enabled')) === 'true', 'alpha consent-active');

  // SUGGEST mode: incoming -> draft, no send
  await page.evaluate(() => window.__mock.receive('111', 'bhai kal movie chale?'));
  await sleep(4500);
  composer = await page.evaluate(() => document.querySelector('.input-message-input').innerText);
  ok(/\(mock reply\)/.test(composer), 'suggestion composer mein aayi (mock backend)');
  let outCount = await page.evaluate(() => document.querySelectorAll('.bubble.is-out').length);
  ok(outCount === 0, 'suggest mode mein kuch auto-send NAHI hua');
  await page.evaluate(() => { document.querySelector('.input-message-input').innerText = ''; });

  // AUTO mode: incoming -> send
  await page.click('#cc-auto-btn'); await sleep(400);
  ok((await page.getAttribute('#cc-auto-btn', 'data-mode')) === 'auto', 'alpha auto mode on');
  await page.evaluate(() => window.__mock.receive('111', 'kitne baje milna hai?'));
  await sleep(5000);
  const sentText = await page.evaluate(() => { const b = document.querySelectorAll('.bubble.is-out .message'); return b.length ? b[b.length - 1].innerText : ''; });
  ok(/\(mock reply\)/.test(sentText), 'AUTO: reply apne aap send hui: ' + JSON.stringify(sentText).slice(0, 80));
  composer = await page.evaluate(() => document.querySelector('.input-message-input').innerText.trim());
  ok(composer === '', 'send ke baad composer khaali');

  // Beta ko bhi consent-active karo (suggest mode), wapas alpha pe
  await page.click('.chatlist-chat[href="#222"]'); await sleep(600);
  await page.click('#cc-toggle-btn'); await sleep(400);
  await page.evaluate(() => { document.querySelector('.input-message-input').innerText = ''; });
  await page.click('#cc-toggle-btn'); await sleep(500);
  ok((await page.getAttribute('#cc-toggle-btn', 'data-enabled')) === 'true', 'beta consent-active');
  await page.click('.chatlist-chat[href="#111"]'); await sleep(600);

  // Non-open selected chat mein incoming -> auto-open -> suggestion
  await page.evaluate(() => window.__mock.receive('222', 'hello beta pe naya msg'));
  await sleep(6500); // watcher interval + batch
  const hash = await page.evaluate(() => location.hash);
  ok(hash === '#222', 'auto-open ne beta kholi (hash #222), hash=' + hash);
  composer = await page.evaluate(() => document.querySelector('.input-message-input').innerText);
  ok(/\(mock reply\)/.test(composer), 'beta (non-open se khuli) mein suggestion aayi');
  await page.evaluate(() => { document.querySelector('.input-message-input').innerText = ''; });

  // STOP gate: saamne wala stop kahe -> chat band, message AI ko nahi jaata
  await page.evaluate(() => window.__mock.receive('222', 'stop'));
  await sleep(3000);
  const toggleLabel = await page.evaluate(() => document.getElementById('cc-toggle-btn').textContent);
  ok(toggleLabel === 'Stopped', 'stop word par beta Stopped');
  const betaOut = await page.evaluate(() => window.__mock.chats['222'].msgs.filter((m) => m.out).length);
  ok(betaOut === 0, 'stop ke baad beta mein koi reply nahi gayi');

  // STOP ALL: alpha pe incoming -> kuch nahi
  await page.click('.chatlist-chat[href="#111"]'); await sleep(600);
  await page.click('#cc-stopall-btn'); await sleep(500);
  await page.evaluate(() => window.__mock.receive('111', 'stop all ke baad msg'));
  await sleep(4500);
  const alphaOutAfter = await page.evaluate(() => window.__mock.chats['111'].msgs.filter((m) => m.out).length);
  ok(alphaOutAfter === 1, 'stop all ke baad koi auto-reply nahi (pehle ki 1 hi hai)');

  await page.screenshot({ path: '/tmp/e2e-telegram-final.png', fullPage: true });
  console.log('E2E ALL PASS');
  await ctx.close();
})().catch((e) => { console.log('FAIL:', e.message.slice(0, 300)); process.exit(1); });
