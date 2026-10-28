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
const EMAIL_FILE = process.env.ORBIX_EMAIL_FILE;
const PASS_FILE = process.env.ORBIX_PASS_FILE;
const EXT = path.resolve(__dirname, '..', '..');
const BACKEND = process.env.BACKEND_URL || 'https://chatbot-backend-3j2t.onrender.com';
const log = (...a) => console.log('[e2e-orbix]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function assert(cond, msg, extra) {
  if (cond) { log('PASS:', msg); return; }
  console.error('FAIL:', msg, extra ?? ''); process.exit(1);
}

(async () => {
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
  mf.host_permissions = Array.from(new Set([...(mf.host_permissions || []), 'https://orbix-video-ly.web.app/*']));
  fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(mf, null, 2));

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-orbix-a-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--headless=new', '--window-size=1280,900'],
    recordVideo: { dir: '/tmp/orbix-video', size: { width: 1280, height: 900 } },
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
    const waitBotReply = async (marker, timeoutS) => {
      for (let i = 0; i < timeoutS / 2; i++) {
        await sleep(2000);
        const got = await page.evaluate((m) => {
          const bubbles = Array.from(document.querySelectorAll('.msg.assistant .answer, .answer, div, p'))
            .filter(e => (e.textContent || '').trim().length > 20);
          return bubbles.some(e => !(e.textContent || '').includes(m));
        }, marker);
        if (got) return true;
      }
      return false;
    };
    await sendOwner('hi orbix, ek line mein bata tu kya kar sakta hai');
    assert(await waitBotReply('hi orbix, ek line', 90), 'Orbix bot reply #1');
    await sendOwner('accha ek chhota sa hindi joke sunao');
    assert(await waitBotReply('accha ek chhota', 90), 'Orbix bot reply #2 (>=3 message rows present)');
    await sleep(2000);

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
    await toggle.waitFor({ state: 'visible', timeout: 30000 });
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

    if (outcome.startsWith('fail-closed')) { log('Adapter failed closed on Orbix - honest exit 2.'); process.exit(2); }
    if (outcome.startsWith('infra')) { log('Backend/AI failure (not adapter) - exit 3.'); process.exit(3); }
    assert(outcome === 'sent', 'AUTO chain: real incoming -> AI reply auto-sent on Orbix');
    log('ALL CHECKS PASSED - Orbix real-site AUTO chain observed end-to-end.');
    process.exit(0);
  } finally {
    await ctx.close().catch(() => {});
    fs.rmSync(userDir, { recursive: true, force: true });
    fs.rmSync(BUILD, { recursive: true, force: true });
  }
})();
