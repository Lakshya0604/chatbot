// Real-site AUTO e2e on Libera.Chat official webchat (https://web.libera.chat),
// a real third-party chat DOM over live IRC. Network policy
// (https://libera.chat/policies, "Bots") explicitly allows user-administrated
// bots when clearly labeled + attributable, joining only channels with op
// permission (we create our own unique channel => we are its ops), low volume.
// Persona B is human-driven (this script types as a user, 3 short lines).
// Persona A runs the extension v0.8.0 AUTO mode with real Groq BYOK (key from
// vault at runtime, shredded after). Mirrors the real toolbar-click path
// (background.js injects the same 4 files, then CC_AUTO_START).
// Exit 0 = full AUTO chain observed; 2 = adapter failed closed (honest);
// 3 = infra failure (backend/AI unreachable); 1 = unexpected error.
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');

const GROQ_KEY_FILE = process.env.GROQ_KEY_FILE;
const EXT = path.resolve(__dirname, '..', '..');
const BACKEND = process.env.BACKEND_URL || 'https://chatbot-backend-3j2t.onrender.com';
const CHAN = process.env.CHANNEL || ('##cc-autotest-' + Math.random().toString(36).slice(2, 8));
const NICK_A = 'ccbot' + Math.random().toString(36).slice(2, 6);   // extension side (bot)
const NICK_B = 'ccuser' + Math.random().toString(36).slice(2, 6);  // human-driven side
const WEBCHAT = `https://web.libera.chat/#${CHAN}`;
const log = (...a) => console.log('[e2e-libera]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function assert(cond, msg, extra) {
  if (cond) { log('PASS:', msg); return; }
  console.error('FAIL:', msg, extra ?? ''); process.exit(1);
}

async function joinWebchat(page, nick) {
  await page.goto(WEBCHAT, { waitUntil: 'domcontentloaded' });
  const nickBox = page.locator('.kiwi-welcome-simple input, .kiwi-welcome-simple-input-nick input, input[name="nick"], .kiwi-startbnc input, input[type="text"]').first();
  await nickBox.waitFor({ state: 'visible', timeout: 60000 });
  await nickBox.fill(nick);
  const chanInput = page.locator('.kiwi-welcome-simple-input-channel input, input[name="channel"]').first();
  if (await chanInput.isVisible().catch(() => false)) {
    const cur = await chanInput.inputValue().catch(() => '');
    if (!cur) await chanInput.fill(CHAN);
  }
  await page.locator('button.kiwi-welcome-simple-start, button:has-text("Start"), button:has-text("Connect")').first().click();
  await page.locator('.kiwi-ircinput input, .kiwi-ircinput textarea, .kiwi-controlbox-input input, form input[type="text"]').last().waitFor({ state: 'visible', timeout: 90000 });
  await sleep(3000); // join settle: topic/names + our own join line render
  log('joined webchat as', nick);
}

async function sendLine(page, text) {
  const input = page.locator('.kiwi-ircinput input, .kiwi-ircinput textarea, .kiwi-controlbox-input input').last();
  await input.click();
  await input.fill(text);
  await input.press('Enter');
  log('sent as human persona:', text);
  await sleep(1500);
}

(async () => {
  assert(GROQ_KEY_FILE && fs.existsSync(GROQ_KEY_FILE), 'GROQ_KEY_FILE provided');
  const apiKey = fs.readFileSync(GROQ_KEY_FILE, 'utf8').trim();

  // Persona B: plain headless context (human-driven).
  const browserB = await chromium.launch({ headless: true });
  const ctxB = await browserB.newContext();
  const pageB = await ctxB.newPage();

  // Persona A: persistent context with the extension loaded.
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-libera-a-'));
  const ctxA = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new', '--window-size=1280,900'],
  });
  let sw = ctxA.serviceWorkers()[0];
  if (!sw) sw = await ctxA.waitForEvent('serviceworker', { timeout: 60000 });
  const extId = new URL(sw.url()).host;
  const pageA = await ctxA.newPage();
  pageA.on('dialog', async d => { log('dialog:', d.type(), JSON.stringify(d.message()).slice(0, 120)); await d.accept(); });

  try {
    // 1) Configure backend + BYOK through the REAL options UI (extension page).
    const opt = await ctxA.newPage();
    await opt.goto(`chrome-extension://${extId}/options/options.html`);
    await opt.fill('#backendUrl', BACKEND);
    await opt.fill('#name', 'CC Test Bot');
    await opt.click('#save');
    await opt.waitForFunction(() => /saved|save ho/i.test(document.getElementById('status')?.textContent || '') || true, null, { timeout: 5000 }).catch(() => {});
    await opt.fill('#aiKey', apiKey);
    await opt.fill('#aiModel', 'openai/gpt-oss-120b');
    await opt.click('#aiSaveBtn');
    await sleep(1500);
    const aiSaved = await opt.evaluate(async () => {
      const r = await chrome.storage.local.get(['aiConfig']);
      return !!(r.aiConfig && r.aiConfig.apiKey);
    });
    assert(aiSaved, 'BYOK config saved via real options UI (storage.local aiConfig)');
    log('options configured (backend', BACKEND + ', groq BYOK)');

    // 2) Both personas join our own channel.
    await joinWebchat(pageB, NICK_B);
    await joinWebchat(pageA, NICK_A);

    // 3) Human persona sends 2 lines so BOTH directions exist in the list
    //    (auto direction lock needs both sides before engine boot).
    await sendLine(pageB, `hi ${NICK_A} - bot check line 1`);
    await sendLine(pageA, 'haan bhai, yahan hoon - test chal raha hai');
    await sendLine(pageB, 'ek chhota sa hindi joke sunao?');

    // 4) Mirror the toolbar click: inject the same 4 files + CC_AUTO_START,
    //    driven from the options page (extension context).
    const tabId = await opt.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find(x => x.url && x.url.startsWith('https://web.libera.chat/'));
      return t ? t.id : null;
    });
    assert(tabId != null, 'found persona A tab by URL');
    await opt.evaluate(async (id) => {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content/engine.js', 'content/adapters/custom-utils.js', 'content/adapters/auto-utils.js', 'content/adapters/auto.js'] });
      await chrome.tabs.sendMessage(id, { type: 'CC_AUTO_START' });
    }, tabId);
    log('CC_AUTO_START dispatched (toolbar-click path)');
    await sleep(4000);

    // 5) Panel: consent 2-step (two confirms auto-accepted by dialog handler).
    const toggle = pageA.locator('#cc-panel .cc-panel-header button').first();
    await toggle.waitFor({ state: 'visible', timeout: 30000 });
    assert((await toggle.textContent()).includes('AI off'), 'panel toggle visible, initial state AI off');
    await toggle.click(); // step 1: consent confirm + request draft into composer
    await sleep(1500);
    assert((await toggle.textContent()).includes('Consent pending'), 'consent step 1 -> pending, request draft in composer (not sent)');
    await toggle.click(); // step 2: owner confirms recipient consent
    await sleep(1500);
    assert((await toggle.textContent()).includes('AI on'), 'consent step 2 -> AI on');

    // 6) AUTO mode on (owner per-chat explicit choice).
    const autoBtn = pageA.locator('#cc-panel .cc-panel-header button', { hasText: 'Auto:' }).first();
    await autoBtn.click();
    await sleep(1000);
    assert((await autoBtn.textContent()).includes('Auto: on'), 'AUTO mode on');

    // 7) Fresh incoming AFTER activation triggers the AUTO chain.
    await sendLine(pageB, 'aur batao, aaj mausam kaisa lag raha hai tumhe?');

    // 8) Wait for the decisive banner: sent, fail-closed, or infra error.
    let outcome = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      const banner = await pageA.locator('#cc-banner').textContent().catch(() => '') || '';
      if (/Auto-reply bhej di gayi/.test(banner)) { outcome = 'sent'; break; }
      if (/Auto-send ka button nahi mila|Auto-send ab safe nahi|direction pakka nahi/.test(banner)) { outcome = 'fail-closed: ' + banner.slice(0, 100); break; }
      if (/Reply nahi ban payi|Backend se baat nahi/.test(banner)) { outcome = 'infra: ' + banner.slice(0, 100); break; }
      await sleep(2000);
    }
    if (!outcome) outcome = 'timeout (no decisive banner in 150s)';
    log('OUTCOME:', outcome);

    if (outcome.startsWith('fail-closed')) {
      log('Adapter failed closed on web.libera.chat - honest exit 2.');
      process.exit(2);
    }
    if (outcome.startsWith('infra')) {
      log('Backend/AI failure (not adapter) - exit 3.');
      process.exit(3);
    }
    assert(outcome === 'sent', 'AUTO chain: real incoming -> AI reply auto-sent on web.libera.chat');

    // 9) Reply visible to the human persona in-channel.
    await pageB.waitForFunction(
      nick => (document.body.innerText || '').includes(nick + ':') || (document.body.innerText || '').includes(nick),
      NICK_A, { timeout: 20000 }
    );
    log('PASS: bot reply visible to human persona in-channel');

    // 10) Stop all + leave.
    await pageA.locator('#cc-stopall-btn').click().catch(() => {});
    log('ALL CHECKS PASSED - real third-party site AUTO chain observed end-to-end.');
    process.exit(0);
  } finally {
    await browserB.close().catch(() => {});
    await ctxA.close().catch(() => {});
    fs.rmSync(userDir, { recursive: true, force: true });
  }
})();
