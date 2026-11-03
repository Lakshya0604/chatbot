// VISION variant (v0.8.1): same chain + free Cloudflare vision gate (real Workers AI via LangChain.js).
// Real-site AUTO e2e on Orbix (user's OWN chat product, https://orbix-video-ly.web.app)
// with the v0.8.0 AUTO adapter + real Groq BYOK. Dummy test account only; the
// "other side" is Orbix's own bot - koi third-party/stranger contact nahi.
// Mirrors the real toolbar-click path (background.js: inject 4 files -> CC_AUTO_START).
// Bounded: exactly 1 AUTO send expected, then Stop all.
// Exit 0 = full AUTO chain observed; 2 = adapter failed closed (honest);
// 3 = infra failure (backend/AI); 1 = unexpected error.
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');

const GROQ_KEY_FILE = process.env.GROQ_KEY_FILE;
const CF_KEY_FILE = process.env.CF_KEY_FILE;
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID;
const EMAIL_FILE = process.env.ORBIX_EMAIL_FILE;
const PASS_FILE = process.env.ORBIX_PASS_FILE;
const EXT = path.resolve(__dirname, '..', '..');
const BACKEND = process.env.BACKEND_URL || 'https://chatbot-backend-3j2t.onrender.com';
const log = (...a) => console.log('[e2e-orbix]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function assert(cond, msg, extra) {
  if (cond) { log('PASS:', msg); return; }
  console.error('FAIL:', msg, extra ?? '');
  throw new Error('ASSERT: ' + msg);
}

(async () => {
  assert(CF_KEY_FILE && fs.existsSync(CF_KEY_FILE) && /^[a-f0-9]{32}$/.test(CF_ACCOUNT || ''), 'Cloudflare token file + account id provided');
  const cfKey = process.env.EXPECT_VISION_FAIL ? 'invalid-token-for-negative-test' : fs.readFileSync(CF_KEY_FILE, 'utf8').trim();
  assert(GROQ_KEY_FILE && fs.existsSync(GROQ_KEY_FILE), 'GROQ_KEY_FILE provided');
  assert(EMAIL_FILE && PASS_FILE && fs.existsSync(EMAIL_FILE) && fs.existsSync(PASS_FILE), 'Orbix dummy creds files provided');
  const apiKey = fs.readFileSync(GROQ_KEY_FILE, 'utf8').trim();
  const email = fs.readFileSync(EMAIL_FILE, 'utf8').trim();
  const pass = fs.readFileSync(PASS_FILE, 'utf8').trim();

  // TEST BUILD: production code, manifest patched to add the orbix origin to
  // host_permissions - the production toolbar click grants activeTab for this;
  // a scripted run has no click, so the origin grant mirrors that grant.
  const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-orbix-build-'));
  fs.cpSync(EXT, BUILD, { recursive: true, filter: (s2) => !s2.includes(`${path.sep}test${path.sep}e2e${path.sep}`) });
  const mf = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
  mf.name = 'Character Chatbot ORBIX TEST BUILD (production code, orbix origin allowed)';
  mf.host_permissions = Array.from(new Set([...(mf.host_permissions || []), 'https://orbix-video-ly.web.app/*', '<all_urls>']));
  // TEST ONLY: <all_urls> mirrors the activeTab grant that a real toolbar click gives (captureVisibleTab needs one of the two).
  fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(mf, null, 2));

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-orbix-a-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--headless=new', '--window-size=1280,900'],
    recordVideo: { dir: process.env.VIDEO_DIR || '/tmp/orbix-video-vision', size: { width: 1280, height: 900 } },
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 60000 });
  const extId = new URL(sw.url()).host;
  log('extension loaded:', extId);

  const page = await ctx.newPage();
  page.on('dialog', async d => { log('dialog:', d.type(), JSON.stringify(d.message()).slice(0, 100)); await d.accept(); });
  page.on('console', m => { const t = m.text(); if (/cc|CC_|chat|engine|auto/i.test(t)) log('console>', t.slice(0, 160)); });
  page.on('pageerror', e => log('PAGEERR>', String(e).slice(0, 200)));

  try {
    // 1) Settings: real storage paths (same keys the options UI writes).
    await sw.evaluate(async ({ backend, key }) => {
      await chrome.storage.sync.set({
        character: { name: 'Meera', gender: 'girl', role: 'college friend', tone: 'funny', humour: 'light teasing', replyLength: 'short', defaultMood: 'playful', vocabulary: 'Roman Hinglish casual' },
        backendUrl: backend,
      });
      await chrome.storage.local.set({ aiConfig: { provider: 'groq', apiKey: key, model: 'openai/gpt-oss-120b', baseUrl: '' } });
    }, { backend: BACKEND, key: apiKey });
    await sw.evaluate(async ({ k, a }) => { await chrome.storage.local.set({ visionConfig: { provider: 'cloudflare', apiKey: k, accountId: a }, visionStats: { calls: 0, verified: 0, rejected: 0 } }); }, { k: cfKey, a: CF_ACCOUNT });
    log('vision seeded (cloudflare workers ai via LangChain)');
    log('settings seeded (backend', BACKEND + ', groq BYOK)');

    // 2) Login with the dummy account (Render cold start possible).
    await page.goto('https://orbix-video-ly.web.app/#/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input', { timeout: 90000 });
    const inputs = await page.$$('input');
    let emailEl = null, passEl = null;
    for (const el of inputs) {
      const t = await el.getAttribute('type');
      if (t === 'email') emailEl = el;
      if (t === 'password') passEl = el;
    }
    assert(emailEl && passEl, 'login form found');
    await emailEl.fill(email); await passEl.fill(pass);
    await page.keyboard.press('Enter');
    await page.waitForSelector('textarea', { timeout: 120000 });
    log('login success, app home open');

    // 3) Bootstrap BOTH exchanges: auto-detect ko kam se kam 3 rows chahiye,
    //    isliye 2 owner messages + 2 bot replies (4 rows) pehle laao.
    const sendOwner = async (text) => {
      await page.fill('textarea', text);
      await page.keyboard.press('Enter');
    };
    const assistantCount = () => page.evaluate(() => document.querySelectorAll('.msg.assistant').length);
    const waitReplies = async (n, timeoutS) => {
      for (let i = 0; i < timeoutS / 2; i++) {
        await sleep(2000);
        if ((await assistantCount()) >= n) return true;
      }
      return false;
    };
    await sendOwner('hi orbix, ek line mein bata tu kya kar sakta hai');
    assert(await waitReplies(1, 90), 'Orbix bot reply #1');
    await sendOwner('accha ek chhota sa hindi joke sunao');
    assert(await waitReplies(2, 90), 'Orbix bot reply #2 (>=3 message rows present)');
    // streaming settle: 2s tak .msg.assistant count + text stable rahe
    let lastTxt = '';
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      const txt = await page.evaluate(() => (document.querySelector('.thread') || {}).textContent || '');
      if (txt === lastTxt) break;
      lastTxt = txt;
    }

    // 4) Mirror toolbar click from the SW (same API calls background.js makes).
    await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://orbix-video-ly.web.app/*' });
      const t = tabs[0];
      if (!t) throw new Error('orbix tab not found');
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content/engine.js', 'content/adapters/custom-utils.js', 'content/adapters/auto-utils.js', 'content/adapters/auto.js'] });
      await chrome.tabs.sendMessage(t.id, { type: 'CC_AUTO_START' });
    });
    log('CC_AUTO_START dispatched');
    await sleep(4000);

    // 5) Panel consent 2-step + AUTO on.
    const toggle = page.locator('#cc-panel .cc-panel-header button').first();
    try {
      await toggle.waitFor({ state: 'visible', timeout: 30000 });
    } catch (e) {
      const diag = await page.evaluate(() => {
        const A = window.ChatAuto, C = window.ChatCustom;
        if (!A || !C) return { err: 'utils not in main world (expected - content script world mein hain)' };
        return {};
      }).catch(() => ({}));
      const prof = await sw.evaluate(async () => (await chrome.storage.local.get('siteProfiles')).siteProfiles);
      log('DETECTION FAILED - siteProfiles:', JSON.stringify(prof).slice(0, 800), 'diag:', JSON.stringify(diag));
      throw e;
    }
    assert((await toggle.textContent()).includes('AI off'), 'panel toggle visible (AI off)');
    await toggle.click(); await sleep(1500);
    assert((await toggle.textContent()).includes('Consent pending'), 'consent step 1 -> pending');
    await toggle.click(); await sleep(1500);
    assert((await toggle.textContent()).includes('AI on'), 'consent step 2 -> AI on');
    const autoBtn = page.locator('#cc-panel .cc-panel-header button', { hasText: 'Auto:' }).first();
    await autoBtn.click(); await sleep(1000);
    assert((await autoBtn.textContent()).includes('Auto: on'), 'AUTO mode on');

    // 6) Fresh incoming AFTER activation: owner sends, Orbix bot replies.
    await page.fill('textarea', 'accha ek aur batao - chhota sa fact sunao');
    await page.keyboard.press('Enter');

    // 7) Decisive banner: sent / fail-closed / infra.
    let outcome = null, lastBanner = '';
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      const banner = await page.locator('#cc-banner').textContent().catch(() => '') || '';
      if (banner && banner !== lastBanner) { log('banner>', banner.slice(0, 140)); lastBanner = banner; }
      if (/Auto-reply bhej di gayi/.test(banner)) { outcome = 'sent'; break; }
      if (/Vision check fail/.test(banner)) { outcome = 'fail-closed: ' + banner.slice(0, 140); break; }
      if (/Auto-send ka button nahi mila|Auto-send ab safe nahi|direction pakka nahi/.test(banner)) { outcome = 'fail-closed: ' + banner.slice(0, 100); break; }
      if (/Reply nahi ban payi|Backend se baat nahi/.test(banner)) { outcome = 'infra: ' + banner.slice(0, 100); break; }
      await sleep(2000);
    }
    if (!outcome) {
      outcome = 'timeout (no decisive banner in 180s)';
      await page.screenshot({ path: '/tmp/orbix-timeout.png' });
      const dump = await page.evaluate(async () => {
        const prof = await new Promise(r => chrome.storage.local.get(null, r));
        return Object.keys(prof).map(k => k + '=' + JSON.stringify(prof[k]).slice(0, 300));
      }).catch(e => ['dump failed: ' + e]);
      log('storage dump:', JSON.stringify(dump, null, 1).slice(0, 2000));
    }
    log('OUTCOME:', outcome);

    // 8) Stop all immediately (bounds any reply loop).
    await page.locator('#cc-stopall-btn').click().catch(() => {});
    await sleep(500);

    let code = 0;
    if (process.env.EXPECT_VISION_FAIL) {
      assert(/Vision check fail/.test(outcome), 'NEGATIVE: forced vision failure -> fail-closed, NO auto-send', outcome);
      const sentOwn = await page.evaluate(() => document.querySelectorAll('.msg.user').length);
      log('owner message rows after forced vision failure:', sentOwn, '(bootstrap 2 + test message 1 = 3 expected, no 4th auto-sent)');
      assert(sentOwn === 3, 'no auto-send happened after vision failure');
      code = 0;
    } else if (outcome.startsWith('fail-closed')) { log('Adapter failed closed on Orbix - honest exit 2.'); code = 2; }
    else if (outcome.startsWith('infra')) { log('Backend/AI failure (not adapter) - exit 3.'); code = 3; }
    else if (!process.env.EXPECT_VISION_FAIL) {
      assert(outcome === 'sent', 'AUTO chain: real incoming -> AI reply auto-sent on Orbix');
      const vs = await sw.evaluate(async () => (await chrome.storage.local.get('visionStats')).visionStats);
      log('visionStats', JSON.stringify(vs));
      assert(vs && vs.calls >= 1 && vs.verified >= 1, 'vision transcript gate really ran and verified before send');
    }
    if (code === 0) log('ALL CHECKS PASSED - Orbix real-site AUTO chain observed end-to-end.');
    globalThis.__exitCode = code;
  } finally {
    await ctx.close().catch(() => {}); // video finalize hone ke liye zaroori
    fs.rmSync(userDir, { recursive: true, force: true });
    fs.rmSync(BUILD, { recursive: true, force: true });
  }
  process.exit(globalThis.__exitCode || 0);
})().catch(e => { console.error('E2E-ERR', String(e).slice(0, 300)); process.exit(1); });
