// orbix2a: token-login + REAL picker flow (inner-element clicks) + profile verify.
// Profile browser-dir /tmp/cc-orbix-profile mein persist hoti hai (runs B/C/D reuse).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright-core');

const SRC = path.join(__dirname, '..', '..');
const SHOTS = '/tmp/cc-orbix2';
fs.mkdirSync(SHOTS, { recursive: true });
const BUILD = '/tmp/cc-orbix2-build';
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync(path.join(__dirname, 'manifest.test-orbix.json'), path.join(BUILD, 'manifest.json'));

const TOKEN = fs.readFileSync('/tmp/cc-orbix-token', 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { console.log('FAIL:', label); process.exit(1); } console.log('PASS:', label); };

(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/cc-orbix-profile', {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1600,940'],
    viewport: { width: 1600, height: 900 },
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
  await ctx.addInitScript((tok) => { try { localStorage.setItem('orbix_token', tok); } catch (e) {} }, TOKEN);
  await page.goto('https://orbix-video-ly.web.app/#/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea', { timeout: 60000 });
  ok(true, 'TOKEN LOGIN - app home khula (no password needed)');

  // bootstrap: sirf tab bhejo jab chat khaali ho (re-run par duplicate na bane)
  const hasMsgs = await page.evaluate(() => !!document.querySelector('div.msg.user'));
  if (!hasMsgs) {
    await page.fill('textarea', 'hi orbix, ek line mein bata tu kya kar sakta hai');
    await page.keyboard.press('Enter');
  }
  let answered = false;
  for (let i = 0; i < 75; i++) {
    await sleep(1000);
    answered = await page.evaluate(() => {
      const ans = document.querySelector('div.msg.assistant .answer');
      const typing = document.querySelector('.typing');
      return !!ans && !typing;
    });
    if (answered) break;
  }
  ok(answered, 'bot ka ANSWER complete hua (thinking khatam)');
  // Send button wapas aaya (busy khatam)?
  await page.waitForSelector('form.composer button.btn.primary', { timeout: 10000 });
  ok(true, 'Send button visible (busy nahi)');
  await page.screenshot({ path: SHOTS + '/01-chat-ready.png' });

  // probe: LIVE loaded util ka behavior real DOM par
  const probe = await page.evaluate(() => {
    if (!window.ChatCustom) return 'NO ChatCustom';
    const a = document.querySelector('div.msg.assistant .answer');
    const b = document.querySelector('div.msg.user .bubble');
    return {
      fromAnswer: a ? ChatCustom.deriveRowSelector(a, document) : null,
      fromBubble: b ? ChatCustom.deriveRowSelector(b, document) : null,
      msgCount: document.querySelectorAll('div.msg').length,
    };
  });
  console.log('PROBE>', JSON.stringify(probe));
  // REAL picker flow: natural inner-element clicks
  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://orbix-video-ly.web.app/*' });
    await chrome.tabs.sendMessage(tabs[0].id, { type: 'CC_START_PICKER' });
  });
  await page.waitForSelector('#cc-picker-bar', { timeout: 10000 });
  const clickEl = async (sel) => {
    const el = await page.$(sel);
    if (!el) return false;
    const b = await el.boundingBox();
    if (!b) return false;
    await page.mouse.click(b.x + 6, b.y + 6);
    await sleep(500);
    return true;
  };
  ok(await clickEl('div.msg.assistant .answer'), 'picker stage1: bot ke answer (inner) par click');
  ok(await clickEl('div.msg.user .bubble'), 'picker stage2: apne bubble (inner) par click');
  ok(await clickEl('form.composer textarea'), 'picker stage3: composer par click');
  // Send button khaali composer par DISABLED hota hai (click pass-through ho jaata
  // hai) - enable karne ke liye thoda text daalo; picker clicks ko rokta hai,
  // isliye kuch SEND nahi hoga; baad mein clear kar denge.
  await page.fill('form.composer textarea', 'x');
  await sleep(400);
  // Site ka Orbi FAB (div.orbi) Send ke RIGHT side ko cover karta hai is viewport
  // par - button ke LEFT visible hisse par click karo (jaisa ek user karega).
  const sendEl = await page.$('form.composer button.btn.primary');
  const sb = await sendEl.boundingBox();
  await page.mouse.click(sb.x + 8, sb.y + sb.height / 2);
  await sleep(500);
  console.log('PASS: picker stage4: SEND button (enabled, left edge) par click');
  await page.fill('form.composer textarea', '');
  await sleep(300);
  await page.screenshot({ path: SHOTS + '/02-picker-last-stage.png' });
  await page.click('#cc-picker-bar button'); await sleep(1500); // stage5 title SKIP -> finish -> alert accept

  const prof = await sw.evaluate(() => new Promise((r) => chrome.storage.local.get('siteProfiles', r)));
  console.log('PROFILE>', JSON.stringify(prof.siteProfiles));
  const p = (prof.siteProfiles || {})['https://orbix-video-ly.web.app'];
  ok(p, 'profile save hui');
  ok(p.rows === 'div.msg', 'rows selector OUTER row ki: ' + p.rows + ' (ancestor-walk fix ka proof)');
  ok(p.outgoingClass === 'user', 'outgoingClass ROW class: ' + p.outgoingClass + ' (role misclassification fix ka proof)');
  ok(/textarea/.test(p.composer), 'composer selector: ' + p.composer);
  ok(p.send && /btn|button/.test(p.send), 'SEND selector mila: ' + p.send);
  // selector reality check: send selector exactly 1 element match kare (composer mein text hone par)
  await page.fill('form.composer textarea', 'x'); await sleep(300);
  const sendCount = await page.evaluate((s) => document.querySelectorAll(s).length, p.send);
  await page.fill('form.composer textarea', '');
  ok(sendCount === 1, 'send selector unique (' + sendCount + ' match): ' + p.send);
  const sendTxt = await page.evaluate((s) => { const el = document.querySelector(s); return el ? (el.textContent || '').trim() : ''; }, p.send);
  ok(/send/i.test(sendTxt), 'send selector asli Send button ko point karta hai: ' + JSON.stringify(sendTxt));
  const rowCount = await page.evaluate((s) => document.querySelectorAll(s).length, p.rows);
  console.log('ROWCOUNT>', rowCount);
  ok(rowCount >= 2, 'rows selector dono roles pakadta hai: ' + rowCount);
  console.log('ORBIX2A ALL PASS');
  await ctx.close();
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 400)); process.exit(1); });
