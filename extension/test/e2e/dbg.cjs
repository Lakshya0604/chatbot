const path = require('path'); const fs = require('fs'); const os = require('os');
const { chromium } = require('playwright-core');
const SRC = path.join('/tmp/chatbot/extension');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dbg-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync('/tmp/chatbot/extension/test/e2e/manifest.test-custom.json', path.join(BUILD, 'manifest.json'));
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'cc-dbg-profile'), {
    headless: false, executablePath: '/usr/bin/google-chrome',
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
  });
  for (let i = 0; i < 40; i++) {
    const sws = ctx.serviceWorkers();
    console.log('tick', i, 'serviceWorkers:', sws.length, sws.map(s=>s.url()));
    if (sws.length) break;
    await new Promise(r=>setTimeout(r,500));
  }
  const pages = ctx.pages();
  console.log('pages:', pages.map(p=>p.url()));
  await ctx.close();
})().catch(e => { console.log('ERR', e.message.slice(0,300)); process.exit(1); });
