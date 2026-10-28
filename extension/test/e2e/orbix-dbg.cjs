// Debug probe: why didn't the engine react to the new incoming on Orbix?
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const EXT = path.resolve(__dirname, '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[dbg]', ...a);

(async () => {
  const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dbg-build-'));
  fs.cpSync(EXT, BUILD, { recursive: true, filter: (s2) => !s2.includes(`${path.sep}test${path.sep}e2e${path.sep}`) });
  const mf = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
  mf.host_permissions = Array.from(new Set([...(mf.host_permissions || []), 'https://orbix-video-ly.web.app/*']));
  fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(mf, null, 2));

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dbg-prof-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--headless=new', '--window-size=1280,900'],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 60000 });

  const page = await ctx.newPage();
  page.on('dialog', async d => { await d.accept(); });

  // login
  await page.goto('https://orbix-video-ly.web.app/#/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input', { timeout: 90000 });
  const inputs = await page.$$('input');
  for (const el of inputs) {
    const t = await el.getAttribute('type');
    if (t === 'email') await el.fill(fs.readFileSync('/tmp/orbix-em.txt', 'utf8').trim());
    if (t === 'password') await el.fill(fs.readFileSync('/tmp/orbix-pw.txt', 'utf8').trim());
  }
  await page.keyboard.press('Enter');
  await page.waitForSelector('textarea', { timeout: 120000 });
  await sleep(2000);

  // bootstrap one exchange (if chat is fresh); then inject + AUTO detect
  await page.fill('textarea', 'hi');
  await page.keyboard.press('Enter');
  await sleep(15000); // let bot answer

  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://orbix-video-ly.web.app/*' });
    const t = tabs[0];
    await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content/engine.js', 'content/adapters/custom-utils.js', 'content/adapters/auto-utils.js', 'content/adapters/auto.js'] });
    await chrome.tabs.sendMessage(t.id, { type: 'CC_AUTO_START' });
  });
  await sleep(4000);

  // read profile from storage via SW
  const prof = await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return { keys: Object.keys(all), autoProfiles: all.autoProfiles || null };
  });
  log('storage keys:', JSON.stringify(prof.keys));
  log('profile:', JSON.stringify(prof.autoProfiles).slice(0, 1200));

  // inspect DOM: what does profile.rows match, where are messages
  const dom = await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    const texts = [];
    // candidate message elements: leaf-ish blocks with text
    const all = Array.from(document.querySelectorAll('div, p, span, li, article, section'));
    const bubbles = all.filter(e => e.children.length <= 3 && (e.textContent || '').trim().length > 8 && (e.textContent || '').trim().length < 400);
    const recent = bubbles.slice(-14).map(e => {
      const r = e.getBoundingClientRect();
      return { cls: (e.className || '').toString().slice(0, 60), left: Math.round(r.left), w: Math.round(r.width), txt: (e.textContent || '').trim().slice(0, 60) };
    });
    return { composerTag: ta ? ta.tagName : null, recent };
  });
  log('composer:', dom.composerTag);
  for (const r of dom.recent) log('row>', JSON.stringify(r));

  // dump engine panel + consent state
  const st = await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return { chatConsent: all.chatConsent || null };
  });
  log('chatConsent:', JSON.stringify(st.chatConsent).slice(0, 600));

  await page.screenshot({ path: '/tmp/orbix-dbg.png' });
  await ctx.close();
  fs.rmSync(userDir, { recursive: true, force: true });
  fs.rmSync(BUILD, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error('DBG-ERR', e); process.exit(1); });
