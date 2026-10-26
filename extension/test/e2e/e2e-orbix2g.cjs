// orbix2g: b2b run ka FINAL STATE verify - boot -> turant Stop all -> count/dupes/seq.
const fs = require('fs');
const { chromium } = require('playwright-core');
const BUILD = '/tmp/cc-orbix2-build';
const SHOTS = '/tmp/cc-orbix2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  // boot par engine purane (offline ke dauraan aaye) incoming par react kar sakta hai -
  // turant stop karo, phir final state padho
  await page.click('#cc-stopall-btn').catch(() => {});
  await sleep(12000); // koi in-flight/pacing window settle ho
  const st = await page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll('div.msg.user .bubble')).map((b) => (b.textContent || '').trim());
    const seq = Array.from(document.querySelectorAll('div.thread > div.msg')).map((r) => (r.classList.contains('user') ? 'U' : 'A')).join('');
    return { bubbles, seq, panel: document.getElementById('cc-panel').innerText.slice(0, 150) };
  });
  const dupes = st.bubbles.filter((t, i) => st.bubbles.indexOf(t) !== i);
  console.log('TOTAL_USER_BUBBLES>', st.bubbles.length);
  console.log('DUPES>', JSON.stringify(dupes));
  console.log('SEQ>', st.seq);
  console.log('UU_PRESENT>', /UU/.test(st.seq));
  console.log('PANEL>', JSON.stringify(st.panel));
  await page.screenshot({ path: SHOTS + '/12-b2b-final.png' });
  await ctx.close();
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
