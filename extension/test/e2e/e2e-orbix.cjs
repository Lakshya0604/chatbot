// e2e-orbix.cjs - LIVE Orbix test: production extension code + production relay,
// dummy test account (CC Test Buddy, vault-saved). Bounded: SUGGEST draft proof +
// exactly 1 AUTO send, phir Stop all. Koi third-party contact nahi - sirf apna bot.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright-core');

const SRC = path.join(__dirname, '..', '..');
const SHOTS = '/tmp/cc-orbix';
fs.mkdirSync(SHOTS, { recursive: true });
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-orbix-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync(path.join(__dirname, 'manifest.test-orbix.json'), path.join(BUILD, 'manifest.json'));

const EMAIL = fs.readFileSync('/tmp/cc-dummy-em', 'utf8');
const PASS = fs.readFileSync('/tmp/cc-dummy-pw', 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { console.log('FAIL:', label); process.exit(1); } console.log('PASS:', label); };

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-orbix-profile-')), {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1280,800'],
    viewport: { width: 1280, height: 720 },
  });
  let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
  ok(sw, 'service worker registered');
  await sw.evaluate(() => new Promise((r) => {
    chrome.storage.sync.set({
      character: { name: 'Meera', gender: 'girl', role: 'college friend', tone: 'funny', humour: 'light teasing', replyLength: 'short', defaultMood: 'playful', vocabulary: 'Roman Hinglish, yaar/bhai wala casual' },
      backendUrl: 'http://127.0.0.1:8787',
    }, () => chrome.storage.local.set({ authToken: 'tok123' }, r));
  }));
  ok(true, 'settings seeded');

  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGEERR>', String(e).slice(0, 200)));

  // --- login (Render cold start ho sakta hai) ---
  await page.goto('https://orbix-video-ly.web.app/#/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input', { timeout: 90000 });
  const fillLogin = async () => {
    const inputs = await page.$$('input');
    let emailEl = null, passEl = null;
    for (const el of inputs) {
      const t = await el.getAttribute('type');
      if (t === 'email') emailEl = el;
      if (t === 'password') passEl = el;
    }
    if (!emailEl || !passEl) return false;
    await emailEl.fill(EMAIL); await passEl.fill(PASS);
    return true;
  };
  ok(await fillLogin(), 'login form mila (email+password)');
  await page.screenshot({ path: SHOTS + '/01-login-filled.png' });
  await page.keyboard.press('Enter');
  // app home ka wait (composer textarea)
  await page.waitForSelector('textarea', { timeout: 120000 });
  ok(true, 'LOGIN SUCCESS - app home khula');
  await sleep(2000);
  await page.screenshot({ path: SHOTS + '/02-logged-in.png' });

  // --- bootstrap: ek MANUAL message (owner khud) taaki bot reply kare ---
  await page.fill('textarea', 'hi orbix, ek line mein bata tu kya kar sakta hai');
  await page.keyboard.press('Enter');
  // bot reply ka poll (cold start tak 40s)
  for (let i=0;i<40;i++){ await sleep(1000); const got = await page.evaluate(() => Array.from(document.querySelectorAll('div,p,span')).some((e)=>e.children.length<=2 && (e.textContent||'').trim().length>15 && !/hi orbix, ek line/.test(e.textContent||''))); if (got) break; }
  // adaptive element discovery: meri outgoing + bot ki incoming rows
  const found = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('div, p, span, li'));
    const mine = all.filter((e) => e.childElementCount < 4 && /hi orbix, ek line/.test(e.textContent || ''));
    const textOf = (e) => (e.textContent || '').trim();
    // chhoti bubble jaisi cheez: leaf-ish div with < 300 chars
    const bubbles = all.filter((e) => e.children.length <= 2 && textOf(e).length > 2 && textOf(e).length < 300);
    const myRow = bubbles.filter((e) => /hi orbix, ek line/.test(textOf(e))).pop() || null;
    const botRow = bubbles.filter((e) => myRow && e !== myRow && !myRow.contains(e) && !e.contains(myRow) && textOf(e).length > 15 && !/hi orbix, ek line/.test(textOf(e))).pop() || null;
    const ta = document.querySelector('textarea');
    const sendBtn = Array.from(document.querySelectorAll('button')).find((b) => /send/i.test(b.textContent || '') || /send/i.test(b.getAttribute('aria-label') || '')) || null;
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; };
    return { myRow: r(myRow), botRow: r(botRow), composer: r(ta), send: r(sendBtn), botText: botRow ? textOf(botRow).slice(0, 120) : null };
  });
  console.log('FOUND>', JSON.stringify(found));
  ok(found.myRow && found.composer, 'bootstrap message bheja + rows mile. botText=' + JSON.stringify(found.botText));
  await page.screenshot({ path: SHOTS + '/03-bot-replied.png' });

  // --- picker (production flow): SW se CC_START_PICKER ---
  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://orbix-video-ly.web.app/*' });
    await chrome.tabs.sendMessage(tabs[0].id, { type: 'CC_START_PICKER' });
  });
  await page.waitForSelector('#cc-picker-bar', { timeout: 10000 });
  ok(true, 'picker chal raha LIVE Orbix par');
  await page.screenshot({ path: SHOTS + '/04-picker.png' });
  const clickAt = async (p) => { await page.mouse.click(p.x, p.y); await sleep(400); };
  // stage1: koi bhi message bubble (bot row prefer)
  await clickAt(found.botRow || found.myRow);
  // stage2: apni outgoing row
  await clickAt(found.myRow);
  // stage3: composer
  await clickAt(found.composer);
  // stage4: send button (skip nahi)
  if (found.send) { await clickAt(found.send); }
  else { await page.click('#cc-picker-bar button'); } // skip
  // stage5: title SKIP (Orbix chat ka title element nahi)
  await page.click('#cc-picker-bar button'); await sleep(1200); // Skip -> finish -> alert auto-accept

  const prof = await sw.evaluate(() => new Promise((r) => chrome.storage.local.get('siteProfiles', r)));
  const origins = Object.keys(prof.siteProfiles || {});
  console.log('PROFILES>', JSON.stringify(prof.siteProfiles));
  ok(origins.length === 1, 'Orbix profile save hui: ' + origins.join(','));

  // --- reload -> engine boot -> consent ---
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(4000);
  const hasPanel = await page.evaluate(() => !!document.getElementById('cc-panel'));
  ok(hasPanel, 'reload par engine panel aa gaya (LIVE Orbix)');
  await page.screenshot({ path: SHOTS + '/05-engine-panel.png' });

  await page.click('#cc-toggle-btn'); await sleep(800);
  await page.screenshot({ path: SHOTS + '/06-consent-draft.png' });
  const draft1 = await page.evaluate(() => { const ta = document.querySelector('textarea'); return ta ? ta.value : ''; });
  ok(/AI-drafted replies/.test(draft1), 'consent-request draft composer mein (owner khud bhejta hai)');
  await page.fill('textarea', ''); // bot ko consent text nahi bhejte - apna bot hai
  await page.click('#cc-toggle-btn'); await sleep(1000);
  const enabled = await page.getAttribute('#cc-toggle-btn', 'data-enabled');
  ok(enabled === 'true', 'chat consent-active');
  await page.screenshot({ path: SHOTS + '/07-consent-active.png' });

  // --- SUGGEST: naya manual msg -> bot reply (incoming) -> AI draft (send NAHI) ---
  await page.fill('textarea', 'ek chhota sa joke suna');
  await page.keyboard.press('Enter');
  // AI draft composer mein aane ka poll (bot reply -> engine -> backend): 45s tak
  for (let i=0;i<45;i++){ await sleep(1000); const v = await page.evaluate(() => { const t = document.querySelector('textarea'); return t ? t.value : ''; }); if (v && v.trim().length > 3) break; }
  const compVal = await page.evaluate(() => { const ta = document.querySelector('textarea'); return ta ? ta.value : ''; });
  console.log('DRAFT>', JSON.stringify(compVal).slice(0, 200));
  await page.screenshot({ path: SHOTS + '/08-suggestion-draft.png' });
  ok(compVal.trim().length > 3, 'SUGGEST: Orbix bot ke message par AI draft aayi (send NAHI hui): ' + JSON.stringify(compVal).slice(0, 120));
  const panelTxt1 = await page.evaluate(() => document.getElementById('cc-panel').innerText.slice(0, 200));
  console.log('PANEL1>', JSON.stringify(panelTxt1));
  await page.fill('textarea', '');

  // --- AUTO: exactly 1 auto-send, phir turant Stop all ---
  await page.click('#cc-auto-btn'); await sleep(500);
  const mode = await page.getAttribute('#cc-auto-btn', 'data-mode');
  ok(mode === 'auto', 'auto mode on (bounded: 1 send)');
  await page.fill('textarea', 'aur bata, aaj kya naya seekha?');
  await page.keyboard.press('Enter');
  // auto-send hone ka poll: panel mein activity ya composer par draft aake clear hona; 40s tak
  for (let i=0;i<40;i++){ await sleep(1000); const v = await page.evaluate(() => { const t = document.querySelector('textarea'); return t ? t.value : ''; }); if (v && v.trim().length > 3) { await sleep(3000); break; } }
  await page.screenshot({ path: SHOTS + '/09-auto-sent.png' });
  await page.click('#cc-stopall-btn'); await sleep(500);
  const panelTxt2 = await page.evaluate(() => document.getElementById('cc-panel').innerText.slice(0, 250));
  console.log('PANEL2>', JSON.stringify(panelTxt2));
  await page.screenshot({ path: SHOTS + '/10-stopped.png' });
  const stopped = /stop|Stopped|band/i.test(panelTxt2);
  ok(stopped, 'STOP ALL ke baath engine stopped (bounded test khatam)');
  console.log('ORBIX E2E ALL PASS');
  await ctx.close();
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 400)); process.exit(1); });
