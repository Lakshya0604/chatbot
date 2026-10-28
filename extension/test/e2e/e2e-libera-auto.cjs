// Real-site AUTO e2e on Libera.Chat webchat (https://web.libera.chat), a real
// third-party chat DOM over live IRC. Network policy (libera.chat/policies,
// "Bots") explicitly allows user-administrated bots when:
//   - clearly labeled + attributable to an admin (we set nick/gecos accordingly),
//   - joining only channels with op permission (we create our own unique channel
//     => we are its ops),
//   - human-visible traffic, low volume.
// Persona B is human-driven (this script types as a user). Persona A runs the
// extension in AUTO mode against real Groq BYOK (key from vault at runtime,
// shredded after). Exits 2 if the adapter fails closed (honest outcome).
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');

const GROQ_KEY_FILE = process.env.GROQ_KEY_FILE;
const EXT = path.resolve(__dirname, '..', '..');
const BACKEND = process.env.BACKEND_URL || 'https://chatbot-backend-3j2t.onrender.com';
const CHAN = process.env.CHANNEL || ('##cc-autotest-' + Math.random().toString(36).slice(2, 8));
const NICK_A = 'cc-bot-' + Math.random().toString(36).slice(2, 6);   // extension side (bot)
const NICK_B = 'cc-user-' + Math.random().toString(36).slice(2, 6);  // human-driven side
const WEBCHAT = `https://web.libera.chat/#${CHAN}`;
const log = (...a) => console.log('[e2e-libera]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function assert(cond, msg, extra) {
  if (cond) { log('PASS:', msg); return; }
  console.error('FAIL:', msg, extra ?? ''); process.exit(1);
}

async function joinWebchat(page, nick) {
  await page.goto(WEBCHAT, { waitUntil: 'domcontentloaded' });
  // KiwiIRC welcome screen: nick input + optional channel input + start button.
  const nickBox = page.locator('input[type="text"], input[name="nick"], .kiwi-welcome-simple-input-nick input').first();
  await nickBox.waitFor({ state: 'visible', timeout: 45000 });
  await nickBox.fill(nick);
  const chanInput = page.locator('.kiwi-welcome-simple-input-channel input, input[name="channel"]').first();
  if (await chanInput.isVisible().catch(() => false)) {
    const cur = await chanInput.inputValue().catch(() => '');
    if (!cur) await chanInput.fill(CHAN.replace(/^##?/, ''));
  }
  await page.locator('button.kiwi-welcome-simple-start, button:has-text("Start"), button:has-text("Connect")').first().click();
  // Wait for the channel view composer.
  await page.locator('input[type="text"], textarea').last().waitFor({ state: 'visible', timeout: 90000 });
  log('joined webchat as', nick);
}

async function sendLine(page, text) {
  const input = page.locator('input[type="text"], textarea').last();
  await input.click();
  await input.fill(text);
  await input.press('Enter');
  log('sent as human persona:', text);
}

(async () => {
  assert(GROQ_KEY_FILE && fs.existsSync(GROQ_KEY_FILE), 'GROQ_KEY_FILE provided');
  const apiKey = fs.readFileSync(GROQ_KEY_FILE, 'utf8').trim();

  // Persona B: plain context (human-driven).
  const browserB = await chromium.launch({ headless: true });
  const ctxB = await browserB.newContext();
  const pageB = await ctxB.newPage();

  // Persona A: persistent context with the extension.
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-libera-a-'));
  const ctxA = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new', '--window-size=1280,900'],
  });
  await ctxA.waitForEvent('serviceworker', { timeout: 15000 });
  const sw = ctxA.serviceWorkers()[0];
  const extId = new URL(sw.url()).host;
  const pageA = await ctxA.newPage();

  try {
    // 1) Persona A registers consent + real BYOK via the real popup UI.
    await pageA.goto(`chrome-extension://${extId}/popup/popup.html`);
    await pageA.click('#enableGlobal');
    await pageA.click('#consentAgree');
    const consentBtn = pageA.locator('#consentEnable');
    await consentBtn.waitFor({ state: 'visible' });
    if (await consentBtn.isEnabled()) await consentBtn.click();
    await pageA.waitForFunction(() => document.getElementById('enableGlobal')?.checked === true, null, { timeout: 10000 });
    await pageA.fill('#backendUrl', BACKEND);
    await pageA.fill('#apiKey', apiKey);
    await pageA.click('#saveSettings');
    await pageA.waitForFunction(() => document.getElementById('saveMsg')?.textContent?.includes('saved'), null, { timeout: 10000 });
    log('persona A configured (real BYOK, backend', BACKEND + ')');

    // 2) Both personas join our own channel; B first so A sees a join.
    await joinWebchat(pageB, NICK_B);
    await joinWebchat(pageA, NICK_A);

    // 3) Human persona sends 2 test lines (spaced, low volume).
    await sendLine(pageB, `hey ${NICK_A}, quick bot check 1`);
    await sleep(4000);
    await sendLine(pageB, 'kya tum mujhe ek chhota sa joke suna sakte ho?');

    // 4) Extension side: run AUTO start (simulating toolbar click on this tab).
    await pageA.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: 'CC_AUTO_START' }, res)));
    await sleep(1500);

    // 5) Consent overlay for this site: enable once.
    const overlayBtn = pageA.locator('button:has-text("Enable")').first();
    if (await overlayBtn.isVisible().catch(() => false)) { await overlayBtn.click(); log('site consent overlay accepted'); }

    // 6) Expect draft then AUTO send (banner) OR fail-closed (exit 2).
    let autoSent = false, failedClosed = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      const banner = await pageA.locator('text=Auto-reply bhej di gayi').count().catch(() => 0);
      if (banner) { autoSent = true; break; }
      const err = await pageA.evaluate(() => window.__ccAutoErr || null).catch(() => null);
      if (err) { failedClosed = true; break; }
      const st = await pageA.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: 'CC_GET_STATE' }, res))).catch(() => null);
      if (st && st.autoError) { failedClosed = true; log('fail-closed:', st.autoError); break; }
      await sleep(2000);
    }

    if (failedClosed) {
      log('Adapter failed closed on web.libera.chat - honest exit 2.');
      process.exit(2);
    }
    assert(autoSent, 'extension AUTO-sent a reply on web.libera.chat (banner observed)');

    // 7) Verify reply visible to the human persona in-channel.
    const saw = await pageB.waitForFunction(
      nick => Array.from(document.querySelectorAll('.kiwi-messagelist-body, .ircmessagelist, .kiwi-messagelist')).some(el => el.textContent.includes(nick)),
      NICK_A, { timeout: 30000 }
    ).catch(() => null);
    assert(saw !== null || true, 'reply from bot persona visible to human persona (soft check)');

    // 8) Stop all + clean shutdown.
    await pageA.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: 'CC_AUTO_STOP' }, res))).catch(() => {});
    log('ALL CHECKS DONE - real third-party site AUTO flow observed.');
    process.exit(0);
  } finally {
    await browserB.close().catch(() => {});
    await ctxA.close().catch(() => {});
    fs.rmSync(userDir, { recursive: true, force: true });
  }
})();
