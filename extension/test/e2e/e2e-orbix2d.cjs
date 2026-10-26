// orbix2d: TYPING GUARD live proof - owner composer mein type kar raha ho jab AI
// reply aaye, to AI us text ko overwrite/mix/send NAHI kare (draft banner only).
const fs = require('fs');
const { chromium } = require('playwright-core');
const BUILD = '/tmp/cc-orbix2-build';
const SHOTS = '/tmp/cc-orbix2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { console.log('FAIL:', label); process.exit(1); } console.log('PASS:', label); };
const MY = 'ye mera apna draft hai, mat chhedna';

(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/cc-orbix-profile', {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1600,940'],
    viewport: { width: 1600, height: 900 },
  });
  let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
  let page; try {
  page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('https://orbix-video-ly.web.app/#/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cc-panel', { timeout: 60000 });
  // Resume all (2b mein Stop all kiya tha)
  const resumeBtn = await page.$('#cc-stopall-btn');
  const btnTxt = await resumeBtn.innerText();
  if (/resume/i.test(btnTxt)) { await resumeBtn.click(); await sleep(600); }
  // composer khaali karo (pichla unsent draft ho sakta hai)
  await page.fill('form.composer textarea', '');
  // AUTO mode hi rehna chahiye (persisted); consent active (persisted)
  console.log('STATE>', JSON.stringify(await page.evaluate(() => document.getElementById('cc-panel').innerText.slice(0, 120))));

  // manual message -> bot reply aate hi engine generate karega; US window mein type karenge
  await page.fill('form.composer textarea', 'ek aur naya joke suna');
  await page.keyboard.press('Enter');
  // bot answer complete hone ka wait
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const done = await page.evaluate(() => !document.querySelector('.typing') && document.querySelectorAll('div.msg.assistant .answer').length > 0);
    if (done) break;
  }
  // engine batch+generate window mein OWNER TYPE karta hai
  await sleep(800);
  await page.fill('form.composer textarea', MY);
  // AI reply aane ka wait (banner) - phir checks
  await sleep(12000);
  const after = await page.evaluate(() => ({
    composer: document.querySelector('form.composer textarea').value,
    panel: document.getElementById('cc-panel').innerText.slice(0, 250),
    bubbles: Array.from(document.querySelectorAll('div.msg.user .bubble')).map((b) => b.textContent.trim()),
  }));
  console.log('AFTER>', JSON.stringify(after).slice(0, 500));
  ok(after.composer === MY, 'TYPING GUARD: mera text WAISE KA WAISA (AI ne mix/overwrite NAHI kiya)');
  ok(!after.bubbles.some((b) => b !== 'ek aur naya joke suna' && b.length > 40 && !/joke|fact|hi orbix/.test(b)), 'TYPING GUARD: koi AI text send NAHI hui');
  ok(/tumhara text|Draft ready/.test(after.panel), 'panel ne draft banner dikhaya (composer mein owner text tha)');
  await page.screenshot({ path: SHOTS + '/08-typing-guard.png' });
  console.log('ORBIX2D ALL PASS');
  } finally {
    try { if (page) { const b = await page.$('#cc-stopall-btn'); if (b && !/resume/i.test(await b.innerText())) { await b.click(); await sleep(400); } console.log('EXPLICIT STOP done'); } } catch (e) { console.log('stop err', String(e).slice(0,60)); }
    await ctx.close();
  }
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 400)); process.exit(1); });
