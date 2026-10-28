const { chromium } = require('playwright-core');
const os = require('os'); const fs = require('fs'); const path = require('path');
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'hc-probe-')), { headless: false, args: ['--window-size=1100,700'], viewport: { width: 1100, height: 700 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.log('DIALOG:', d.type(), d.message().slice(0, 80)); await d.accept('ProbeBot1'); });
  await page.goto('https://hack.chat/?cc-probe-' + Math.random().toString(36).slice(2, 8), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/hc1.png' });
  console.log('VISIBLE INPUTS:', await page.evaluate(() => Array.from(document.querySelectorAll('input, textarea, [contenteditable]')).map((e) => JSON.stringify({ tag: e.tagName, type: e.type, id: e.id, name: e.name, ph: e.placeholder, vis: !!(e.offsetWidth || e.offsetHeight), ro: e.readOnly }))));
  console.log('BUTTONS:', await page.evaluate(() => Array.from(document.querySelectorAll('button, [role="button"]')).map((e) => JSON.stringify({ t: (e.innerText || '').slice(0, 40), al: e.getAttribute('aria-label'), vis: !!(e.offsetWidth || e.offsetHeight) }))));
  console.log('BODYTEXT:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 400)));
  await ctx.close();
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
