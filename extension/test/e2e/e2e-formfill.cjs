// e2e-formfill: packaged extension production path - SW executeScript(formfill.js)
// + CC_FILL_FORM message; approved fields fill, sensitive skip, submit KABHI nahi.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');
const SRC = path.join(__dirname, '..', '..');
const BUILD = '/tmp/cc-formfill-build';
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync(path.join(__dirname, 'manifest.test-relay.json'), path.join(BUILD, 'manifest.json'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { console.log('FAIL:', label); process.exit(1); } console.log('PASS:', label); };
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(require('os').tmpdir(), 'cc-ff-')), {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
  });
  let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
  ok(sw, 'SW registered');
  await sw.evaluate(() => new Promise((r) => chrome.storage.sync.set({
    formProfile: { name: 'Test User', email: 'test.user@example.com', phone: '9999999999' },
  }, r)));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8789/form.html', { waitUntil: 'domcontentloaded' });
  // production path: background.js jaisa executeScript + CC_FILL_FORM
  const res = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1:8789/*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/formfill.js'] });
    return new Promise((r) => chrome.tabs.sendMessage(tab.id, { type: 'CC_FILL_FORM' }, r));
  });
  console.log('RESULT>', JSON.stringify(res));
  ok(res && res.ok, 'CC_FILL_FORM ok');
  const v = await page.evaluate(() => ({
    name: document.querySelector('[name=name]').value,
    email: document.querySelector('[name=email]').value,
    phone: document.querySelector('[name=phone]').value,
    password: document.querySelector('[name=password]').value,
    otp: document.querySelector('[name=otp]').value,
    card: document.querySelector('[name=card]').value,
    banner: (document.getElementById('cc-fill-banner') || {}).textContent || '',
    url: location.href,
  }));
  console.log('FIELDS>', JSON.stringify(v));
  ok(v.name === 'Test User' && v.email === 'test.user@example.com' && v.phone === '9999999999', 'approved fields bhari gayi');
  ok(v.password === '' && v.otp === '' && v.card === '', 'SENSITIVE (password/OTP/card) KHAALI - kabhi auto-fill nahi');
  ok(/review|Submit/i.test(v.banner), 'review banner dikhaya');
  ok(!/submitted/.test(v.url), 'SUBMIT NAHI hua (url unchanged)');
  await page.screenshot({ path: '/tmp/cc-orbix2/15-formfill.png' });
  console.log('FORMFILL E2E ALL PASS');
  await ctx.close();
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
