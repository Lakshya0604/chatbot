const path = require('path'); const fs = require('fs'); const os = require('os');
const { chromium } = require('playwright-core');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dbg10-'));
fs.cpSync('/tmp/chatbot/extension', BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync('/tmp/chatbot/extension/test/e2e/manifest.test-custom.json', path.join(BUILD, 'manifest.json'));
// instrument background
let bg = fs.readFileSync(path.join(BUILD, 'background.js'), 'utf8');
bg = "globalThis.__dbg=[];\n" + bg.replace(
  "if (!request || request.type !== 'GENERATE_REPLY') return false;",
  "globalThis.__dbg.push('msg type=' + (request && request.type));\n  if (!request || request.type !== 'GENERATE_REPLY') return false;");
console.log('bg patched:', bg.includes('__dbg.push'));
fs.writeFileSync(path.join(BUILD, 'background.js'), bg);
// instrument custom.js: on CC_START_PICKER, first test runtime.sendMessage round-trip
let cu = fs.readFileSync(path.join(BUILD, 'content', 'adapters', 'custom.js'), 'utf8');
const hook = cu.includes("CC_START_PICKER");
cu = cu.replace(/if \(msg\.type === 'CC_START_PICKER'\) \{/,
  `if (msg.type === 'CC_START_PICKER') {
    try {
      chrome.runtime.sendMessage({ type: 'GENERATE_REPLY', payload: { character: {name:'Meera'}, messages: [{role:'user',content:'hi'}], backendUrl: 'http://127.0.0.1:8787' } })
        .then((r) => document.documentElement.setAttribute('data-msgtest', 'RESP:' + JSON.stringify(r).slice(0,200)))
        .catch((e) => document.documentElement.setAttribute('data-msgtest', 'CATCH:' + String(e).slice(0,200)));
    } catch (e) { document.documentElement.setAttribute('data-msgtest', 'THROW:' + String(e).slice(0,200)); }
  }
  if (msg.type === 'CC_START_PICKER') {`);
console.log('custom hook present:', hook, 'patched:', cu.includes('data-msgtest'));
fs.writeFileSync(path.join(BUILD, 'content', 'adapters', 'custom.js'), cu);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'cc-dbg10-profile'), {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
  });
  let sw; for (let i = 0; i < 20 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
  console.log('sw:', !!sw);
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8789/mock-custom.html');
  await sleep(1500);
  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8789/*' });
    await chrome.tabs.sendMessage(tabs[0].id, { type: 'CC_START_PICKER' });
  });
  await sleep(8000);
  const res = await page.evaluate(() => document.documentElement.getAttribute('data-msgtest') || '(none)');
  console.log('MSGTEST>', res);
  for (const w of ctx.serviceWorkers()) { try { console.log('SWDBG>', await w.evaluate(() => (globalThis.__dbg || []).join(' | '))); } catch (e) { console.log('SWDBG err', String(e).slice(0,80)); } }
  await ctx.close();
})().catch(e => { console.log('ERR', String(e).slice(0,300)); process.exit(1); });
