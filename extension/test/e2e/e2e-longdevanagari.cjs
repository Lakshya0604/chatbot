// Long-Devanagari vision-gate e2e on OWN local chat page (scripted counterpart, no real people).
// USE: node e2e-longdevanagari.cjs   (env: CF_ACCOUNT_ID, CF_KEY_FILE, GROQ_KEY_FILE, BUILD_LABEL)
// Test manifest build = production code + host permission for 127.0.0.1:8799 (scripting se inject,
// toolbar/X11 nahi). Vision + Groq keys storage mein script route se (options UI typing nahi).
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const EXT = path.resolve(__dirname, '..', '..');
const log = (...a) => console.log('[e2e-longhi]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function assert(c, m, x) { if (c) { log('PASS:', m); return; } console.error('FAIL:', m, x ?? ''); throw new Error('ASSERT: ' + m); }
const rd = f => fs.readFileSync(f, 'utf8').trim();

(async () => {
  const CF_ACCOUNT = process.env.CF_ACCOUNT_ID;
  const cfKey = process.env.VISION_MOCK === '1' ? 'mock' : rd(process.env.CF_KEY_FILE), groq = process.env.VISION_MOCK === '1' ? 'mock' : rd(process.env.GROQ_KEY_FILE);
  if (process.env.VISION_MOCK !== '1') assert(/^[a-f0-9]{32}$/.test(CF_ACCOUNT || ''), 'account id given');
  const LABEL = process.env.BUILD_LABEL || 'postfix';
  const PORT = parseInt(process.env.E2E_PORT || '8799', 10);

  const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-longhi-build-'));
  fs.cpSync(EXT, BUILD, { recursive: true, filter: s => !s.includes(`${path.sep}test`) });
  const mfp = path.join(BUILD, 'manifest.json');
  const mf = JSON.parse(fs.readFileSync(mfp, 'utf8'));
  // PRODUCTION manifest unchanged (activeTab only) - captureVisibleTab activeTab grant se
  // chalta hai jo REAL X11 toolbar click se milta hai. Koi host-permission elevation nahi.
  assert(!mf.host_permissions.some(h => h.includes('all_urls')), 'production manifest: no all_urls');
  fs.writeFileSync(mfp, JSON.stringify(mf, null, 2));
  // TEST-BUILD ONLY: follow-up timer 60s -> 10min, taaki lamba vision gate chalte hue
  // proactive follow-up ka doosra vision call na ghuse. Shipped engine.js untouched.
  const engPath = path.join(BUILD, 'content', 'engine.js');
  let eng = fs.readFileSync(engPath, 'utf8');
  eng = eng.replace('TEST.FOLLOWUP_DELAY_MS || 60000', 'TEST.FOLLOWUP_DELAY_MS || 600000');
  fs.writeFileSync(engPath, eng);

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-longhi-u-'));
  fs.mkdirSync(path.join(userDir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(userDir, 'Default', 'Preferences'), JSON.stringify({ credentials_enable_service: false, profile: { password_manager_enabled: false } }));
  const consoleLines = [];
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false, viewport: null,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-position=0,0', '--window-size=1400,950'],
  });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 60000 });

  const cp = require('child_process');
  let rec = null;
  const VIDEO = `/tmp/longhi-${LABEL}-prod.mp4`;
  const startRec = (name) => { rec = cp.spawn('ffmpeg', ['-y', '-f', 'x11grab', '-framerate', '10', '-video_size', '1400x950', '-i', process.env.DISPLAY, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', name], { stdio: 'ignore' }); };
  const stopRec = async () => { if (rec) { rec.kill('SIGINT'); await sleep(2500); rec = null; } };
  const xd = (c) => cp.execSync('xdotool ' + c);
  const toolbarClick = async (pg) => {
    await pg.bringToFront(); await sleep(600);
    xd('mousemove 1286 62 click 1'); await sleep(1300); try { cp.execSync(`import -window root -crop 1400x400+0+0 /tmp/menu-${LABEL}.png`); } catch (e) {}
    xd('mousemove 1117 223 click 1'); await sleep(1800);
    log('real toolbar click done');
    const prof = await sw.evaluate(async () => (await chrome.storage.local.get('siteProfiles')).siteProfiles);
    log('PROFILE>', JSON.stringify(prof));
  };
  let code = 0;
    const LONG_HI = "प्राचीन मिस्र के पिरामिड आज से हजारों वर्ष पहले बनाए गए थे और उनकी भव्यता आज भी दुनिया भर के पर्यटकों को आकर्षित करती है। दुबई की प्रसिद्ध ऊँची इमारत समुद्र तट के पास बनी है और उसकी चमकती हुई काँच की सतह सूर्य की रोशनी में दूर से दिखाई देती है। भारत में चाय की खेती मुख्य रूप से असम और दार्जिलिंग के पहाड़ी इलाकों में होती है जहाँ की जलवायु चाय के पौधों के लिए अनुकूल मानी जाती है। सूर्य अपनी किरणों से पृथ्वी तक प्रकाश भेजता है और यही प्रकाश पृथ्वी पर जीवन की ऊर्जा का मुख्य स्रोत माना जाता है। हिंद महासागर दुनिया के बड़े महासागरों में से एक है और यह भारतीय उपमहाद्वीप के दक्षिण में विशाल क्षेत्र में फैला हुआ है। मधुमक्खियाँ फूलों से रस इकट्ठा करती हैं और इसी प्रक्रिया में परागण होता है जिससे फसलों और फलों की पैदावार बढ़ती है। रेलवे स्टेशनों पर यात्रियों की सुविधा के लिए प्रतीक्षालय, भोजनालय और सूचना केंद्र जैसी व्यवस्थाएं की जाती हैं। पर्वतों पर बर्फबारी के मौसम में तापमान बहुत नीचे चला जाता है और पहाड़ी नदियाँ ठंडे जल से भर जाती हैं।";
  try {
    await sw.evaluate(async ({ cfKey, CF_ACCOUNT, groq, mockReply }) => {
      await chrome.storage.sync.set({ character: { name: 'Meera', gender: 'girl', role: 'college friend', tone: 'funny', humour: 'light teasing', replyLength: 'short', defaultMood: 'playful', vocabulary: 'Roman Hinglish casual' } });
      await chrome.storage.local.set({
        aiConfig: { provider: 'groq', apiKey: groq, model: 'openai/gpt-oss-120b', baseUrl: '' },
        visionConfig: mockReply ? { provider: 'mock', mockReply } : { provider: 'cloudflare', apiKey: cfKey, accountId: CF_ACCOUNT },
      });
    }, { cfKey, CF_ACCOUNT, groq, mockReply: process.env.VISION_MOCK === '1' ? JSON.stringify({ messages: [{ text: LONG_HI }] }) : null });
    log('storage configured (script route)');

    // Local chat page: fixed-height scroll container (280px), scripted bot ka LONG Devanagari
    // reply ~600px tall (13px font) -> container se bahut bada, natural bottom-scroll state.
    log('long message chars:', LONG_HI.length);
    const HTML = `<!doctype html><meta charset=utf-8><title>Long Hindi test chat</title><style>body{margin:0;font:12px sans-serif;background:#181818}main{width:700px;margin:0 auto;padding:8px 20px;box-sizing:border-box;height:160px;overflow-y:auto;border:1px solid #333}.thread>div{margin:8px 0}.me{display:flex;justify-content:flex-end}.me .bubble{background:#7c4dff;color:#fff;padding:8px 12px;border-radius:12px;max-width:75%}.hd{background:#333;color:#999;padding:4px 8px;border-radius:8px;font-size:13px}.ans{padding:6px 0;line-height:1.5;color:#9aa0a6}.ans .bub{background:#2b2f33;color:#e8eaed;padding:10px 14px;border-radius:12px;max-width:60%;display:inline-block}form{width:700px;margin:8px auto;display:flex;gap:8px}textarea{flex:1;height:40px;font:12px sans-serif}</style><div id=app><main id=sc><h3>Long Hindi test chat</h3><div class=thread id=t><div class="msg other"><div class=hd>Test Bot (scripted)</div><div class=ans>hello ji, kaise ho?</div></div><div class="msg me"><div class=bubble>sab badhiya, tum batao</div></div><div class="msg other"><div class=hd>Test Bot (scripted)</div><div class=ans>main bhi badhiya, bolo kya chal raha hai</div></div></div></main><form class=composer id=f><textarea id=x></textarea><button class="btn primary" type=submit>Send</button></form></div><script>const t=document.getElementById('t');function add(c,h){const d=document.createElement('div');d.className='msg '+c;d.innerHTML=c==='me'?'<div class=bubble></div>':'<div class=hd>Test Bot (scripted)</div><div class=ans></div>';const tgt=d.querySelector(c==='me'?'.bubble':'.ans');if(c==='other'){const sp=document.createElement('span');sp.className='bub';sp.textContent=h;tgt.appendChild(sp)}else{tgt.textContent=h;}t.appendChild(d);document.getElementById('sc').scrollTop=1e6}document.getElementById('f').addEventListener('submit',e=>{e.preventDefault();const v=document.getElementById('x').value.trim();if(!v)return;document.getElementById('x').value='';add('me',v);setTimeout(()=>add('other',${JSON.stringify(LONG_HI)}),3500)});document.getElementById('x').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('f').requestSubmit()}})</script>`;
    const http = require('http');
    const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(HTML); }).listen(PORT, '127.0.0.1');
    const page = await ctx.newPage();
    page.on('console', m => { const t = m.text(); if (/CC_VISION|CC_/.test(t)) log('console>', t.slice(0, 220)); });
    page.on('dialog', async d => { log('DIALOG>', d.message().replace(/\s+/g, ' ').slice(0, 200)); await d.accept(); });
    page.on('console', m => { const t = m.text(); if (t.includes('CC_VISION')) { consoleLines.push(t); log('console>', t.slice(0, 140)); } });
    page.on('pageerror', e => log('PAGEERR', String(e).slice(0, 200)));
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea');

    // REAL X11 toolbar click (production activeTab path) + ffmpeg screen recording
    startRec(VIDEO);
    await toolbarClick(page);
    await sleep(2200);
    const toggle = page.locator('#cc-panel .cc-panel-header button').first();
    await toggle.waitFor({ state: 'visible', timeout: 30000 });
    await toggle.click(); await sleep(900);
    await toggle.click(); await sleep(900);
    assert((await toggle.textContent()).includes('AI on'), 'consent -> AI on');
    const autoBtn = page.locator('#cc-panel .cc-panel-header button', { hasText: 'Auto:' }).first();
    await autoBtn.click(); await sleep(700);
    assert((await autoBtn.textContent()).includes('Auto: on'), 'AUTO on');

    const meCount = () => page.evaluate(() => document.querySelectorAll('.msg.me').length);
    const before = await meCount();
    await page.fill('textarea', 'bhai ek long fun fact do hindi mein'); await page.keyboard.press('Enter');

    const t0 = Date.now(); let outcome = 'timeout', lastBanner = '';
    while (Date.now() - t0 < (process.env.OUTCOME_MS ? +process.env.OUTCOME_MS : 150000)) {
      const b = await page.locator('#cc-banner').textContent().catch(() => '') || '';
      if (b && b !== lastBanner) { log('banner>', b.slice(0, 160)); lastBanner = b; }
      if (/Auto-reply bhej di gayi/.test(b)) { outcome = 'sent'; break; }
      if (/Vision check fail/.test(b)) { outcome = 'gate-failed'; break; }
      await sleep(2000);
    }
    const stats = await sw.evaluate(async () => (await chrome.storage.local.get('visionStats')).visionStats);
    log('visionStats', JSON.stringify(stats));
    await page.screenshot({ path: `/tmp/longhi-${LABEL}-final.png` });
    const after = await meCount();
    log('me rows before/after:', before, after, 'outcome:', outcome);
    fs.writeFileSync(`/tmp/longhi-${LABEL}-result.json`, JSON.stringify({ outcome, stats, meBefore: before, meAfter: after }));
    if (LABEL === 'prefix') {
      assert(outcome === 'gate-failed', 'PRE-FIX build: gate fail-closed on oversized clipped long Devanagari (Oct 30 repro)');
      assert(stats && stats.rejected > 0, 'PRE-FIX: rejection counted');
    } else {
      if (process.env.VISION_MOCK === '1') {
        // Mock mode: model response stub hai (capture/stitch/matcher REAL), Groq reply nahi
        // banti (401 expected) - send assertions live run ke hain.
        assert(stats && stats.verified === 1 && stats.rejected === 0, 'MOCK: gate verified, zero rejections');
        assert(after === before + 1, 'MOCK: owner msg DOM mein, send nahi (Groq mock mode mein nahi chalta)');
        log('PASS: MOCK gate verified (send assertions live run mein)');
      } else {
        assert(outcome === 'sent', 'POST-FIX build: long Devanagari verified + auto-reply sent');
        assert(stats && stats.verified > 0 && stats.rejected === 0, 'POST-FIX: verified, zero rejections');
        assert(after === before + 2, 'POST-FIX: owner msg + auto-reply both in DOM');
      }
      const st = consoleLines.find(t => t.includes('stitch parts='));
      assert(st, 'stitch coverage log mila');
      const pm = st.match(/parts=(\d+) covered=(\d+)\/(\d+)/);
      assert(pm && +pm[1] >= 2, 'STITCH: overflowing message multi-pass capture (parts=' + (pm && pm[1]) + ')');
      assert(pm && +pm[3] - +pm[2] <= 2, 'STITCH: poora message covered (' + (pm && pm[2]) + '/' + (pm && pm[3]) + '), koi omitted tail nahi');
      log('PASS: stitch boundary + complete coverage proof:', st);

      // Chat identity: title badalte hi nayi chat = naya chatKey -> consent gate phir se,
      // bina re-consent ke auto-reply nahi jaani chahiye.
      await page.evaluate(() => { document.querySelector('h3').textContent = 'Totally different chat'; });
      await page.fill('textarea', 'ek aur message'); await page.keyboard.press('Enter');
      await sleep(8000);
      const stats2 = await sw.evaluate(async () => (await chrome.storage.local.get('visionStats')).visionStats);
      const me2 = await meCount();
      log('after title change: visionStats', JSON.stringify(stats2), 'me rows', me2);
      assert(me2 === after + 1, 'CHAT-IDENTITY: title change = nayi chat, bina re-consent koi auto-reply nahi');
      log('PASS: chat identity gate (naya chatKey -> koi send nahi)');

      // Capture freshness + FIRST BIND after reload: same-origin reload par activeTab grant
      // PERSIST karta hai (Chrome semantics) aur registered site par engine khud boot hota hai.
      // (a) purani (static) history par koi unsolicited reply NAHI (first-bind baseline).
      // (b) naye incoming par capture FRESH page state ka hota hai -> gate -> theek 1 reply.
      const gatesBefore = consoleLines.filter(t => t.includes('gate start')).length;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(10000); // engine boot + settle; static history par trigger nahi hona chahiye
      const meAfterReload = await meCount();
      log('after reload (static history): me rows', meAfterReload);
      assert(meAfterReload === 1, 'FIRST-BIND: reload ke baad purani history par koi auto-reply nahi (me=' + meAfterReload + ')');
      log('PASS: first-bind (historical incoming baseline, koi unsolicited reply nahi)');
      await page.fill('textarea', 'reload ke baad fresh capture test'); await page.keyboard.press('Enter');
      const t1 = Date.now(); let freshSent = false;
      while (Date.now() - t1 < 45000) {
        const b = await page.locator('#cc-banner').textContent().catch(() => '') || '';
        if (/Auto-reply bhej di gayi/.test(b)) { freshSent = true; break; }
        if (/Vision check fail/.test(b)) break;
        await sleep(2000);
      }
      const gatesAfter = consoleLines.filter(t => t.includes('gate start')).length;
      const me3 = await meCount();
      if (process.env.VISION_MOCK === '1') {
        // mock mode: reply generation (Groq) nahi chalti - gate ka FRESH capture run hi proof hai
        assert(gatesAfter > gatesBefore, 'FRESHNESS: reload ke baad naye incoming par fresh-capture gate chala');
        assert(me3 === 2, 'FRESHNESS(mock): history(1) + owner(1), koi unexpected send nahi (me=' + me3 + ')');
      } else {
        assert(freshSent && me3 === 3, 'FRESHNESS: reload ke baad fresh capture se verify + theek 1 reply (me=' + me3 + ')');
      }
      log('PASS: capture freshness (reload ke baad fresh capture; history par kuch nahi)');
    }
    await stopRec();
    log('ALL CHECKS PASSED');
    srv.close();
  } catch (e) { console.error('E2E-FAIL', String(e).slice(0, 400)); code = 1; }
  finally { await ctx.close().catch(() => {}); fs.rmSync(userDir, { recursive: true, force: true }); fs.rmSync(BUILD, { recursive: true, force: true }); }
  process.exit(code);
})().catch(e => { console.error('ERR', String(e).slice(0, 300)); process.exit(1); });
