const path = require('path'); const fs = require('fs'); const os = require('os');
const { chromium } = require('playwright-core');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dbg6-'));
fs.cpSync('/tmp/chatbot/extension', BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync('/tmp/chatbot/extension/test/e2e/manifest.test-custom.json', path.join(BUILD, 'manifest.json'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'cc-dbg6-profile'), {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
  });
  let sw; for (let i = 0; i < 20 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
  console.log('sw:', !!sw);
  const health = await sw.evaluate(() => fetch('http://127.0.0.1:8787/health').then(r=>r.status).catch(e=>'ERR:'+String(e)));
  console.log('SW fetch health:', health);
  const reply = await sw.evaluate(() => fetch('http://127.0.0.1:8787/reply', {
    method:'POST', headers:{'Content-Type':'application/json','X-Chatbot-Token':'tok123'},
    body: JSON.stringify({character:{name:'Meera'}, messages:[{role:'user',content:'hi'}]}),
  }).then(async r=>({status:r.status, body:(await r.text()).slice(0,200)})).catch(e=>'ERR:'+String(e)));
  console.log('SW fetch /reply:', JSON.stringify(reply));
  await ctx.close();
})().catch(e => { console.log('ERR', String(e).slice(0,300)); process.exit(1); });
