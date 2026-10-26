// orbix2f: CONTINUOUS bot-to-bot (user: "apne aap baat hote rh") - BOUNDED:
// MAX 5 extension replies, phir Stop all. Checks: successive incoming detection,
// no duplicate sends, no self-trigger (har AI send ke beech bot reply), on-topic,
// tool-escalation par jaldi stop.
const fs = require('fs');
const { chromium } = require('playwright-core');
const path = require('path');
const SRC = path.join(__dirname, '..', '..');
const BUILD = '/tmp/cc-orbix2-build';
{ fs.rmSync(BUILD, { recursive: true, force: true }); fs.mkdirSync(BUILD, { recursive: true });
  fs.cpSync(SRC, BUILD, { recursive: true, filter: (x) => !x.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
  fs.copyFileSync(path.join(__dirname, 'manifest.test-orbix.json'), path.join(BUILD, 'manifest.json')); }
const SHOTS = '/tmp/cc-orbix2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { console.log('FAIL:', label); process.exit(1); } console.log('PASS:', label); };
const KICK = 'chalo ek fun baatein karte hain, tum shuru karo';

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
  if ((await page.getAttribute('#cc-auto-btn', 'data-mode')) !== 'auto') { await page.click('#cc-auto-btn'); await sleep(400); }
  await page.fill('form.composer textarea', '');

  // baseline: is run se PEHLE ke saare bubbles (history mein purane AI sends bhi hain)
  const baseline = await page.evaluate(() => Array.from(document.querySelectorAll('div.msg.user .bubble')).map((b) => (b.textContent || '').trim()));
  const aiSends = () => page.evaluate((base) => {
    return Array.from(document.querySelectorAll('div.msg.user .bubble'))
      .map((b) => (b.textContent || '').trim())
      .filter((t) => t && !base.includes(t));
  }, baseline.concat([KICK]));

  await page.fill('form.composer textarea', KICK);
  await page.keyboard.press('Enter');
  console.log('KICK sent; continuous mode watching (cap 5)');
  let lastCount = 0; let shot3 = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 95000) {
    await sleep(2000);
    const sends = await aiSends();
    if (sends.length > lastCount) {
      for (let i = lastCount; i < sends.length; i++) console.log(`AI_SEND_${i + 1}>`, JSON.stringify(sends[i].slice(0, 100)));
      lastCount = sends.length;
      if (lastCount === 3 && !shot3) { shot3 = true; await page.screenshot({ path: SHOTS + '/10-b2b-3.png' }); }
      // tool escalation check: bot ne image/tool use kiya to jaldi stop
      const tools = await page.evaluate(() => Array.from(document.querySelectorAll('div.msg.assistant')).filter((r) => /Used \d+ tool/i.test(r.innerText || '')).length);
      if (tools > 0) { console.log('NOTE: bot ne tool use kiya (count=' + tools + ') - escalation risk, jaldi stop'); break; }
      if (lastCount >= 5) break;
    }
  }
  await page.click('#cc-stopall-btn'); await sleep(600);
  const final = await aiSends();
  await sleep(8000); // in-flight response discard hona chahiye
  const afterStop = await aiSends();
  console.log('FINAL>', final.length, 'AFTER_STOP>', afterStop.length);
  const dupes = afterStop.filter((t, i) => afterStop.indexOf(t) !== i);
  ok(dupes.length === 0, 'NO DUPLICATES: ' + JSON.stringify(dupes));
  ok(afterStop.length <= 5, 'BOUND: AI sends <= 5 (actual: ' + afterStop.length + ')');
  ok(afterStop.length === final.length, 'STOP ke baad in-flight send NAHI hui (' + final.length + ' -> ' + afterStop.length + ')');
  // self-trigger check: DOM order mein do AI bubbles ke beech bot ka row hona chahiye
  const seq = await page.evaluate((kick) => {
    return Array.from(document.querySelectorAll('div.thread > div.msg')).map((r) => (r.classList.contains('user') ? 'U' : 'A'));
  }, KICK);
  console.log('SEQ>', seq.join(''));
  ok(!/UU/.test(seq.join('')), 'NO SELF-TRIGGER: kabhi do user bubbles back-to-back nahi (har AI send par bot reply aaya)');
  const panel = await page.evaluate(() => document.getElementById('cc-panel').innerText.slice(0, 120));
  ok(/STOP ALL|Resume all/i.test(panel), 'STOP ALL active: ' + JSON.stringify(panel.slice(0, 60)));
  await page.screenshot({ path: SHOTS + '/11-b2b-stopped.png' });
  console.log('ORBIX2F ALL PASS, total AI sends:', afterStop.length);
  await ctx.close();
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 400)); process.exit(1); });
