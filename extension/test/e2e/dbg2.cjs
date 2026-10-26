const path = require('path'); const fs = require('fs'); const os = require('os');
const { chromium } = require('playwright-core');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dbg2-'));
fs.cpSync('/tmp/chatbot/extension', BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync('/tmp/chatbot/extension/test/e2e/manifest.test-custom.json', path.join(BUILD, 'manifest.json'));
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'cc-dbg2-profile'), {
    headless: false, executablePath: '/usr/bin/google-chrome',
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
  });
  await new Promise(r=>setTimeout(r,3000));
  const p = await ctx.newPage();
  await p.goto('chrome://extensions');
  await new Promise(r=>setTimeout(r,2000));
  const txt = await p.evaluate(() => document.body.innerText.slice(0, 800));
  console.log('EXT PAGE:', JSON.stringify(txt));
  const sws = ctx.serviceWorkers();
  console.log('sw count:', sws.length, sws.map(s=>s.url()));
  await ctx.close();
})().catch(e => { console.log('ERR', e.message.slice(0,300)); process.exit(1); });
