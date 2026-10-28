// dbg3: inject detection utils into the MAIN world of the real Orbix page and
// log every detection step (no extension involved).
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[dbg3]', ...a);
(async () => {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext()).newPage();
  await page.goto('https://orbix-video-ly.web.app/#/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input', { timeout: 90000 });
  for (const el of await page.$$('input')) {
    const t = await el.getAttribute('type');
    if (t === 'email') await el.fill(fs.readFileSync('/tmp/orbix-em.txt', 'utf8').trim());
    if (t === 'password') await el.fill(fs.readFileSync('/tmp/orbix-pw.txt', 'utf8').trim());
  }
  await page.keyboard.press('Enter');
  await page.waitForSelector('textarea', { timeout: 120000 });
  await sleep(2000);
  await page.fill('textarea', 'hi');
  await page.keyboard.press('Enter');
  await sleep(15000);
  await page.addScriptTag({ path: path.resolve(__dirname, '../../content/adapters/custom-utils.js') });
  await page.addScriptTag({ path: path.resolve(__dirname, '../../content/adapters/auto-utils.js') });
  const out = await page.evaluate(() => {
    const A = window.ChatAuto, C = window.ChatCustom;
    const composer = A.findComposer(document);
    if (!composer) return { err: 'no composer' };
    const list = A.findMessageList(document, composer);
    if (!list) return { err: 'no list' };
    const sel = C.deriveRowSelector(list.rows[0], document);
    const matched = sel ? Array.from(document.querySelectorAll(sel)) : [];
    const inC = matched.filter(m => m.parentElement === list.container);
    return {
      composer: composer.tagName + '.' + (composer.className || ''),
      container: list.container.tagName + '.' + (list.container.className || '').toString().slice(0, 60),
      rowCount: list.rows.length,
      rowClasses: list.rows.map(r => (r.className || '').toString()).slice(0, 8),
      sel, matched: matched.length, inContainer: inC.length,
      matchParents: matched.map(m => (m.parentElement.className || m.parentElement.tagName).toString().slice(0, 40)).slice(0, 10),
      containerHTML: list.container.outerHTML.slice(0, 600),
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
  process.exit(0);
})().catch(e => { console.error('ERR', String(e).slice(0, 300)); process.exit(1); });
