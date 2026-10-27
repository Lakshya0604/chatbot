// Live pairing E2E: real Chrome + unpacked extension -> paste code -> Connect -> hosted backend.
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require('playwright-core');
const BUILD = path.resolve(__dirname, '../..');
const CODE = fs.readFileSync(process.argv[2], 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pair-')), {
    headless: false, 
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--no-sandbox'],
    viewport: { width: 900, height: 900 },
  });
  let sw; for (let i = 0; i < 40 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
  if (!sw) { console.log('FAIL no service worker'); process.exit(1); }
  const id = sw.url().split('/')[2];
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/options/options.html`);
  await page.fill('#pairCode', CODE);
  await page.click('#pairBtn');
  await page.waitForFunction(() => /Connected|nahi hua/.test(document.getElementById('pairStatus').textContent), null, { timeout: 100000 });
  console.log('STATUS:', await page.textContent('#pairStatus'));
  const st = await sw.evaluate(() => new Promise(r => chrome.storage.local.get('authToken', l => chrome.storage.sync.get('backendUrl', s => r({ tokenLen: (l.authToken || '').length, tokenPrefix: (l.authToken || '').slice(0, 5), url: s.backendUrl })))));
  console.log('STORED:', JSON.stringify(st));
  console.log('codeFieldCleared:', (await page.inputValue('#pairCode')) === '');
  await page.screenshot({ path: '/downloads/pair-live-options.png', fullPage: true });
  // real reply through the service worker bridge
  const rep = await page.evaluate(() => new Promise(r => chrome.storage.sync.get('backendUrl', s => chrome.runtime.sendMessage({ type: 'GENERATE_REPLY', payload: { backendUrl: s.backendUrl, character: { name: 'Riya', gender: 'girl', tone: 'friendly', language: 'Roman Hinglish' }, messages: [{ role: 'user', content: 'hey, kya chal raha hai?' }] } }, r))));
  console.log('REPLY via extension bridge:', JSON.stringify(rep).slice(0, 300));
  await ctx.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
