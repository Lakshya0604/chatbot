// Read-only health probe: logs into the Orbix dummy account WITHOUT the extension, sends one English message, prints the bot's reply state. No vision calls.
const { chromium } = require('playwright'); const fs = require('fs');
const V = '/home/sandbox/.vault/orbix-dummy-test-account-extension-e2e-26f343/';
(async () => {
  const email = fs.readFileSync(V + 'username', 'utf8').trim(), pass = fs.readFileSync(V + 'password', 'utf8').trim();
  const b = await chromium.launch(); const page = await b.newPage();
  await page.goto('https://orbix-video-ly.web.app/#/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input', { timeout: 90000 });
  for (const el of await page.locator('input').all()) { const t = await el.getAttribute('type'); if (t === 'email') await el.fill(email); if (t === 'password') await el.fill(pass); }
  await page.keyboard.press('Enter');
  await page.waitForSelector('textarea', { timeout: 120000 });
  console.log('login ok');
  await page.fill('textarea', 'hello, how is your day going?'); await page.keyboard.press('Enter');
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(5000); const t = await page.evaluate(() => document.body.innerText); console.log(i, /Something went wrong|Request failed/.test(t) ? 'ERRORTEXT' : 'no-error-text', t.length); }
  const t = await page.evaluate(() => document.body.innerText); console.log(JSON.stringify(t.slice(-300)).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g,'<email>'));
  await b.close();
})().catch(e => { console.log('ERR', String(e).slice(0, 200)); process.exit(1); });
