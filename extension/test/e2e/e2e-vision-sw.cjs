// e2e-vision-sw.cjs - browser smoke: MV3 service worker mein vision path.
// 1) SW boot with lib/vision.js importScripts  2) lazy LangChain bundle load
// 3) full INTERPRET_CHAT_IMAGE handler via options page -> SW (mock provider)
const path = require('path'); const fs = require('fs'); const os = require('os');
const { chromium } = require('playwright-core');
const SRC = path.join(__dirname, '..', '..');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-vision-build-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}`) });
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'cc-vision-profile'), {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--no-sandbox'],
  });
  let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await new Promise(r => setTimeout(r, 300)); }
  if (!sw) throw new Error('service worker start nahi hua');
  console.log('PASS sw boot:', sw.url());
  const extId = sw.url().split('/')[2];

  // 2) LangChain bundle statically loaded in MV3 SW (runtime importScripts MV3 mein fail hota hai)
  const bundleType = await sw.evaluate(() => typeof CCLangChainVision !== 'undefined' && typeof CCLangChainVision.interpretChatImage);
  if (bundleType !== 'function') throw new Error('bundle not loaded: ' + bundleType);
  console.log('PASS langchain bundle statically loaded in MV3 SW');

  // 3) full handler via options page -> SW, mock provider
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/options/options.html`);
  const res = await page.evaluate(async () => {
    await chrome.storage.local.set({ visionConfig: { provider: 'mock', mockReply: '{"messages":[{"side":"left","text":"hi"},{"side":"right","text":"hello"},{"side":"left","text":"free ho?"}]}' } });
    return await chrome.runtime.sendMessage({ type: 'INTERPRET_CHAT_IMAGE', payload: { imageBase64: 'aGk=', mimeType: 'image/png' } });
  });
  if (!res || !res.ok) throw new Error('handler fail: ' + JSON.stringify(res));
  if (res.data.chat.length !== 3 || res.data.chat[2].role !== 'user') throw new Error('bad mapping: ' + JSON.stringify(res.data));
  console.log('PASS INTERPRET_CHAT_IMAGE handler mock:', JSON.stringify(res.data.chat));

  // 4) fail-closed: garbage image config missing -> clean error, no key leak
  const res2 = await page.evaluate(async () => {
    await chrome.storage.local.set({ visionConfig: { provider: 'mock', mockReply: 'sorry cannot see' } });
    return await chrome.runtime.sendMessage({ type: 'INTERPRET_CHAT_IMAGE', payload: { imageBase64: 'aGk=' } });
  });
  if (res2.ok || !/JSON nahi/.test(res2.error)) throw new Error('fail-closed broken: ' + JSON.stringify(res2));
  console.log('PASS fail-closed on unparseable vision output:', res2.error.slice(0, 60));

  await ctx.close();
  console.log('ALL VISION SW CHECKS PASSED');
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
