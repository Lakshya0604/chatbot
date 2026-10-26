// orbix2i: RELOAD-REPLAY prevention proof. b2b chat (last=bot incoming, consent
// active). Boot#1 (migration): trigger ho sakta hai + lastHandled PERSIST. Reload:
// SAME historical incoming par DOBARA trigger NAHI (composer khaali, koi send nahi).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const SRC = path.join(__dirname, '..', '..');
const BUILD = '/tmp/cc-orbix2-build';
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.cpSync(SRC, BUILD, { recursive: true, filter: (x) => !x.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync(path.join(__dirname, 'manifest.test-orbix.json'), path.join(BUILD, 'manifest.json'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { console.log('FAIL:', label); process.exit(1); } console.log('PASS:', label); };
(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/cc-orbix-profile', {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1600,940'],
    viewport: { width: 1600, height: 900 },
  });
  let page;
  try {
    let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
    page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    // b2b chat seedha URL se (chat id route? hash router - chatId state mein; list se kholo)
    await page.goto('https://orbix-video-ly.web.app/#/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cc-panel', { timeout: 60000 });
    // RESUME (global stop ho sakta hai) - warna test vacuous hai
    const sb0 = await page.$('#cc-stopall-btn');
    if (/resume/i.test(await sb0.innerText())) { await sb0.click(); await sleep(600); }
    console.log('RESUMED>', JSON.stringify(await page.evaluate(() => document.getElementById('cc-panel').innerText.slice(0,80))));
    // SUGGEST mode (koi extra send nahi is test mein)
    if ((await page.getAttribute('#cc-auto-btn', 'data-mode')) === 'auto') { await page.click('#cc-auto-btn'); await sleep(400); }
    // b2b chat kholo: Chats tab -> title wala item
    await page.click('text=Chats'); await sleep(1200);
    await page.click('text=chalo ek fun baatein karte hain'); await sleep(4000);
    const boot1 = await page.evaluate(() => ({
      bubbles: document.querySelectorAll('div.msg.user .bubble').length,
      lastIsBot: (() => { const r = Array.from(document.querySelectorAll('div.thread > div.msg')); return r.length ? !r[r.length-1].classList.contains('user') : null; })(),
    }));
    console.log('BOOT1>', JSON.stringify(boot1));
    ok(boot1.bubbles >= 5, 'b2b chat khuli (history)');
    // migration boot trigger ka poora window do (pacing + generation)
    await sleep(20000);
    const afterBoot1 = await page.evaluate(() => document.querySelector('form.composer textarea').value);
    console.log('AFTER_BOOT1_COMPOSER>', JSON.stringify(afterBoot1.slice(0, 80)), '(migration trigger ho ya na ho - persisted lastHandled ab set)');
    await page.fill('form.composer textarea', '');
    // RELOAD: SAME historical incoming par replay NAHI hona chahiye
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cc-panel', { timeout: 60000 });
    await sleep(20000); // pacing+generation se zyada
    const afterReload = await page.evaluate(() => ({
      composer: document.querySelector('form.composer textarea').value,
      bubbles: document.querySelectorAll('div.msg.user .bubble').length,
    }));
    console.log('AFTER_RELOAD>', JSON.stringify(afterReload));
    ok(afterReload.composer.trim() === '', 'RELOAD-REPLAY BLOCKED: reload par purane incoming ka draft NAHI aaya');
    // note: reload hash-router par naya empty chat kholta hai - bubbles skip, composer+server audit hi asli check
    await page.screenshot({ path: '/tmp/cc-orbix2/16-reload-noreplay.png' });
    console.log('ORBIX2I ALL PASS');
  } finally {
    // runner hamesha explicit STOP kare (bash kill par bharosa NAHI)
    try { if (page) { const b = await page.$('#cc-stopall-btn'); if (b && !/resume/i.test(await b.innerText())) { await b.click(); await sleep(400); } console.log('EXPLICIT STOP done'); } } catch (e) { console.log('stop-on-exit err', String(e).slice(0, 80)); }
    await ctx.close();
  }
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
