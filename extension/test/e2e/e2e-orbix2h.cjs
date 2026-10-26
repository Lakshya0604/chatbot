// orbix2h: FINAL b2b verification - pehle global Stop (state-aware), phir
// sidebar se b2b chat kholo, bubbles/dupes/seq padho.
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
  // state-aware stop: button "Resume all" dikhata hai to already stopped hai
  const btn = await page.$('#cc-stopall-btn');
  const label = (await btn.innerText()).trim();
  console.log('STOPBTN>', label);
  if (!/resume/i.test(label)) { await btn.click(); await sleep(500); }
  console.log('PANEL_NOW>', JSON.stringify(await page.evaluate(() => document.getElementById('cc-panel').innerText.slice(0, 100))));
  // sidebar: Chats tab -> top chat (hamara b2b)
  await page.click('text=Chats'); await sleep(1500);
  await page.screenshot({ path: SHOTS + '/13-chatlist.png' });
  const item = await page.$('.chat-item, .conv, [class*="chat"] >> nth=0');
  // generic: sidebar mein pehla clickable chat row
  const clicked = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('aside *, nav *, .side *')).filter((e) => e.children.length < 6 && (e.textContent || '').trim().length > 2 && (e.textContent || '').trim().length < 80);
    for (const c of cands) { const r = c.getBoundingClientRect(); if (r.width > 100 && r.height > 20 && r.y > 100) { c.click(); return (c.textContent || '').trim().slice(0, 60); } }
    return null;
  });
  console.log('CLICKED>', JSON.stringify(clicked));
  await sleep(4000);
  const st = await page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll('div.msg.user .bubble')).map((b) => (b.textContent || '').trim());
    const seq = Array.from(document.querySelectorAll('div.thread > div.msg')).map((r) => (r.classList.contains('user') ? 'U' : 'A')).join('');
    return { n: bubbles.length, dupes: bubbles.filter((t, i) => bubbles.indexOf(t) !== i), seq, last6: bubbles.slice(-6).map((t) => t.slice(0, 60)) };
  });
  console.log('RESULT>', JSON.stringify(st, null, 1));
  await page.screenshot({ path: SHOTS + '/14-b2b-final.png' });
  await ctx.close();
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
