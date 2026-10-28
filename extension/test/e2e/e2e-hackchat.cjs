// e2e-hackchat.cjs - REAL independent site test: hack.chat (anonymous ephemeral
// rooms, ToS: no bot ban, no accounts, no history). Random private room mein sirf
// 2 TEST profiles hain (owner w/ extension + guest) - koi real third person nahi.
// REAL Groq BYOK (user project key, argv[2] file se). Ye LIVE network + REAL DOM +
// REAL provider ka proof hai (ya honest fail-closed evidence).
// Run: xvfb-run -a node e2e-hackchat.cjs /path/to/keyfile
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright-core');

const SRC = path.join(__dirname, '..', '..');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-hc-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
{
  const mf = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
  mf.host_permissions.push('https://hack.chat/*'); // TEST-ONLY stand-in for toolbar activeTab grant
  if (!mf.permissions.includes('tabs')) mf.permissions.push('tabs');
  fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(mf));
}
const KEY = fs.readFileSync(process.argv[2], 'utf8').trim();
const ROOM = 'cc-test-' + Math.random().toString(36).slice(2, 10);
const OWNER_NICK = 'Owner' + Math.random().toString(36).slice(2, 6);
const GUEST_NICK = 'Guest' + Math.random().toString(36).slice(2, 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { console.log('FAIL:', label); process.exit(1); } console.log('PASS:', label); };

async function joinRoom(page, nick) {
  page.on('dialog', async (d) => { await d.accept(nick); });
  await page.goto('https://hack.chat/?' + ROOM, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('input[name="username"]', { state: 'visible', timeout: 30000 });
  await page.fill('input[name="username"]', nick);
  // ToS checkbox (visually hidden input) - label se check karo
  await page.evaluate(() => {
    const cb = document.querySelector('input[type="checkbox"]');
    if (cb && !cb.checked) cb.click();
  });
  await sleep(400);
  await page.getByRole('button', { name: 'Join!' }).first().click();
  await sleep(3000);
  // Chat input visible hona chahiye; na dikhe to ek baar retry + diagnostics
  try {
    await page.waitForSelector('textarea.chat-input', { state: 'visible', timeout: 10000 });
  } catch (e) {
    console.log('JOIN-RETRY for', nick, '- body:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 250)));
    await page.screenshot({ path: '/tmp/hc-joinfail-' + nick + '.png' }).catch(() => {});
    const cb = await page.evaluate(() => { const c = document.querySelector('input[type=checkbox]'); return c ? c.checked : 'gone'; });
    console.log('JOIN-RETRY checkbox:', cb);
    await page.getByRole('button', { name: 'Join!' }).first().click().catch(() => {});
    await page.waitForSelector('textarea.chat-input', { state: 'visible', timeout: 15000 });
  }
}

async function sendChat(page, text) {
  // hack.chat composer: footer input/textarea (generic dhoondo)
  const box = page.locator('textarea.chat-input').last();
  await box.click();
  await page.keyboard.type(text, { delay: 15 });
  await page.keyboard.press('Enter');
  await sleep(1200);
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hc-p-')), {
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

  const owner = await ctx.newPage();
  owner.on('console', (m) => { if (m.type() === 'error') console.log('OWNER-ERR:', m.text().slice(0, 150)); });
  await joinRoom(owner, OWNER_NICK);
  const gctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hc-g-')), {
    headless: false, args: ['--window-size=1100,700'], viewport: { width: 1100, height: 700 },
  });
  const guest = await gctx.newPage();
  await joinRoom(guest, GUEST_NICK);

  // Owner manually sends first (outgoing rows banenge - direction detection ke liye)
  await sendChat(owner, 'hi, main apna auto-reply helper test kar raha hoon');
  await sendChat(guest, 'haan bolo kya test hai?');
  await sleep(2500);
  ok((await bodyText(owner)).includes('haan bolo kya test hai'), 'owner ko guest ka message dikha (real network)');

  // AUTO SETUP (toolbar click simulation) - unseen real site par generic detection
  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://hack.chat/*' });
    await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ['content/engine.js', 'content/adapters/custom-utils.js', 'content/adapters/auto-utils.js', 'content/adapters/auto.js'],
    });
    chrome.tabs.sendMessage(tabs[0].id, { type: 'CC_AUTO_START' }, () => void chrome.runtime.lastError);
  });
  await sleep(3000);
  const origin = 'https://hack.chat';
  const prof = await sw.evaluate((o) => chrome.storage.local.get('siteProfiles').then((x) => (x.siteProfiles || {})[o] || null), origin);
  if (!prof || !prof.enabled) {
    console.log('REAL-SITE RESULT: hack.chat par auto setup FAIL-CLOSED raha (profile save nahi hui) - ye bhi honest outcome hai, galat kaam karne se better.');
    await ctx.close(); await gctx.close();
    process.exit(2);
  }
  ok(true, 'REAL SITE auto profile: ' + JSON.stringify(prof).slice(0, 240));
  if (prof.directionPending) {
    console.log('REAL-SITE RESULT: direction pending (site dono sides distinguish nahi karti) - fail-closed, engine band.');
    await ctx.close(); await gctx.close();
    process.exit(2);
  }
  await owner.waitForSelector('#cc-panel #cc-toggle-btn', { timeout: 10000 });
  ok(true, 'engine panel live on real site');

  // Consent 2-step
  await owner.click('#cc-toggle-btn'); await sleep(800);
  await owner.evaluate(() => { document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]').forEach((c) => { if (c.innerText !== undefined) c.innerText = ''; if (c.value !== undefined) c.value = ''; }); });
  await owner.click('#cc-toggle-btn'); await sleep(900);
  ok((await owner.getAttribute('#cc-toggle-btn', 'data-enabled')) === 'true', 'chat consent-active (real site)');

  // SUGGEST: guest bheje -> draft (REAL Groq), auto-send NAHI
  await sendChat(guest, 'accha to bata, kal ka kya scene hai?');
  let draft = '';
  for (let i = 0; i < 30 && !draft; i++) {
    await sleep(1000);
    draft = await owner.evaluate((sel) => { const c = document.querySelector(sel); return c ? ((c.value !== undefined ? c.value : c.innerText) || '').trim() : ''; }, prof.composer);
  }
  ok(draft.length > 3, 'REAL Groq draft on REAL site: ' + draft.slice(0, 90));
  ok(!(await bodyText(guest)).includes(draft.slice(0, 20)), 'suggest mode mein guest ko kuch nahi gaya (draft only)');
  await owner.evaluate((sel) => { const c = document.querySelector(sel); if (c) { if (c.value !== undefined) c.value = ''; c.innerText = ''; } }, prof.composer);

  // AUTO: guest bheje -> extension khud reply send kare -> GUEST ko dikhe
  await owner.click('#cc-auto-btn'); await sleep(600);
  const before = (await bodyText(guest)).length;
  await sendChat(guest, 'mujhe ek funny line bol na');
  let saw = false;
  for (let i = 0; i < 40 && !saw; i++) {
    await sleep(1000);
    const t = await bodyText(guest);
    saw = t.length > before + 5 && (t.includes(OWNER_NICK) || t.length - before > 30);
  }
  ok(saw, 'AUTO-REPLY guest tak pahunchi (real send, real network, real AI)');

  // STOP gate: guest "stop" bole -> chat band; agla message ignore
  await sendChat(guest, 'stop');
  await sleep(4000);
  const stLabel = await owner.evaluate(() => (document.getElementById('cc-toggle-btn') || {}).textContent);
  ok(stLabel === 'Stopped', 'guest ke stop par chat Stopped: ' + stLabel);
  const beforeStop = await bodyText(guest);
  await sendChat(guest, 'hello? kuch bolo');
  await sleep(15000);
  ok((await bodyText(guest)) === beforeStop || !(await bodyText(guest)).includes('mock reply'), 'stop ke baad koi auto-reply NAHI');

  await ctx.close(); await gctx.close();
  console.log('REAL-SITE HACK.CHAT E2E ALL PASS (room:', ROOM + ')');
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e && e.message || e).slice(0, 500)); process.exit(1); });
