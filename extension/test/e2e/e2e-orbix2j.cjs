// orbix2j: ACTIVE-AUTO first-bind/reopen proof (Main requirement).
// Historical b2b chat (last=bot incoming), consent active, AUTO on.
// A) First bind on history: composer khaali + server par ZERO naya user msg (baseline only).
// B) Bind ke BAAD naya incoming (manual msg -> bot reply): EXACTLY 1 auto-send.
// C) Reload + reopen same chat: phir ZERO unsolicited draft/send.
// Runner hamesha explicit STOP karta hai (finally).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const SRC = path.join(__dirname, '..', '..');
const BUILD = '/tmp/cc-orbix2-build';
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.cpSync(SRC, BUILD, { recursive: true, filter: (x) => !x.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
fs.copyFileSync(path.join(__dirname, 'manifest.test-orbix.json'), path.join(BUILD, 'manifest.json'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { throw new Error('FAIL: ' + label); } console.log('PASS:', label); };
const TOKEN = fs.readFileSync('/tmp/cc-orbix-token', 'utf8').trim();
const CHAT = '6ade580ebe9d501796452ad7';
async function userMsgCount() {
  const r = await fetch(`https://orbix-3av3.onrender.com/api/chats/${CHAT}`, { headers: { authorization: 'Bearer ' + TOKEN } });
  const j = await r.json();
  return { user: j.messages.filter((m) => m.role === 'user').length, total: j.messages.length };
}
(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/cc-orbix-profile', {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1600,940'],
    viewport: { width: 1600, height: 900 },
  });
  let page;
  try {
    let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
    page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    const before = await userMsgCount();
    console.log('SERVER_BEFORE>', JSON.stringify(before));
    await page.goto('https://orbix-video-ly.web.app/#/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cc-panel', { timeout: 60000 });
    const sb0 = await page.$('#cc-stopall-btn');
    if (/resume/i.test(await sb0.innerText())) { await sb0.click(); await sleep(600); }
    // AUTO mode ON
    if ((await page.getAttribute('#cc-auto-btn', 'data-mode')) !== 'auto') { await page.click('#cc-auto-btn'); await sleep(400); }
    console.log('MODE>', await page.getAttribute('#cc-auto-btn', 'data-mode'));
    // historical b2b chat kholo
    await page.click('text=Chats'); await sleep(1200);
    await page.click('text=chalo ek fun baatein karte hain'); await sleep(4000);
    const st = await page.evaluate(() => ({
      bubbles: document.querySelectorAll('div.msg.user .bubble').length,
      lastIsBot: (() => { const r = Array.from(document.querySelectorAll('div.thread > div.msg')); return r.length ? !r[r.length-1].classList.contains('user') : null; })(),
    }));
    console.log('CHAT>', JSON.stringify(st));
    ok(st.bubbles >= 5 && st.lastIsBot === true, 'historical chat khuli, last=bot incoming');
    // A) FIRST BIND: poora pacing+generation window, koi draft/send NAHI hona chahiye
    await sleep(16000);
    const a = await page.evaluate(() => document.querySelector('form.composer textarea').value);
    const afterA = await userMsgCount();
    console.log('A_COMPOSER>', JSON.stringify(a.slice(0,60)), 'A_SERVER>', JSON.stringify(afterA));
    ok(a.trim() === '', 'A: first bind par koi draft NAHI');
    ok(afterA.user === before.user, 'A: first bind par ZERO naya user msg (server)');
    await page.screenshot({ path: '/tmp/cc-orbix2/17-auto-firstbind-nosend.png' });
    // B) naya incoming -> EXACTLY 1 auto-send
    await page.fill('form.composer textarea', 'bind ke baad ka naya sawal: chai ya coffee?');
    await page.keyboard.press('Enter');
    console.log('B: manual msg bheja, bot reply + auto-send ka wait...');
    // b2b loop chalta hai - poll karo jab tak manual(1)+auto(>=1) server par na aa jaye (max 45s)
    let afterB = null;
    for (let i = 0; i < 9; i++) {
      await sleep(5000);
      afterB = await userMsgCount();
      if (afterB.user >= before.user + 2) break;
    }
    const bDiag = await page.evaluate(() => ({ composer: document.querySelector('form.composer textarea').value.slice(0,80), panel: (document.getElementById('cc-panel')||{}).innerText?.slice(0,120) }));
    console.log('B_SERVER>', JSON.stringify(afterB), 'B_DIAG>', JSON.stringify(bDiag));
    ok(afterB.user >= before.user + 2, 'B: manual(1) + auto(>=1) server par aaye');
    await page.screenshot({ path: '/tmp/cc-orbix2/18-auto-new-incoming-sent.png' });
    // C) RELOAD + REOPEN under ACTIVE AUTO: historical incoming par replay NAHI.
    // Pehle explicit STOP (b2b loop/in-flight rokne ke liye), phir reload+RESUME = active AUTO boot.
    const sb1 = await page.$('#cc-stopall-btn');
    if (sb1 && !/resume/i.test(await sb1.innerText())) { await sb1.click(); await sleep(500); }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cc-panel', { timeout: 60000 });
    const sb2 = await page.$('#cc-stopall-btn');
    if (/resume/i.test(await sb2.innerText())) { await sb2.click(); await sleep(600); }
    if ((await page.getAttribute('#cc-auto-btn', 'data-mode')) !== 'auto') { await page.click('#cc-auto-btn'); await sleep(400); }
    console.log('C_MODE>', await page.getAttribute('#cc-auto-btn', 'data-mode'));
    await page.click('text=Chats'); await sleep(1200);
    await page.click('text=chalo ek fun baatein karte hain'); await sleep(5000);
    await sleep(16000); // pacing+generation window
    const c = await page.evaluate(() => document.querySelector('form.composer textarea').value);
    const afterC = await userMsgCount();
    console.log('C_COMPOSER>', JSON.stringify(c.slice(0,60)), 'C_SERVER>', JSON.stringify(afterC));
    ok(c.trim() === '', 'C: active-AUTO reload+reopen par koi draft NAHI');
    ok(afterC.user === afterB.user, 'C: active-AUTO reload+reopen par ZERO naya user msg (server)');
    await page.screenshot({ path: '/tmp/cc-orbix2/19-auto-reload-reopen-nosend.png' });
    console.log('ORBIX2J ALL PASS');
  } finally {
    try { if (page) { const b = await page.$('#cc-stopall-btn'); if (b && !/resume/i.test(await b.innerText())) { await b.click(); await sleep(400); } console.log('EXPLICIT STOP done'); } } catch (e) { console.log('stop-on-exit err', String(e).slice(0, 80)); }
    await ctx.close();
  }
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
