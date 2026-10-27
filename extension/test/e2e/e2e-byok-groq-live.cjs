// LIVE Groq own-key check through the real options UI. Key read from a 0600 file, never printed.
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require('playwright-core');
const BUILD = path.resolve(__dirname, '../..');
const KEY = fs.readFileSync(process.argv[2], 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-groq-')), {
    headless: false, args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--no-sandbox'], viewport: { width: 900, height: 1000 } });
  try {
    let sw; for (let i = 0; i < 40 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
    const id = sw.url().split('/')[2];
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/options/options.html`);
    await page.fill('#aiKey', KEY);
    await page.click('#aiSaveBtn');
    await page.waitForFunction(() => /Save nahi hua|Connected/.test(document.getElementById('aiStatus').textContent), null, { timeout: 60000 });
    const status = (await page.textContent('#aiStatus')).split(KEY).join('[key]');
    console.log('STATUS:', status.slice(0, 160));
    const rep = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GENERATE_REPLY', payload: { character: { name: 'Riya', gender: 'female', tone: 'friendly' }, messages: [{ role: 'user', content: 'hey kya chal raha hai?' }] } }));
    console.log('BRIDGE:', JSON.stringify({ ok: rep.ok, status: rep.status, reply: rep.data && rep.data.reply }).split(KEY).join('[key]').slice(0, 300));
    const sync = await sw.evaluate(() => new Promise((r) => chrome.storage.sync.get(null, (s) => r(JSON.stringify(s)))));
    console.log('key in sync storage:', sync.includes(KEY));
    console.log('field cleared:', (await page.inputValue('#aiKey')) === '', 'type:', await page.getAttribute('#aiKey', 'type'));
    await page.screenshot({ path: '/downloads/byok-groq-live.png' });
    await page.evaluate(() => chrome.storage.local.remove('aiConfig'));
  } finally { await ctx.close(); }
})().catch((e) => { console.log('ERR', String(e.message).slice(0, 200)); process.exit(1); });
