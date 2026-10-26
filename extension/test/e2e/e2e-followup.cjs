// e2e-followup.cjs - PROACTIVE FOLLOW-UP ka live proof (dummy site, REAL extension +
// REAL backend/Groq). Sirf BUILD copy mein FOLLOWUP_DELAY_MS 60s->5s (production
// source untouched; unit fixture override path pehle se maujood hai).
// Verify: (1) last outgoing ke baad silence -> EXACTLY 1 follow-up draft,
// (2) continued silence par 2nd follow-up NAHI (per-episode cap),
// (3) naya incoming ke baad counter reset + naye outgoing par re-arm,
// (4) runner hamesha explicit STOP.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright-core');
const SRC = path.join(__dirname, '..', '..');
const SHOTS = '/tmp/cc-proof';
fs.mkdirSync(SHOTS, { recursive: true });
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-fu-'));
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync(path.join(__dirname, 'manifest.test-relay.json'), path.join(BUILD, 'manifest.json'));
{
  let eng = fs.readFileSync(path.join(BUILD, 'content', 'engine.js'), 'utf8');
  if (!eng.includes('TEST.FOLLOWUP_DELAY_MS || 60000')) { console.log('FAIL: followup const missing'); process.exit(1); }
  eng = eng.replace('TEST.FOLLOWUP_DELAY_MS || 60000', 'TEST.FOLLOWUP_DELAY_MS || 5000');
  fs.writeFileSync(path.join(BUILD, 'content', 'engine.js'), eng);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { throw new Error('FAIL: ' + label); } console.log('PASS:', label); };
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-fup-')), {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1280,800'],
    viewport: { width: 1280, height: 720 },
  });
  let page;
  try {
    let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
    await sw.evaluate(() => new Promise((r) => {
      chrome.storage.sync.set({ character: { name: 'Meera', gender: 'girl', role: 'college friend', tone: 'funny', humour: 'light teasing', replyLength: 'short', defaultMood: 'playful', vocabulary: 'Roman Hinglish' }, backendUrl: 'http://127.0.0.1:8787' }, () => chrome.storage.local.set({ authToken: 'tok123' }, r));
    }));
    page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto('http://127.0.0.1:8789/mock-custom.html');
    await sleep(1500);
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
    await page.evaluate(() => { document.querySelector('.composer').innerText = ''; });
    console.log('SETUP> consent active, SUGGEST mode');

    // STEP 1: naya outgoing -> silence -> EXACTLY 1 follow-up draft (~5s+gen)
    await page.evaluate(() => { document.querySelector('.composer').innerText = 'bhai ek kaam tha, kal milte hain'; });
    await page.click('.send-btn'); await sleep(500);
    await sleep(12000); // 5s timer + pacing + real generation
    const fu1 = await page.evaluate(() => ({ c: document.querySelector('.composer').innerText, b: (document.getElementById('cc-banner') || {}).innerText || '' }));
    console.log('FU1>', JSON.stringify(fu1).slice(0, 220));
    ok(fu1.c.trim().length > 3, 'silence ke baad 1 follow-up draft aayi');
    console.log('FU1_BANNER_NOTE>', JSON.stringify(fu1.b.slice(0,90)), '(transient follow-up banner generation ke baad draft-banner se replace ho jata hai - racy, isliye assert nahi)');
    await page.screenshot({ path: SHOTS + '/07-followup-draft.png' });

    // STEP 2: silence jaari -> 2nd follow-up NAHI (cap 1 per episode)
    await sleep(13000);
    const fu2 = await page.evaluate(() => document.querySelector('.composer').innerText);
    ok(fu2 === fu1.c, '2nd follow-up NAHI aaya (composer unchanged, cap=1)');

    // STEP 3: follow-up send karo -> incoming aaya (reset) -> jawab send karo -> phir silence -> follow-up DOBARA arm
    await page.click('.send-btn'); await sleep(600); // follow-up bheja (outgoing observed, re-arm)
    await page.evaluate(() => window.__mock.receive('haan bhai, kal kitne baje?')); // incoming -> reset+cancel
    await sleep(12000); // pacing + generation (jawab draft)
    const reply = await page.evaluate(() => document.querySelector('.composer').innerText);
    ok(reply.trim().length > 3, 'incoming par normal jawab draft aayi');
    await page.click('.send-btn'); await sleep(600); // jawab bheja -> naya outgoing -> re-arm
    await sleep(13000); // nayi silence -> naya follow-up
    const fu3 = await page.evaluate(() => document.querySelector('.composer').innerText);
    console.log('FU3>', JSON.stringify(fu3).slice(0, 120));
    ok(fu3.trim().length > 3, 'reset ke baad naye episode mein follow-up phir aaya');
    await page.screenshot({ path: SHOTS + '/08-followup-rearm.png' });
    console.log('FOLLOWUP E2E ALL PASS');
  } finally {
    try { if (page) { const b = await page.$('#cc-stopall-btn'); if (b && !/resume/i.test(await b.innerText())) { await b.click(); await sleep(400); } console.log('EXPLICIT STOP done'); } } catch (e) { console.log('stop err', String(e).slice(0, 60)); }
    await ctx.close();
  }
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e.message || e).slice(0, 300)); process.exit(1); });
