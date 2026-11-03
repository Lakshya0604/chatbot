// PRODUCTION-PERMISSION e2e on OWN local chat page with scripted counterpart: Hindi (Devanagari) / Hinglish / English incoming.
// Manifest unchanged (activeTab, no <all_urls>). Real X11 mouse clicks on the real Chrome toolbar,
// vision key entered through the real options UI, ffmpeg x11grab screen recording.
// Phases: A) options UI save+test, B) toolbar click -> consent -> auto -> verified send,
// C) reload (grant lost) -> NO action, D) toolbar click again -> verified send, Stop all.
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const EXT = path.resolve(__dirname, '..', '..');
const BACKEND = process.env.BACKEND_URL || 'https://chatbot-backend-3j2t.onrender.com';
const log = (...a) => console.log('[e2e-prod]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function assert(c, m, x) { if (c) { log('PASS:', m); return; } console.error('FAIL:', m, x ?? ''); throw new Error('ASSERT: ' + m); }
const rd = f => fs.readFileSync(f, 'utf8').trim();

(async () => {
  const CF_ACCOUNT = process.env.CF_ACCOUNT_ID;
  const cfKey = rd(process.env.CF_KEY_FILE), groq = rd(process.env.GROQ_KEY_FILE);
  assert(/^[a-f0-9]{32}$/.test(CF_ACCOUNT || ''), 'account id given');

  const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-prod-build-'));
  fs.cpSync(EXT, BUILD, { recursive: true, filter: s => !s.includes(`${path.sep}test${path.sep}`) && !s.includes(`${path.sep}test`) });
  const mf = fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8');
  assert(!mf.includes('all_urls') && !mf.includes('orbix') && /"activeTab"/.test(mf), 'production manifest: activeTab only, no <all_urls>, no orbix grant');
  const VDIR = process.env.VIDEO_DIR || '/tmp/orbix-prod-video';
  fs.mkdirSync(VDIR, { recursive: true });
  let rec = null;
  const startRec = (name) => { rec = cp.spawn('ffmpeg', ['-y', '-f', 'x11grab', '-framerate', '10', '-video_size', '1400x950', '-i', process.env.DISPLAY, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(VDIR, name)], { stdio: 'ignore' }); };
  const stopRec = async () => { if (rec) { rec.kill('SIGINT'); await sleep(2500); rec = null; } };
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-prod-u-'));
  // Chrome password manager OFF in the throwaway profile: no "Save password?" bubble that would show the dummy login in the recording.
  fs.mkdirSync(path.join(userDir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(userDir, 'Default', 'Preferences'), JSON.stringify({ credentials_enable_service: false, profile: { password_manager_enabled: false } }));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false, viewport: null,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-position=0,0', '--window-size=1400,950'],
  });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 60000 });
  const extId = new URL(sw.url()).host;
  const xd = c => cp.execSync('xdotool ' + c);
  const toolbarClick = async (page) => {
    await page.bringToFront(); await sleep(600);
    xd('mousemove 1286 62 click 1'); await sleep(1300); try { cp.execSync('import -window root -crop 1400x400+0+0 /tmp/menu.png'); } catch (e) {}
    xd('mousemove 1117 223 click 1'); await sleep(1800);
    log('real toolbar click done');
  };
  const bannerWait = async (page, re, ms) => {
    const t0 = Date.now(); let last = '';
    while (Date.now() - t0 < ms) {
      const b = await page.locator('#cc-banner').textContent().catch(() => '') || '';
      if (b && b !== last) { log('banner>', b.slice(0, 150)); last = b; }
      if (re.test(b)) return b;
      await sleep(2000);
    }
    return null;
  };
  let code = 0;
  try {
    await sw.evaluate(async ({ backend, key }) => {
      await chrome.storage.sync.set({ character: { name: 'Meera', gender: 'girl', role: 'college friend', tone: 'funny', humour: 'light teasing', replyLength: 'short', defaultMood: 'playful', vocabulary: 'Roman Hinglish casual' }, backendUrl: backend });
      await chrome.storage.local.set({ aiConfig: { provider: 'groq', apiKey: key, model: 'openai/gpt-oss-120b', baseUrl: '' } });
    }, { backend: BACKEND, key: groq });

    // A) options UI (recorded: token field is a masked password input)
    startRec('a-options.mp4');
    const opt = await ctx.newPage();
    await opt.goto(`chrome-extension://${extId}/options/options.html`);
    await opt.locator('#visionCard').scrollIntoViewIfNeeded();
    await opt.fill('#visionAccountId', CF_ACCOUNT);
    await opt.fill('#visionKey', cfKey);
    await sleep(800);
    await opt.click('#visionSaveBtn');
    let st = '';
    for (let i = 0; i < 40; i++) { await sleep(2000); st = await opt.textContent('#visionStatus'); if (/Vision connected|nahi hua/.test(st)) break; }
    log('options status:', st);
    assert(/Vision connected/.test(st), 'options UI: vision save + real test call passed');
    const leaked = await opt.evaluate(() => document.body.innerText.includes('Bearer') );
    await sleep(2500);
    await opt.close();
    await stopRec();

    // own local chat page (generic markup, header+answer rows, no site selectors)
    const http = require('http');
    const LINES = ['hello ji, kaise ho?', 'sab badhiya, tum batao', 'नमस्ते! मैं ठीक हूँ, तुम बताओ आज शाम का क्या प्लान है?', 'Haan yaar kal milte hain, chai pe discuss karenge 😄', 'Sounds good, see you tomorrow evening then.'];
    const HTML = `<!doctype html><meta charset=utf-8><title>Local test chat</title><style>body{margin:0;font:16px sans-serif;background:#faf5ee}main{width:900px;margin:0 auto;padding:16px 30px;box-sizing:border-box;height:760px;overflow:auto}.thread>div{margin:12px 0}.me{display:flex;justify-content:flex-end}.me .bubble{background:#7c4dff;color:#fff;padding:10px 14px;border-radius:14px;max-width:70%}.hd{background:#eee;padding:6px 10px;border-radius:8px;font-size:13px}.ans{padding:8px 0}form{width:900px;margin:0 auto;display:flex;gap:8px;padding:0 30px;box-sizing:border-box}textarea{flex:1;height:44px;font:16px sans-serif}</style><div id=app><main><h3>Local test chat</h3><div class=thread id=t></div></main><form class=composer id=f><textarea id=x placeholder="Type a message"></textarea><button class="btn primary" type=submit>Send</button></form></div><script>const L=${JSON.stringify(LINES)};let i=0;const t=document.getElementById('t');function add(c,h){const d=document.createElement('div');d.className='msg '+c;d.innerHTML=c==='me'?'<div class=bubble></div>':'<div class=hd>Test Bot (scripted) · answered directly</div><div class=ans></div>';d.querySelector(c==='me'?'.bubble':'.ans').textContent=h;t.appendChild(d);document.querySelector('main').scrollTop=1e6}document.getElementById('f').addEventListener('submit',e=>{e.preventDefault();const v=document.getElementById('x').value.trim();if(!v)return;document.getElementById('x').value='';add('me',v);if(i<L.length){const m=L[i++];setTimeout(()=>add('other',m),3500)}});document.getElementById('x').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('f').requestSubmit()}})</script>`;
    const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(HTML); }).listen(8799, '127.0.0.1');
    const page = await ctx.newPage();
    page.on('console', m => log('console>', m.text().slice(0, 200))); page.on('dialog', async d => { log('DIALOG>', d.message().replace(/\s+/g, ' ').slice(0, 300)); await d.accept(); }); page.on('pageerror', e => log('PAGEERR', String(e).slice(0, 200)));
    await page.goto('http://127.0.0.1:8799/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea');
    startRec('b-main.mp4'); await sleep(1000);
    const asst = () => page.evaluate(() => document.querySelectorAll('.msg.other').length);
    const ownerRows = () => page.evaluate(() => document.querySelectorAll('.msg.me').length);
    const waitReplies = async (n, s) => { for (let i = 0; i < s / 2; i++) { await sleep(2000); if ((await asst()) >= n) return true; } return false; };
    const sendOwner = async t => { await page.fill('textarea', t); await page.keyboard.press('Enter'); };
    await sendOwner('hi, kaise ho'); assert(await waitReplies(1, 30), 'counterpart line 1');
    await sendOwner('main theek hu'); assert(await waitReplies(2, 30), 'counterpart line 2');
    await sleep(2000);

    // B) real toolbar click
    assert((await page.locator('#cc-panel').count()) === 0, 'before toolbar click: no extension panel on page');
    await toolbarClick(page);
    const toggle = page.locator('#cc-panel .cc-panel-header button').first();
    await toggle.waitFor({ state: 'visible', timeout: 30000 });
    await toggle.click(); await sleep(1500);
    await toggle.click(); await sleep(1500);
    assert((await toggle.textContent()).includes('AI on'), 'consent -> AI on');
    const autoBtn = page.locator('#cc-panel .cc-panel-header button', { hasText: 'Auto:' }).first();
    await autoBtn.click(); await sleep(1000);
    assert((await autoBtn.textContent()).includes('Auto: on'), 'AUTO on');
    const stats = async () => (await sw.evaluate(async () => (await chrome.storage.local.get('visionStats')).visionStats)) || { calls: 0, verified: 0 };
    await sendOwner('chalo kal ka plan bata');

    // Chain: owner trigger -> HINDI incoming -> verified auto-reply -> HINGLISH incoming -> verified auto-reply -> ENGLISH incoming -> verified auto-reply
    const lastTexts = () => page.evaluate(() => Array.from(document.querySelectorAll('.msg')).slice(-4).map(e => (e.querySelector('.ans, .bubble') || e).textContent));
    const evidence = [];
    for (let k = 0; k < 3; k++) {
      const want = 3 + k; // counterpart lines so far
      assert(await waitReplies(want, 60), 'counterpart line ' + want + ' arrived');
      const t0 = new Date().toISOString();
      const inc = await page.evaluate(() => { const o = document.querySelectorAll('.msg.other'); return o[o.length - 1].querySelector('.ans').textContent; });
      const sb = await stats(); const rowsBefore = await ownerRows();
      let ok = false;
      for (let i = 0; i < 60; i++) { await sleep(2000); if ((await ownerRows()) > rowsBefore) { ok = true; break; } }
      const sa = await stats();
      log('INCOMING[' + k + '] @' + t0 + ': ' + inc);
      log('visionStats before', JSON.stringify(sb), 'after', JSON.stringify(sa));
      assert(ok, 'auto-reply was sent for incoming #' + k);
      assert(sa.verified > sb.verified && sa.rejected === sb.rejected, 'vision gate verified THIS incoming message before the send (#' + k + ')');
      await page.screenshot({ path: path.join(VDIR, 'shot-' + k + '.png') });
      evidence.push({ k, inc, t0 });
      if (k === 0) assert(/[\u0900-\u097F]/.test(inc), 'incoming #0 is real Devanagari Hindi');
    }
    log('EVIDENCE', JSON.stringify(evidence));

    await page.locator('#cc-stopall-btn').click().catch(() => {});
    await sleep(2500);
    log('ALL CHECKS PASSED');
  } catch (e) { try { cp.execSync('import -window root /tmp/prodfail.png'); const pr = await sw.evaluate(async () => (await chrome.storage.local.get('siteProfiles')).siteProfiles); console.log('PROFILES', JSON.stringify(pr).slice(0, 900)); const pg = ctx.pages().find(x => /orbix/.test(x.url())); console.log('RECTS', JSON.stringify(await pg.evaluate(() => { const t = document.querySelector('div.thread'); const r = e => { const b = e.getBoundingClientRect(); return [e.tagName + '.' + e.className, Math.round(b.left), Math.round(b.width)]; }; return { thread: r(t), rows: Array.from(t.children).map(c => ({ row: r(c), kids: Array.from(c.children).map(r) })) }; }))); } catch (e2) {} try { const pg = ctx.pages().find(x => /8799/.test(x.url())); console.log('CCDOM', JSON.stringify(await pg.evaluate(() => Array.from(document.querySelectorAll('[id^=cc-]')).map(e => e.id + ':' + e.textContent.slice(0, 200))))); } catch (e3) {} try { console.log('SWDBG', JSON.stringify(await sw.evaluate(async () => { const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' }); const t = tabs[0]; let err = null; try { await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => 1 }); } catch (e) { err = String(e); } return { n: tabs.length, url: t && t.url, err }; }))); } catch (e4) { console.log('SWDBG fail', String(e4).slice(0, 200)); } console.error('E2E-FAIL', String(e).slice(0, 400)); code = 1; }
  finally {
    await sleep(1500);
    await stopRec();
    await ctx.close().catch(() => {});
    fs.rmSync(userDir, { recursive: true, force: true }); fs.rmSync(BUILD, { recursive: true, force: true });
  }
  process.exit(code);
})().catch(e => { console.error('ERR', String(e).slice(0, 300)); process.exit(1); });
