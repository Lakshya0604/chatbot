// REAL chatgpt.com (guest, signed out) via CUSTOM mode. Real extension v0.7.2 build; test manifest only adds
// host permission for chatgpt.com (stands in for the activeTab grant of a toolbar click).
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require('playwright-core');
const SRC = path.resolve(__dirname, '../..');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gpt-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}`) && !s.includes('node_modules') });
const mf = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
mf.host_permissions.push('https://chatgpt.com/*');
fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(mf));
const KEY = fs.readFileSync(process.argv[2], 'utf8').trim();
const STAGE = process.argv[3] || 'all';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (p, n) => p.screenshot({ path: `/tmp/gpt/${n}.png` }).catch(() => {});
const step = (m) => console.log('STEP:', m);
const ok = (c, l) => { console.log(c ? 'PASS:' : 'FAIL:', l); if (!c) throw new Error('FAIL ' + l); };
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gpt-p-')), {
    headless: false, viewport: null,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--no-sandbox', '--window-size=1100,740', '--window-position=0,0'],
  });
  let sw;
  try {
    for (let i = 0; i < 40 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
    await sw.evaluate((k) => new Promise((r) => chrome.storage.sync.set({ character: { name: 'Meera', gender: 'female', tone: 'funny', role: 'college friend', replyLength: 'short' } }, () => chrome.storage.local.set({ aiConfig: { provider: 'groq', apiKey: k, model: '' } }, r))), KEY);
    const page = await ctx.newPage();
    page.on('dialog', async (d) => { console.log('DIALOG:', d.message().slice(0, 80)); await d.accept(); console.log('LAST:', await page.evaluate(() => document.documentElement.getAttribute('data-cc-last')).catch(() => '?')); });
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
    await sleep(6000); await shot(page, '01-home');
    // dismiss cookie banner if any
    for (const t of ['Accept all', 'Reject non-essential', 'Stay logged out']) { const b = page.getByText(t, { exact: false }).first(); if (await b.count()) { await b.click().catch(() => {}); await sleep(500); } }
    const cap = (t) => page.evaluate((t) => { let c = document.getElementById('demo-cap'); if (!c) { c = document.createElement('div'); c.id = 'demo-cap'; c.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483000;background:#111;color:#fff;font:600 16px sans-serif;padding:8px 14px;border-bottom:3px solid #f5a623;pointer-events:none'; document.body.appendChild(c); } c.textContent = t; }, t).catch(() => {});
    const comp = () => page.locator('textarea[name="prompt"]').first();
    const sendBtn = () => page.getByRole('button', { name: 'Send message' }).first();
    const typeSend = async (text) => { await comp().click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); await sleep(300); await page.keyboard.type(text, { delay: 25 }); await sleep(600); console.log('TYPED composer=', JSON.stringify(await comp().inputValue()), 'streaming=', await page.evaluate(() => !!document.querySelector('button[aria-label^="Stop"]')), 'dis=', await page.evaluate(() => { const b = document.querySelector('button[aria-label^="Send message"]'); return b ? b.outerHTML.slice(0, 0) + b.hasAttribute('data-visually-disabled') + '/' + b.disabled : 'nobtn'; })); await shot(page, 'typed'); await page.keyboard.press('Enter'); };
    const nIn = () => page.locator('section[aria-label="DIL content"]').count();
    await cap('REAL chatgpt.com (signed out guest, brand-new test chat). Extension v0.7.2 CUSTOM mode. Captions describe only what was observed.');
    await sleep(3000);
    step('owner types first message');
    await comp().click(); await page.keyboard.type('Hi! I am testing a chat helper extension. Please reply with one short friendly line.', { delay: 25 });
    await sleep(500); await sendBtn().click();
    for (let i = 0; i < 40 && (await nIn()) < 1; i++) await sleep(1000);
    await sleep(8000); await shot(page, '03-first');
    ok(await nIn() >= 1, 'chatgpt replied to first message');
    // picker (what the toolbar click does)
    await cap('Step 1: picker started (test stands in for toolbar click). Picking: their message, my message, typing box, send');
    await comp().click(); await page.keyboard.type('x'); await sleep(400); // send button needs text to exist
    await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
      const tab = tabs[0];
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/engine.js', 'content/adapters/custom-utils.js', 'content/adapters/custom.js'] });
      chrome.tabs.sendMessage(tab.id, { type: 'CC_START_PICKER' }, () => void chrome.runtime.lastError);
    });
    await page.waitForSelector('#cc-picker-bar', { timeout: 10000 }); await shot(page, '04-picker');
    await page.locator('section[aria-label="DIL content"]').first().click(); await sleep(800);
    await page.locator('ol[aria-label="Conversation"] > li').first().getByText('Hi! I am testing', { exact: false }).first().click(); await sleep(800);
    await comp().click(); await sleep(800);
    await sendBtn().click(); await sleep(800);
    await shot(page, '05-picked-send');
    const skip = page.locator('#cc-picker-bar button', { hasText: /skip/i }).first();
    if (await skip.count()) await skip.click(); await sleep(1500);
    const prof = await sw.evaluate(() => new Promise((r) => chrome.storage.local.get('siteProfiles', r)));
    ok(prof.siteProfiles && prof.siteProfiles['https://chatgpt.com'], 'profile saved for chatgpt.com: ' + JSON.stringify(prof.siteProfiles && prof.siteProfiles['https://chatgpt.com']).slice(0, 300));
    await comp().fill('');
    await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
      await chrome.tabs.reload(tabs[0].id);
    });
    await sleep(7000);
    await page.waitForSelector('#cc-panel', { timeout: 15000 }); await shot(page, '06-panel');
    console.log('AFTER-RELOAD URL:', page.url(), 'LI:', await page.locator('ol[aria-label="Conversation"] > li').count());
    await cap('Observed: extension panel is present after reload. Guest chat resets on reload, so sending a fresh opening message');
    await comp().click(); await page.keyboard.type('Hello again! Reply with one short friendly line please.', { delay: 25 }); await sleep(400); await sendBtn().click();
    for (let i = 0; i < 40 && (await nIn()) < 1; i++) await sleep(1000);
    await sleep(8000);
    console.log('NEWCHAT URL:', page.url(), 'LI:', await page.locator('ol[aria-label="Conversation"] > li').count(), 'ROLES:', JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('ol[aria-label^="Conversation"] > li')).map((l) => l.getAttribute('data-message-role')))));
    await shot(page, '06b-newchat');
    console.log('DOM:', JSON.stringify(await page.evaluate(() => { const a = document.querySelector('section[aria-label="DIL content"]'); const out = []; let n = a; for (let i = 0; i < 9 && n; i++, n = n.parentElement) out.push(n.tagName + (n.getAttribute('aria-label') ? '[aria-label=' + n.getAttribute('aria-label') + ']' : '') + (n.getAttribute('data-message-role') ? '[role=' + n.getAttribute('data-message-role') + ']' : '') ); return out; }))); ok(true, 'engine panel present on chatgpt.com after reload (profile boot)');
    await cap('Step 2: pressing AI on twice (consent step). ChatGPT is a bot, so this test just accepts the dialog');
    await page.click('#cc-toggle-btn'); await sleep(2500);
    console.log('composer after consent1:', JSON.stringify(await comp().inputValue()).slice(0, 80));
    await comp().fill('');
    await page.click('#cc-toggle-btn'); await sleep(1500);
    ok((await page.getAttribute('#cc-toggle-btn', 'data-enabled')) === 'true', 'chat consent-active');
    await cap('Step 3: sending a test message, then waiting to see whether a draft appears in the typing box');
    console.log('PRE-STEP3 URL:', page.url(), 'LI:', await page.locator('ol[aria-label="Conversation"] > li').count());
    const out0 = await page.locator('[data-message-author-role], section[aria-label="DIL content"]').count();
    await typeSend('Cool. Do you like movies?');
    const n0 = await nIn();
    for (let i = 0; i < 40 && (await nIn()) <= n0 - 0 && (await nIn()) < 2; i++) await sleep(1000);
    await sleep(2000);
    let draft = ''; for (let i = 0; i < 40 && !draft.trim(); i++) { await sleep(1000); draft = await comp().inputValue(); }
    await shot(page, '07-draft');
    console.log('BODY:', JSON.stringify(await page.evaluate(() => document.body.innerText.slice(0, 500))), 'DIL:', await nIn());
    console.log('PANEL:', JSON.stringify(await page.evaluate(() => (document.getElementById('cc-panel') || {}).innerText)), 'URL:', page.url(), 'ROLES:', JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('ol[aria-label^="Conversation"] > li')).map((l) => l.getAttribute('data-message-role') + ':' + l.innerText.slice(0, 25)))));
    await cap(draft.trim().length > 3 ? 'Observed: a draft is in the typing box (not sent): ' + draft.trim().slice(0, 70) : 'Observed: typing box is EMPTY - no draft appeared');
    await sleep(2500);
    console.log('DRAFT:', JSON.stringify(draft).slice(0, 120));
    ok(draft.trim().length > 3, 'AI draft in ChatGPT typing box (not sent)');
    ok((await nIn()) === 2, 'chatgpt answered 2 times; nothing auto-sent in suggest mode');
    await sleep(3000);
    await comp().fill('');
    await cap('Step 4: Auto turned on; sending another test message and watching for an extension send');
    await page.click('#cc-auto-btn'); await sleep(1500);
    await typeSend('Haha nice. Tell me one fun fact in one line.');
    for (let i = 0; i < 60 && (await nIn()) < 3; i++) await sleep(1000);
    let userCount = 0; for (let i = 0; i < 60; i++) { await sleep(1000); userCount = await page.locator('h4', { hasText: 'You said' }).count(); if (userCount >= 4) break; }
    await shot(page, '08-autosent');
    await cap(userCount >= 4 ? 'Observed: a 4th user turn appeared (extension auto-sent)' : 'Observed: NO auto-send happened (user turns: ' + userCount + ')');
    await sleep(2500);
    console.log('user turns visible:', userCount, '(3 typed by test operator = 3 turns; 4th = extension auto-send)');
    ok(userCount >= 4, 'AUTO-SEND happened: extension sent a reply into ChatGPT by itself');
    await page.click('#cc-stopall-btn').catch(() => {}); await sleep(1500);
    await cap('Step 5: Stop all pressed. ChatGPT guest test only; not WhatsApp/Telegram');
    await sleep(5000); await shot(page, '09-final');
    console.log('CHATGPT CUSTOM-MODE FLOW PASS');
  } finally {
    try { await sw.evaluate(() => new Promise((r) => chrome.storage.local.remove('aiConfig', r))); } catch (e) {}
    await ctx.close();
  }
})().catch((e) => { console.log('ERR', String(e.message).slice(0, 700)); process.exit(1); });
