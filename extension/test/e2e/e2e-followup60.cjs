// e2e-followup60.cjs - PRODUCTION-UNMODIFIED 60s follow-up proof (dummy site).
// Engine ka KOI patch NAHI (FOLLOWUP_DELAY_MS=60000 as-is). Legs:
//   setup : fresh profile -> picker + consent + AUTO on (profile save for reuse)
//   send  : outgoing -> 60s silence -> EXACTLY 1 AUTO send; cycle-2 mein no-repeat observe
//   typing: outgoing -> owner type kare (timer se pehle) -> follow-up CANCEL (no send/draft)
//   stop  : outgoing -> Stop-all (timer se pehle) -> follow-up CANCEL
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');
const SRC = path.join(__dirname, '..', '..');
const BUILD = '/tmp/cc-fu60-build';
const PROFILE = '/tmp/cc-fu60-profile';
const SHOTS = '/tmp/cc-proof';
fs.mkdirSync(SHOTS, { recursive: true });
const LEG = process.argv[2] || 'send';
if (LEG === 'setup') {
  fs.rmSync(BUILD, { recursive: true, force: true }); fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });
  fs.cpSync(SRC, BUILD, { recursive: true, filter: (x) => !x.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
  fs.copyFileSync(path.join(__dirname, 'manifest.test-relay.json'), path.join(BUILD, 'manifest.json'));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { throw new Error('FAIL: ' + label); } console.log('PASS:', label); };
const outTexts = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.msg.out')).map((m) => m.innerText));
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1280,800'],
    viewport: { width: 1280, height: 720 },
  });
  let page;
  try {
    let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
    if (LEG === 'setup') {
      await sw.evaluate(() => new Promise((r) => {
        chrome.storage.sync.set({ character: { name: 'Meera', gender: 'girl', role: 'college friend', tone: 'funny', humour: 'light teasing', replyLength: 'short', defaultMood: 'playful', vocabulary: 'Roman Hinglish' }, backendUrl: 'http://127.0.0.1:8787' }, () => chrome.storage.local.set({ authToken: 'tok123' }, r));
      }));
      page = await ctx.newPage();
      page.on('dialog', (d) => d.accept());
      await page.goto('http://127.0.0.1:8789/mock-custom.html'); await sleep(1500);
      await sw.evaluate(async () => { const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8789/*' }); await chrome.tabs.sendMessage(tabs[0].id, { type: 'CC_START_PICKER' }); });
      await sleep(500);
      await page.click('.msg.in'); await sleep(300);
      await page.click('.msg.out'); await sleep(300);
      await page.click('.composer'); await sleep(300);
      await page.click('.send-btn'); await sleep(300);
      await page.click('.chat-title'); await sleep(800);
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
      await page.click('#cc-toggle-btn'); await sleep(600);
      await page.click('#cc-toggle-btn'); await sleep(700);
      if ((await page.getAttribute('#cc-auto-btn', 'data-mode')) !== 'auto') { await page.click('#cc-auto-btn'); await sleep(400); }
      await page.evaluate(() => { document.querySelector('.composer').innerText = ''; });
      console.log('SETUP DONE: consent active + AUTO on, profile saved');
      await ctx.close(); process.exit(0);
    }
    // legs send/typing/stop: profile reuse
    page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto('http://127.0.0.1:8789/mock-custom.html');
    await page.waitForSelector('#cc-panel', { timeout: 60000 });
    await sleep(3000); // engine boot + priming
    const sb0 = await page.$('#cc-stopall-btn');
    if (/resume/i.test(await sb0.innerText())) { await sb0.click(); await sleep(500); }
    const before = (await outTexts(page)).length;
    const t0 = Date.now();
    await page.evaluate(() => { document.querySelector('.composer').innerText = 'production timer test: kal ka plan?'; });
    await page.click('.send-btn'); await sleep(400);
    if (LEG === 'typing') {
      await sleep(25000); // timer (60s) se pehle
      await page.evaluate(() => { document.querySelector('.composer').innerText = 'ruk, main khud likhti hoon'; });
      await page.evaluate(() => document.querySelector('.composer').dispatchEvent(new Event('input', { bubbles: true })));
      await sleep(45000); // 60s+gen window cross
      const outs = await outTexts(page);
      const comp = await page.evaluate(() => document.querySelector('.composer').innerText);
      ok(outs.length === before + 1, 'TYPING-CANCEL: owner typing par follow-up send NAHI hua');
      ok(comp.includes('ruk, main khud'), 'TYPING-CANCEL: owner ka text composer mein intact');
      await page.screenshot({ path: SHOTS + '/09-followup-typing-cancel.png' });
      console.log('LEG TYPING PASS', Math.round((Date.now()-t0)/1000) + 's');
    } else if (LEG === 'stop') {
      await sleep(25000);
      const sb = await page.$('#cc-stopall-btn'); await sb.click(); await sleep(500);
      await sleep(45000);
      const outs = await outTexts(page);
      ok(outs.length === before + 1, 'STOP-CANCEL: Stop-all par pending follow-up send NAHI hua');
      await page.screenshot({ path: SHOTS + '/10-followup-stop-cancel.png' });
      console.log('LEG STOP PASS', Math.round((Date.now()-t0)/1000) + 's');
    } else {
      // send: 60s silence -> EXACTLY 1 auto send; phir cycle-2 observe
      let sentAt = null;
      for (let i = 0; i < 40; i++) {
        await sleep(2500);
        const outs = await outTexts(page);
        if (outs.length === before + 2) { sentAt = Date.now(); break; }
      }
      ok(sentAt, 'AUTO follow-up send hua (60s production timer)');
      const elapsed = Math.round((sentAt - t0) / 1000);
      ok(elapsed >= 58, 'follow-up ~60s ke baad hi aaya (actual: ' + elapsed + 's)');
      const outs = await outTexts(page);
      console.log('SENT_TEXT>', JSON.stringify(outs[outs.length - 1]).slice(0, 140));
      await page.screenshot({ path: SHOTS + '/11-followup60-auto-sent.png' });
      // cycle-2 no-repeat observe: re-armed timer 60s baad fire hoga; cap use block karna chahiye
      const until = 100000 - (Date.now() - t0);
      if (until > 0) await sleep(until);
      const outs2 = await outTexts(page);
      console.log('CYCLE2_OBSERVE>', Math.round((Date.now()-sentAt)/1000) + 's post-send, outs=' + outs2.length);
      ok(outs2.length === before + 2, 'NO-REPEAT (observed window): 2nd follow-up send NAHI');
      console.log('LEG SEND PASS', Math.round((Date.now()-t0)/1000) + 's');
    }
  } finally {
    try { if (page) { const b = await page.$('#cc-stopall-btn'); if (b && !/resume/i.test(await b.innerText())) { await b.click(); await sleep(400); } console.log('EXPLICIT STOP done'); } } catch (e) { console.log('stop err', String(e).slice(0, 60)); }
    await ctx.close();
  }
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e.message || e).slice(0, 300)); process.exit(1); });
