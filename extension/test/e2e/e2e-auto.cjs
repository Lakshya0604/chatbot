// e2e-auto.cjs - AUTO mode ka poora test: REAL Chromium + REAL extension +
// REAL backend (AI_MOCK=true deterministic). KOI MANUAL PICKER NAHI -
// toolbar click -> extension khud layout detect karti hai.
// Dono direction paths: (1) attribute marker mock, (2) alignment-only hashed mock.
// Plus: streaming re-arm, self-echo guard, reload persistence, STOP gate.
// Run: backend (AI_MOCK=true, AUTH_TOKEN=tok123, 8787) + mock-auto-server (8792)
// chal rahe hon; phir: xvfb-run -a node e2e-auto.cjs
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright-core');

const SRC = path.join(__dirname, '..', '..');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-auto-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
// TEST-ONLY manifest change: dummy origin 8792 ki host permission (production
// mein ye access user ke toolbar click = activeTab se milta hai).
{
  const mf = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
  mf.host_permissions.push('http://127.0.0.1:8792/*');
  if (!mf.permissions.includes('tabs')) mf.permissions.push('tabs'); // TEST-ONLY: script se tab dhoondhne ke liye
  fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(mf));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { console.log('FAIL:', label); process.exit(1); } console.log('PASS:', label); };

async function runFlow(ctx, sw, page, mock, label) {
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
  page.on('console', (m) => console.log('CONSOLE[' + m.type() + ']:', m.text().slice(0, 200)));
  await page.goto(`http://127.0.0.1:8792/${mock}`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  page.on('dialog', (d) => d.accept());

  // Toolbar click ka simulation: background se inject + CC_AUTO_START.
  await sw.evaluate(async (mockFile) => {
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8792/*' });
    const tab = tabs.find((t) => t.url.includes(mockFile)) || tabs[0];
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/engine.js', 'content/adapters/custom-utils.js', 'content/adapters/auto-utils.js', 'content/adapters/auto.js'],
    });
    chrome.tabs.sendMessage(tab.id, { type: 'CC_AUTO_START' }, () => void chrome.runtime.lastError);
  }, mock);
  await sleep(2500);

  const origin = 'http://127.0.0.1:8792';
  const prof = await sw.evaluate((o) => chrome.storage.local.get('siteProfiles').then((x) => (x.siteProfiles || {})[o] || null), origin);
  ok(prof && prof.enabled && prof.mode === 'auto', `${label}: profile auto-save hui: ` + JSON.stringify(prof).slice(0, 200));
  ok(!prof.directionPending, `${label}: direction turant lock hui (dono sides present thi)`);
  try {
    await page.waitForSelector('#cc-panel #cc-toggle-btn', { timeout: 10000 });
  } catch (e) {
    console.log('DBG panel:', await page.evaluate(() => { const p = document.getElementById('cc-panel'); return p ? p.innerText.slice(0, 200) : 'NO PANEL'; }));
    console.log('DBG engine flag:', await page.evaluate(() => !!window.__CC_AUTO_ENGINE__), 'booted:', await page.evaluate(() => !!window.__CC_AUTO_BOOTED__));
    throw e;
  }
  ok(true, `${label}: engine panel aa gaya (koi picker nahi chala)`);

  // Consent 2-step (dialogs auto-accept)
  await page.click('#cc-toggle-btn'); await sleep(700);
  await page.evaluate(() => { const c = document.querySelector('[contenteditable="true"]'); if (c) c.innerText = ''; });
  await page.click('#cc-toggle-btn'); await sleep(800);
  ok((await page.getAttribute('#cc-toggle-btn', 'data-enabled')) === 'true', `${label}: chat consent-active`);

  // SUGGEST: incoming -> draft (send NAHI)
  await page.evaluate(() => window.__mock.receive('arre kal movie ka plan kya hai?'));
  const composerSel = prof.composer;
  let draft = '';
  for (let i = 0; i < 25 && !draft; i++) { await sleep(1000); draft = await page.evaluate((s) => { const c = document.querySelector(s); return (c.innerText || '').trim(); }, composerSel); }
  ok(draft.length > 3 && draft.includes('(mock reply)'), `${label}: SUGGEST draft aayi (deterministic mock AI): ` + draft.slice(0, 80));
  await page.evaluate((s) => { const c = document.querySelector(s); c.innerText = ''; }, composerSel);

  // STREAMING: chunks mein aaya incoming -> partial par reply nahi, poori par ek hi reply
  await page.click('#cc-auto-btn'); await sleep(500);
  ok((await page.getAttribute('#cc-auto-btn', 'data-mode')) === 'auto', `${label}: auto mode on`);
  await page.evaluate(() => window.__mock.receiveStream(['tu', 'ne kal jo kaha na,', ' wo mujhe accha laga'], 400));
  await sleep(20000);
  const outRows1 = await page.evaluate((rowsSel) => Array.from(document.querySelectorAll(rowsSel)).filter((r) => {
    return true; // counting below via text
  }).length, prof.rows);
  // Auto-sent row = latest row containing mock reply of FULL streamed text
  const sentText = await page.evaluate((rowsSel) => {
    const rows = Array.from(document.querySelectorAll(rowsSel));
    return rows.map((r) => (r.innerText || '').trim());
  }, prof.rows);
  const autoSent = sentText.filter((t) => t.includes('(mock reply)') && t.includes('wo mujhe accha laga'));
  ok(autoSent.length === 1, `${label}: STREAMING ke baad exactly 1 auto-reply, poori text par (partial par nahi): ` + JSON.stringify(autoSent).slice(0, 140));

  // SELF-ECHO GUARD: wahi text incoming ki tarah inject karo jo AI ne bheja tha -> chat Stopped
  const lastAiText = autoSent[0];
  await page.evaluate((t) => window.__mock.receive(t), lastAiText);
  await sleep(6000);
  const labelNow = await page.evaluate(() => document.getElementById('cc-toggle-btn').textContent);
  ok(labelNow === 'Stopped', `${label}: SELF-ECHO par chat Stopped (anti-loop guard): label=` + labelNow);
  return { origin, prof };
}

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-auto-p-')), {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1280,800'],
    viewport: { width: 1280, height: 720 },
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) { try { sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch (e) {} }
  if (!sw) { console.log('DEBUG: pages=', ctx.pages().length, 'sws=', ctx.serviceWorkers().length); }
  ok(sw, 'service worker registered');
  await sw.evaluate(() => new Promise((r) => {
    chrome.storage.sync.set({
      character: { name: 'Meera', gender: 'girl', role: 'college friend', tone: 'funny', replyLength: 'short' },
      backendUrl: 'http://127.0.0.1:8787',
    }, () => chrome.storage.local.set({ authToken: 'tok123' }, r));
  }));
  ok(true, 'settings seeded');

  // --- Flow 1: attribute-marker mock ---
  let page = await ctx.newPage();
  await runFlow(ctx, sw, page, 'mock-auto-attr.html', 'ATTR');
  await page.close();

  // --- Flow 2: alignment-only hashed mock ---
  await sw.evaluate(() => new Promise((r) => chrome.storage.local.remove('siteProfiles', r)));
  page = await ctx.newPage();
  const { prof } = await runFlow(ctx, sw, page, 'mock-auto-align.html', 'ALIGN');
  ok(prof.outgoingAlign === 'right', 'ALIGN: direction alignment se right=outgoing aayi');

  // Reload persistence: registered content script se engine khud boot
  await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
  await page.waitForSelector('#cc-panel #cc-toggle-btn', { timeout: 10000 });
  ok(true, 'ALIGN: reload par registered script se engine khud boot hua');

  await ctx.close();
  console.log('AUTO E2E ALL PASS');
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e && e.message || e).slice(0, 500)); process.exit(1); });
