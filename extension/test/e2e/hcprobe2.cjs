const { chromium } = require('playwright-core');
const os = require('os'); const fs = require('fs'); const path = require('path');
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'hc-p2-')), { headless: false, args: ['--window-size=1100,700'], viewport: { width: 1100, height: 700 } });
  const page = await ctx.newPage();
  await page.goto('https://hack.chat/?cc-probe-' + Math.random().toString(36).slice(2, 8), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  await page.fill('input[name="username"]', 'ProbeBot2');
  console.log('checked before:', await page.evaluate(() => { const cb = document.querySelector('input[type=checkbox]'); return cb && cb.checked; }));
  // find the visible label/element for the ToS checkbox
  console.log('tos text el:', await page.evaluate(() => { const els = Array.from(document.querySelectorAll('label, span, div')); const el = els.find((e) => (e.innerText || '').includes('I agree')); return el ? el.tagName + '.' + el.className + ' html=' + el.outerHTML.slice(0, 220) : 'none'; }));
  await page.evaluate(() => { const cb = document.querySelector('input[type=checkbox]'); if (cb && !cb.checked) cb.click(); });
  await page.waitForTimeout(400);
  console.log('checked after:', await page.evaluate(() => { const cb = document.querySelector('input[type=checkbox]'); return cb && cb.checked; }));
  await page.screenshot({ path: '/tmp/hc2.png' });
  await page.getByText('Join!', { exact: false }).first().click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: '/tmp/hc3.png' });
  console.log('BODYTEXT after join:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 300)));
  console.log('chat input visible:', await page.locator('input[placeholder*="🔤"]').first().isVisible().catch(() => false));
  await ctx.close();
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
