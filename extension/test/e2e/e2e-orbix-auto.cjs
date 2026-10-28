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

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-orbix-a-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new', '--window-size=1280,900'],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 60000 });
  const extId = new URL(sw.url()).host;
  log('extension loaded:', extId);

  const page = await ctx.newPage();
  page.on('dialog', async d => { log('dialog:', d.type(), JSON.stringify(d.message()).slice(0, 100)); await d.accept(); });

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

    // 3) Bootstrap both directions: owner message -> Orbix bot reply.
    await page.fill('textarea', 'hi orbix, ek line mein bata tu kya kar sakta hai');
    await page.keyboard.press('Enter');
    let gotReply = false;
    for (let i = 0; i < 60 && !gotReply; i++) {
      await sleep(2000);
      gotReply = await page.evaluate(() => {
        const bubbles = Array.from(document.querySelectorAll('div, p, span, li'))
          .filter(e => e.children.length <= 2 && (e.textContent || '').trim().length > 20);
        return bubbles.some(e => !/hi orbix, ek line/.test(e.textContent || ''));
      });
    }
    assert(gotReply, 'Orbix bot replied (both directions present)');
    await sleep(2000);

    // 4) Mirror toolbar click from the SW (same API calls background.js makes).
    await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find(x => x.url && x.url.startsWith('https://orbix-video-ly.web.app/'));
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
    let outcome = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      const banner = await page.locator('#cc-banner').textContent().catch(() => '') || '';
      if (/Auto-reply bhej di gayi/.test(banner)) { outcome = 'sent'; break; }
      if (/Auto-send ka button nahi mila|Auto-send ab safe nahi|direction pakka nahi/.test(banner)) { outcome = 'fail-closed: ' + banner.slice(0, 100); break; }
      if (/Reply nahi ban payi|Backend se baat nahi/.test(banner)) { outcome = 'infra: ' + banner.slice(0, 100); break; }
      await sleep(2000);
    }
    if (!outcome) outcome = 'timeout (no decisive banner in 180s)';
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
  }
})();
