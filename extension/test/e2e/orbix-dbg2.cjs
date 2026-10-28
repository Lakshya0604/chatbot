const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const EXT = path.resolve(__dirname, '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[dbg2]', ...a);

(async () => {
  const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dbg2-build-'));
  fs.cpSync(EXT, BUILD, { recursive: true, filter: (s2) => !s2.includes(`${path.sep}test${path.sep}e2e${path.sep}`) });
  const mf = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
  mf.host_permissions = Array.from(new Set([...(mf.host_permissions || []), 'https://orbix-video-ly.web.app/*']));
  fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(mf, null, 2));
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dbg2-prof-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--headless=new', '--window-size=1280,900'],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 60000 });
  const page = await ctx.newPage();
  page.on('dialog', async d => { await d.accept(); });
  await page.goto('https://orbix-video-ly.web.app/#/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input', { timeout: 90000 });
  for (const el of await page.$$('input')) {
    const t = await el.getAttribute('type');
    if (t === 'email') await el.fill(fs.readFileSync('/tmp/orbix-em.txt', 'utf8').trim());
    if (t === 'password') await el.fill(fs.readFileSync('/tmp/orbix-pw.txt', 'utf8').trim());
  }
  await page.keyboard.press('Enter');
  await page.waitForSelector('textarea', { timeout: 120000 });
  await sleep(2500);
  await page.fill('textarea', 'hi');
  await page.keyboard.press('Enter');
  await sleep(15000);
  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://orbix-video-ly.web.app/*' });
    await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content/engine.js', 'content/adapters/custom-utils.js', 'content/adapters/auto-utils.js', 'content/adapters/auto.js'] });
    await chrome.tabs.sendMessage(tabs[0].id, { type: 'CC_AUTO_START' });
  });
  await sleep(4000);
  const prof = await sw.evaluate(async () => (await chrome.storage.local.get('siteProfiles')).siteProfiles);
  log('siteProfiles:', JSON.stringify(prof, null, 1));
  const origin = 'https://orbix-video-ly.web.app';
  const p = prof && prof[origin];
  if (p && p.rows) {
    const dom = await page.evaluate((rowsSel) => {
      const rows = Array.from(document.querySelectorAll(rowsSel));
      return rows.map(e => {
        const r = e.getBoundingClientRect();
        return { cls: (e.className || '').toString().slice(0, 50), left: Math.round(r.left), w: Math.round(r.width), txt: (e.textContent || '').trim().slice(0, 50) };
      });
    }, p.rows);
    log('rows matched:', dom.length);
    dom.forEach(r => log('row>', JSON.stringify(r)));
  }
  await ctx.close();
  fs.rmSync(userDir, { recursive: true, force: true });
  fs.rmSync(BUILD, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error('DBG-ERR', String(e).slice(0, 400)); process.exit(1); });
