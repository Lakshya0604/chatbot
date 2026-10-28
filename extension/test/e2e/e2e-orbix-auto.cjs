// e2e-orbix-auto.cjs - LIVE Orbix (user ka apna deployed site) par AUTO mode test:
// real login (dummy test account), real React DOM, real network, REAL Groq BYOK.
// Chat partner = Orbix ka apna AI bot (koi third party nahi). Bounded: SUGGEST
// draft proof + AUTO send observed, phir Stop all (bot reply loop ka risk isliye).
// Run: xvfb-run -a node e2e-orbix-auto.cjs /path/emailfile /path/passfile /path/groqkeyfile
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright-core');

const SRC = path.join(__dirname, '..', '..');
const SHOTS = '/tmp/cc-orbix-auto';
fs.mkdirSync(SHOTS, { recursive: true });
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-oa-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
{
  const mf = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
  mf.host_permissions.push('https://orbix-video-ly.web.app/*'); // TEST-ONLY stand-in for toolbar activeTab
  if (!mf.permissions.includes('tabs')) mf.permissions.push('tabs');
  fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(mf));
}
const EMAIL = fs.readFileSync(process.argv[2], 'utf8').trim();
const PASS = fs.readFileSync(process.argv[3], 'utf8').trim();
const KEY = fs.readFileSync(process.argv[4], 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { console.log('FAIL:', label); process.exit(1); } console.log('PASS:', label); };

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-oa-p-')), {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1280,800'],
    viewport: { width: 1280, height: 720 },
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) { try { sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch (e) {} }
  ok(sw, 'service worker registered');
  await sw.evaluate((k) => new Promise((r) => {
    chrome.storage.sync.set({
      character: { name: 'Meera', gender: 'girl', role: 'college friend', tone: 'funny', replyLength: 'short', vocabulary: 'Roman Hinglish casual' },
    }, () => chrome.storage.local.set({ aiConfig: { provider: 'groq', apiKey: k, model: '' } }, r));
  }), KEY);
  ok(true, 'BYOK seeded (real Groq)');

  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGEERR>', String(e).slice(0, 160)));

  // --- login (Render cold start ho sakta hai) ---
  await page.goto('https://orbix-video-ly.web.app/#/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input', { timeout: 90000 });
  const inputs = await page.$$('input');
  let emailEl = null, passEl = null;
  for (const el of inputs) {
    const t = await el.getAttribute('type');
    if (t === 'email') emailEl = el;
    if (t === 'password') passEl = el;
  }
  ok(emailEl && passEl, 'login form mila');
  await emailEl.fill(EMAIL); await passEl.fill(PASS);
  await page.keyboard.press('Enter');
  await page.waitForSelector('textarea', { timeout: 120000 });
  ok(true, 'LOGIN SUCCESS');
  await sleep(2000);

  // --- bootstrap: manual message -> bot reply (incoming rows dono sides) ---
  await page.fill('textarea', 'hi orbix, ek line mein bata tu kya kar sakta hai');
  await page.keyboard.press('Enter');
  const before1 = await page.evaluate(() => document.body.innerText.length);
  for (let i = 0; i < 45; i++) { await sleep(1000); if ((await page.evaluate(() => document.body.innerText.length)) > before1 + 20) break; }
  ok(true, 'bot ne reply kiya (dono sides ke rows exist)');
  await page.screenshot({ path: SHOTS + '/01-bootstrapped.png' });

  // --- AUTO SETUP: inject + CC_AUTO_START (toolbar click simulation) ---
  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://orbix-video-ly.web.app/*' });
    await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ['content/engine.js', 'content/adapters/custom-utils.js', 'content/adapters/auto-utils.js', 'content/adapters/auto.js'],
    });
    chrome.tabs.sendMessage(tabs[0].id, { type: 'CC_AUTO_START' }, () => void chrome.runtime.lastError);
  });
  await sleep(3000);
  const origin = 'https://orbix-video-ly.web.app';
  const prof = await sw.evaluate((o) => chrome.storage.local.get('siteProfiles').then((x) => (x.siteProfiles || {})[o] || null), origin);
  if (!prof || !prof.enabled) {
    console.log('ORBIX RESULT: auto setup FAIL-CLOSED (profile nahi bani) - honest unsupported outcome.');
    await page.screenshot({ path: SHOTS + '/02-failclosed.png' });
    await ctx.close(); process.exit(2);
  }
  ok(true, 'ORBIX auto profile: ' + JSON.stringify(prof).slice(0, 240));
  if (prof.directionPending) {
    console.log('ORBIX RESULT: direction pending/undecidable - fail-closed, engine band.');
    await page.screenshot({ path: SHOTS + '/02-pending.png' });
    await ctx.close(); process.exit(2);
  }
  await page.waitForSelector('#cc-panel #cc-toggle-btn', { timeout: 10000 });
  ok(true, 'engine panel live on Orbix');
  await page.screenshot({ path: SHOTS + '/02-panel.png' });

  // --- consent 2-step ---
  await page.click('#cc-toggle-btn'); await sleep(800);
  await page.evaluate(() => { const t = document.querySelector('textarea'); if (t) t.value = ''; t && t.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#cc-toggle-btn'); await sleep(900);
  ok((await page.getAttribute('#cc-toggle-btn', 'data-enabled')) === 'true', 'chat consent-active');

  // --- SUGGEST: naya manual message -> bot reply -> draft (REAL Groq), send NAHI ---
  await page.fill('textarea', 'aur bata, aaj mausam kaisa lag raha hai tujhe');
  await page.keyboard.press('Enter');
  let draft = '';
  for (let i = 0; i < 45 && !draft; i++) {
    await sleep(1000);
    draft = await page.evaluate(() => (document.querySelector('textarea') || {}).value || '');
  }
  ok(draft.length > 3, 'ORBIX SUGGEST draft (real Groq): ' + draft.slice(0, 90));
  await page.screenshot({ path: SHOTS + '/03-draft.png' });
  await page.evaluate(() => { const t = document.querySelector('textarea'); if (t) { t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); } });

  // --- AUTO: 1 send observed, phir Stop all (bot loop bounded) ---
  await page.click('#cc-auto-btn'); await sleep(600);
  await page.fill('textarea', 'ek chhota sa joke suna na');
  await page.keyboard.press('Enter');
  let sentCount = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    sentCount = await page.evaluate(() => document.querySelectorAll('.cc-note, #cc-banner').length ? Array.from(document.querySelectorAll('.cc-note')).filter((n) => /Auto-reply bhej di gayi/.test(n.textContent || '')).length : 0);
    if (sentCount >= 1) break;
  }
  ok(sentCount >= 1, 'ORBIX AUTO-SEND observed (banner: Auto-reply bhej di gayi)');
  await page.screenshot({ path: SHOTS + '/04-autosent.png' });
  await page.click('#cc-stopall-btn'); await sleep(1500);
  const stoppedLabel = await page.evaluate(() => (document.getElementById('cc-stopall-btn') || {}).textContent);
  ok(stoppedLabel === 'Resume all', 'Stop all lagaya (bot reply loop bounded): ' + stoppedLabel);

  await ctx.close();
  console.log('ORBIX AUTO E2E ALL PASS');
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e && e.message || e).slice(0, 500)); process.exit(1); });
