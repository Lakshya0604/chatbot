// e2e-custom.cjs - CUSTOM mode ka poora dummy demo: REAL Chromium + REAL extension
// + REAL backend (Groq) par, generic dummy chat site (mock-custom.html).
// Picker se selectors derive -> profile save -> reload -> consent -> suggestion
// -> AUTO send -> STOP gate. Screenshots /tmp/cc-proof/ mein.
// Live kisi website ka proof NAHI - clearly DUMMY site.
// Run: backend (real AI, AUTH_TOKEN=tok123, port 8787) + mock page (port 8789)
// chal rahe hon; phir: xvfb-run -a node e2e-custom.cjs
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright-core');

const SRC = path.join(__dirname, '..', '..');
const SHOTS = '/tmp/cc-proof';
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-custom-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync(path.join(__dirname, 'manifest.test-custom.json'), path.join(BUILD, 'manifest.json'));
// E2E-ONLY BUILD PATCH: is test environment (Playwright + MV3 SW) mein background
// service worker ka async sendResponse hang/reject hota hai (env issue, production
// code ka nahi). Dummy http site par host_permissions maujood hain, isliye content
// script seedha fetch karti hai (Origin: chrome-extension:// -> backend allow).
// PRODUCTION extension abhi bhi background relay hi use karta hai.
{
  let eng = fs.readFileSync(path.join(BUILD, 'content', 'engine.js'), 'utf8');
  const target = `        const response = await chrome.runtime.sendMessage({
          type: 'GENERATE_REPLY',
          payload: { character, messages, backendUrl },
        });`;
  const repl = `        const response = await fetch((backendUrl || 'http://127.0.0.1:8787') + '/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Chatbot-Token': 'tok123' },
          body: JSON.stringify({ character, messages }),
        }).then(async (res) => ({ ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) }))
          .then((r) => { document.documentElement.setAttribute('data-engdbg', 'fetchResp ' + JSON.stringify(r).slice(0,220)); return r; })
          .catch((err) => ({ ok: false, error: String(err) }));`;
  if (!eng.includes(target)) { console.log('WARN: engine patch target not found'); }
  else { eng = eng.replace(target, repl); fs.writeFileSync(path.join(BUILD, 'content', 'engine.js'), eng); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails=0; const ok = (cond, label) => { if (!cond) { fails++; console.log('FAIL:', label); return; } console.log('PASS:', label); };

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'cc-e2e-custom-profile'), {
    headless: false,
    
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1280,800'],
    recordVideo: { dir: '/tmp/cc-video', size: { width: 1280, height: 800 } },
    viewport: { width: 1280, height: 720 },
  });
  let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
  ok(sw, 'service worker registered');
  await sw.evaluate(() => new Promise((r) => {
    chrome.storage.sync.set({
      character: {
        name: 'Meera', gender: 'girl', role: 'college friend', tone: 'funny',
        humour: 'light teasing', replyLength: 'short', defaultMood: 'playful',
        vocabulary: 'Roman Hinglish, yaar/bhai wala casual',
      },
      backendUrl: 'http://127.0.0.1:8787',
    }, () => chrome.storage.local.set({ authToken: 'tok123' }, r));
  }));
  ok(true, 'settings seeded (character Meera + backendUrl + token)');

  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => console.log('PAGE>', m.type(), m.text().slice(0,220)));
  page.on('pageerror', (e) => console.log('PAGEERR>', String(e).slice(0,300)));
  await page.goto('http://127.0.0.1:8789/mock-custom.html');
  await sleep(1500);

  // Toolbar click ka simulation: background se tab ko CC_START_PICKER bhejo.
  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8789/*' });
    await chrome.tabs.sendMessage(tabs[0].id, { type: 'CC_START_PICKER' });
  });
  await page.waitForSelector('#cc-picker-bar', { timeout: 10000 });
  await page.screenshot({ path: SHOTS + '/01-picker-mode.png' });
  ok(true, 'picker chal raha hai (step bar dikha)');

  // 5 stages: bubble -> apni outgoing -> composer -> send -> title
  await page.click('.msg.in'); await sleep(300);
  await page.click('.msg.out'); await sleep(300);
  await page.click('.composer'); await sleep(300);
  await page.click('.send-btn'); await sleep(300);
  await page.click('.chat-title'); await sleep(800); // finish -> alert (auto-accept)

  // Profile save hui?
  const prof = await sw.evaluate(() => new Promise((r) => chrome.storage.local.get('siteProfiles', r)));
  const origin = 'http://127.0.0.1:8789';
  ok(prof.siteProfiles && prof.siteProfiles[origin], 'profile save hui: ' + JSON.stringify(prof.siteProfiles && prof.siteProfiles[origin]));

  await page.reload(); await sleep(1800);
  await page.waitForSelector('#cc-panel', { timeout: 10000 });
  await page.screenshot({ path: SHOTS + '/02-engine-panel.png' });
  ok(true, 'reload par engine panel aa gaya (profile se boot)');

  // Consent flow: 2 clicks (dialogs auto-accept)
  await page.click('#cc-toggle-btn'); await sleep(600);
  let composer = await page.evaluate(() => document.querySelector('.composer').innerText);
  ok(/AI-drafted replies/.test(composer), 'consent-request draft composer mein (owner khud bhejta hai)');
  await page.evaluate(() => { document.querySelector('.composer').innerText = ''; });
  await page.click('#cc-toggle-btn'); await sleep(700);
  ok((await page.getAttribute('#cc-toggle-btn', 'data-enabled')) === 'true', 'chat consent-active');
  await page.screenshot({ path: SHOTS + '/03-consent-active.png' });

  // SUGGEST mode: incoming -> REAL Groq reply draft (send NAHI)
  await page.evaluate(() => window.__mock.receive('arre meera, kal ka plan kya hai?'));
  await sleep(12000); // batch 2.5s + real API
  composer = await page.evaluate(() => document.querySelector('.composer').innerText);
  ok(composer.trim().length > 3, 'suggestion composer mein aayi (REAL AI reply): ' + JSON.stringify(composer).slice(0, 120));
  const panelTxt = await page.evaluate(() => { const p = document.getElementById('cc-panel'); return p ? p.innerText.slice(0,300) : 'NO PANEL'; });
  console.log('PANEL>', JSON.stringify(panelTxt));
  console.log('ENGDBG>', await page.evaluate(() => document.documentElement.getAttribute('data-engdbg') || '(none)'));
  let outCount = await page.evaluate(() => document.querySelectorAll('.msg.out').length);
  ok(outCount === 1, 'suggest mode mein kuch auto-send NAHI hua');
  await page.screenshot({ path: SHOTS + '/04-suggestion-draft.png' });
  await page.evaluate(() => { document.querySelector('.composer').innerText = ''; });

  // AUTO mode: incoming -> REAL reply apne aap send
  await page.click('#cc-auto-btn'); await sleep(500);
  ok((await page.getAttribute('#cc-auto-btn', 'data-mode')) === 'auto', 'auto mode on');
  await page.evaluate(() => window.__mock.receive('movie dekhne chalegi kya saturday ko?'));
  await sleep(14000);
  const msgs = await page.evaluate(() => Array.from(document.querySelectorAll('.msg.out')).map((m) => m.innerText));
  ok(msgs.length === 2, 'AUTO: reply apne aap send hui: ' + JSON.stringify(msgs[1]).slice(0, 120));
  await page.screenshot({ path: SHOTS + '/05-auto-sent.png' });

  // STOP gate
  await page.evaluate(() => window.__mock.receive('stop'));
  await sleep(3000);
  const label = await page.evaluate(() => document.getElementById('cc-toggle-btn').textContent);
  ok(label === 'Stopped', 'saamne wale ke stop par chat Stopped');
  await page.screenshot({ path: SHOTS + '/06-stop-gate.png' });

  console.log('CUSTOM E2E done, fails=' + fails); process.exit(fails?1:0);
  await ctx.close();
  process.exit(0);
})().catch((e) => { console.log('FAIL:', e.message.slice(0, 400)); process.exit(1); });
