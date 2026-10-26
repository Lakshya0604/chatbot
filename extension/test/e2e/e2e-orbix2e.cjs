// orbix2e: LATE-RESPONSE DISCARD - SUGGEST mode mein generation PENDING ho jab
// Stop all dabao, to response aane par NA draft insert ho, NA send, NA banner draft.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const SRC = path.join(__dirname, '..', '..');
const BUILD = '/tmp/cc-orbix2-build';
// fresh build (latest engine fixes)
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync(path.join(__dirname, 'manifest.test-orbix.json'), path.join(BUILD, 'manifest.json'));
const SHOTS = '/tmp/cc-orbix2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { console.log('FAIL:', label); process.exit(1); } console.log('PASS:', label); };

(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/cc-orbix-profile', {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1600,940'],
    viewport: { width: 1600, height: 900 },
  });
  let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('https://orbix-video-ly.web.app/#/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cc-panel', { timeout: 60000 });
  const sb = await page.$('#cc-stopall-btn');
  if (/resume/i.test(await sb.innerText())) { await sb.click(); await sleep(600); }
  // SUGGEST mode mein lao (auto on ho to toggle)
  if ((await page.getAttribute('#cc-auto-btn', 'data-mode')) === 'auto') { await page.click('#cc-auto-btn'); await sleep(400); }
  console.log('MODE>', await page.getAttribute('#cc-auto-btn', 'data-mode'));
  await page.fill('form.composer textarea', '');

  const bubblesBefore = await page.evaluate(() => document.querySelectorAll('div.msg.user .bubble').length);
  await page.fill('form.composer textarea', 'aaj ka mausam kaisa raha tumhara');
  await page.keyboard.press('Enter');
  // bot answer complete -> engine batch (2.5s) + backend generation shuru
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const done = await page.evaluate(() => !document.querySelector('.typing') && document.querySelectorAll('div.msg.assistant .answer').length > 0);
    if (done) break;
  }
  // generation PENDING window mein STOP ALL (batch 2.5s + backend ~4-8s; ~1s par dabao)
  await sleep(1000);
  await page.click('#cc-stopall-btn');
  console.log('STOP clicked during pending generation');
  await sleep(15000); // response aane ka poora waqt do
  const after = await page.evaluate(() => ({
    composer: document.querySelector('form.composer textarea').value,
    panel: document.getElementById('cc-panel').innerText,
    bubbles: document.querySelectorAll('div.msg.user .bubble').length,
  }));
  console.log('AFTER>', JSON.stringify({ composer: after.composer, panel: after.panel.slice(0, 200), bubbles: after.bubbles }));
  ok(after.composer.trim() === '', 'LATE DISCARD: composer KHALI - stop ke baad koi draft insert NAHI hui');
  ok(after.bubbles === bubblesBefore + 1, 'LATE DISCARD: koi AI send NAHI (sirf mera manual msg)');
  ok(!/Draft ready/.test(after.panel), 'LATE DISCARD: koi draft banner NAHI aaya stop ke baad');
  await page.screenshot({ path: SHOTS + '/09-late-discard.png' });
  console.log('ORBIX2E ALL PASS');
  await ctx.close();
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 400)); process.exit(1); });
