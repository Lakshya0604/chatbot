// Same-folder update test: dummy NON-secret values only, isolated throwaway profile, no network calls to AI providers.
const { chromium } = require('playwright'); const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const EXT = path.resolve(__dirname, '..', '..');
const idFor = p => { const h = crypto.createHash('sha256').update(p).digest('hex').slice(0, 32); return [...h].map(c => String.fromCharCode(97 + parseInt(c, 16))).join(''); };
const ok = (c, m) => { console.log(c ? 'PASS:' : 'FAIL:', m); if (!c) process.exitCode = 1; };
const sw2ok = c => c.serviceWorkers().some(w => w.url().startsWith('chrome-extension://'));
(async () => {
  const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-upd-'));
  fs.cpSync(EXT, BUILD, { recursive: true, filter: s => !s.includes(`${path.sep}test`) });
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-upd-u-'));
  const launch = () => chromium.launchPersistentContext(userDir, { headless: false, viewport: null, args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`] });
  const getSW = async c => c.serviceWorkers()[0] || await c.waitForEvent('serviceworker', { timeout: 60000 });
  let ctx = await launch(); let sw = await getSW(ctx); const id1 = new URL(sw.url()).host;
  const v1 = await sw.evaluate(() => chrome.runtime.getManifest().version);
  await sw.evaluate(async () => {
    await chrome.storage.local.set({ visionConfig: { provider: 'cloudflare', accountId: '0'.repeat(32), apiKey: 'DUMMY-NOT-A-SECRET', enabled: true }, authToken: 'DUMMY-TOKEN' });
    await chrome.storage.sync.set({ character: 'dummy character text' });
  });
  // 1) update files in the SAME folder (bump version), close browser, reopen same profile + same folder
  const mfp = path.join(BUILD, 'manifest.json'); const m = JSON.parse(fs.readFileSync(mfp, 'utf8')); m.version = '0.8.2'; fs.writeFileSync(mfp, JSON.stringify(m, null, 2));
  await ctx.close(); ctx = await launch(); sw = await getSW(ctx);
  const id2 = new URL(sw.url()).host;
  const v2 = await sw.evaluate(() => chrome.runtime.getManifest().version);
  const s = await sw.evaluate(async () => ({ l: await chrome.storage.local.get(['visionConfig', 'authToken']), y: await chrome.storage.sync.get('character') }));
  ok(id1 === id2, 'same folder: extension ID unchanged');
  ok(v1 === '0.8.1' && v2 === '0.8.2', `version updated ${v1} -> ${v2}`);
  ok(s.l.visionConfig && s.l.visionConfig.accountId === '0'.repeat(32) && s.l.visionConfig.enabled === true && s.l.authToken === 'DUMMY-TOKEN' && s.y.character === 'dummy character text', 'dummy settings preserved (local + sync)');
  await ctx.close();
})().catch(e => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
