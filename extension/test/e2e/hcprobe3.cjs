const { chromium } = require('playwright-core');
const os = require('os'); const fs = require('fs'); const path = require('path');
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'hc-p3-')), { headless: false, args: ['--window-size=1100,700'], viewport: { width: 1100, height: 700 } });
  const page = await ctx.newPage();
  await page.goto('https://hack.chat/?cc-probe-' + Math.random().toString(36).slice(2, 8), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  await page.fill('input[name="username"]', 'ProbeBot3');
  await page.evaluate(() => { const cb = document.querySelector('input[type=checkbox]'); if (cb && !cb.checked) cb.click(); });
  await page.getByText('Join!', { exact: false }).first().click();
  await page.waitForTimeout(3500);
  console.log('VISIBLE INPUTS:', await page.evaluate(() => Array.from(document.querySelectorAll('input, textarea, [contenteditable]')).filter((e) => e.offsetWidth || e.offsetHeight).map((e) => JSON.stringify({ tag: e.tagName, type: e.type, ph: e.placeholder, cls: (e.className || '').slice(0, 40) }))));
  console.log('FOOTER HTML:', await page.evaluate(() => { const f = document.querySelector('footer'); return f ? f.outerHTML.slice(0, 500) : 'no footer'; }));
  await page.screenshot({ path: '/tmp/hc4.png' });
  // try typing in the main area
  await page.keyboard.type('hello probe');
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/hc5.png' });
  console.log('BODYTEXT:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 350)));
  await ctx.close();
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
