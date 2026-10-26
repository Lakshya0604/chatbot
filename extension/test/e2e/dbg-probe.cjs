const fs = require('fs'); const path = require('path'); const { chromium } = require('playwright-core');
const SRC = path.join(__dirname, '..', '..'); const BUILD = '/tmp/cc-orbix2-build';
(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/cc-orbix-profile', { headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1600,940'], viewport: { width: 1600, height: 900 } });
  let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await new Promise(r=>setTimeout(r,300)); }
  const page = await ctx.newPage();
  await page.goto('https://orbix-video-ly.web.app/#/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cc-panel', { timeout: 60000 });
  await page.click('text=Chats'); await page.waitForTimeout(1200);
  await page.click('text=chalo ek fun baatein karte hain'); await page.waitForTimeout(4000);
  const dom = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button.btn.primary')).map((b) => b.textContent.trim().slice(0,20));
    return { count: all.length, labels: all, storedSelFirst: document.querySelector('button.btn.primary')?.textContent };
  });
  console.log('DOM>', JSON.stringify(dom));
  const stored = await sw.evaluate(async () => await chrome.storage.local.get(null));
  const keys = Object.keys(stored).filter((k) => /custom|site|profile/i.test(k));
  console.log('STORED_KEYS>', JSON.stringify(keys));
  for (const k of keys) console.log('STORED>', k, JSON.stringify(stored[k]).slice(0, 400));
  await ctx.close(); process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0,200)); process.exit(1); });
