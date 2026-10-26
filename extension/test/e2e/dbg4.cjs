const path = require('path'); const fs = require('fs'); const os = require('os');
const { chromium } = require('playwright-core');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dbg4-'));
fs.cpSync('/tmp/chatbot/extension', BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync('/tmp/chatbot/extension/test/e2e/manifest.test-custom.json', path.join(BUILD, 'manifest.json'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'cc-dbg4-profile'), {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
  });
  let sw; for (let i = 0; i < 20 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
  console.log('sw:', !!sw);
  const page = await ctx.newPage();
  page.on('console', m => console.log('PAGE CONSOLE:', m.type(), m.text().slice(0,200)));
  page.on('pageerror', e => console.log('PAGE ERROR:', String(e).slice(0,300)));
  await page.goto('http://127.0.0.1:8789/mock-custom.html');
  await sleep(2000);
  const info = await page.evaluate(() => ({
    hasMock: typeof window.__mock,
    ccMarkers: !!document.getElementById('cc-panel'),
    scripts: performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('chrome-extension')).slice(0,5),
  }));
  console.log('page info:', JSON.stringify(info));
  try {
    const res = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8789/*' });
      if (!tabs.length) return 'NO TAB';
      return await chrome.tabs.sendMessage(tabs[0].id, { type: 'CC_PING' });
    });
    console.log('sendMessage result:', JSON.stringify(res));
  } catch (e) { console.log('sendMessage ERR:', String(e).slice(0,200)); }
  await ctx.close();
})().catch(e => { console.log('ERR', String(e).slice(0,300)); process.exit(1); });
