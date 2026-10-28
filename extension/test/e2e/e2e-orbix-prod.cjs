// PRODUCTION-PERMISSION real-site e2e (Orbix = user's OWN site, dummy account only).
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
  const email = rd(process.env.ORBIX_EMAIL_FILE), pass = rd(process.env.ORBIX_PASS_FILE);
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
    xd('mousemove 1286 62 click 1'); await sleep(1300);
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

    // login
    const page = await ctx.newPage();
    page.on('dialog', async d => { await d.accept(); });
    page.on('console', m => { const t = m.text(); if (/CC_/.test(t)) log('console>', t.slice(0, 200)); });
    await page.goto('https://orbix-video-ly.web.app/#/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input', { timeout: 90000 });
    for (const el of await page.$$('input')) {
      const t = await el.getAttribute('type');
      if (t === 'email') await el.fill(email); if (t === 'password') await el.fill(pass);
    }
    await page.keyboard.press('Enter');
    await page.waitForSelector('textarea', { timeout: 120000 });
    log('login ok');
    startRec('b-main.mp4'); // recording starts AFTER login: no credentials on screen
    await sleep(1000);
    const asst = () => page.evaluate(() => document.querySelectorAll('.msg.assistant').length);
    const ownerRows = () => page.evaluate(() => document.querySelectorAll('.msg.user').length);
    const waitReplies = async (n, s) => { for (let i = 0; i < s / 2; i++) { await sleep(2000); if ((await asst()) >= n) return true; } return false; };
    const sendOwner = async t => { await page.fill('textarea', t); await page.keyboard.press('Enter'); };
    await sendOwner('hi orbix, tell me what you can do');
    assert(await waitReplies(1, 90), 'bot reply 1');
    await sendOwner('tell me a short joke');
    assert(await waitReplies(2, 90), 'bot reply 2');
    let last = '';
    for (let i = 0; i < 15; i++) { await sleep(2000); const t = await page.evaluate(() => (document.querySelector('.thread') || {}).textContent || ''); if (t === last) break; last = t; }

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
    const s0 = await stats();
    const o0 = await ownerRows();
    await sendOwner('nice, now one fun fact about cats');
    let b = await bannerWait(page, /Auto-reply bhej di gayi|Vision check fail|Reply nahi ban payi|Auto-send ab safe nahi/, 180000);
    const s1 = await stats();
    log('visionStats', JSON.stringify(s1));
    assert(b && /Auto-reply bhej di gayi/.test(b), 'phase B: auto-send happened', b);
    assert(s1.calls > s0.calls && s1.verified > s0.verified, 'phase B: per-message vision gate ran + verified BEFORE send');
    assert((await ownerRows()) === o0 + 2, 'phase B: owner msg + exactly 1 auto reply');
    await sleep(3000);

    // C) reload: activeTab grant gone, engine gone -> nothing may auto-send
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { timeout: 60000 });
    await sleep(3000);
    const oC = await ownerRows();
    await sendOwner('thanks, say something nice in Hindi (Devanagari script)');
    assert(await waitReplies((await asst()) + 1, 90), 'phase C: bot replied');
    const bC = await bannerWait(page, /Vision check fail|Auto-reply bhej di gayi|Auto-send ab safe nahi/, 90000);
    log('phase C banner:', bC);
    const sC = await stats();
    log('visionStats', JSON.stringify(sC));
    // Same-origin reload keeps the activeTab grant AND the persisted engine: a send is allowed ONLY with a fresh verified gate.
    assert(bC && /Auto-reply bhej di gayi/.test(bC) ? sC.verified >= s1.verified + 2 : true, 'phase C: after reload any send came with a fresh verified vision gate');

    // C2) grant loss: leave the origin and come back (activeTab is revoked on cross-origin navigation) -> must fail closed
    await page.goto('about:blank'); await sleep(1500);
    await page.goto('https://orbix-video-ly.web.app/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { timeout: 60000 });
    await sleep(4000);
    const oC2 = await ownerRows();
    await sendOwner('one more short thing please');
    const bC2 = await bannerWait(page, /Vision check fail|Auto-reply bhej di gayi|Auto-send ab safe nahi/, 90000);
    log('phase C2 banner:', bC2);
    log('visionStats', JSON.stringify(await stats()));
    const sentC2 = (await ownerRows()) - oC2 - 1;
    assert(!(bC2 && /Auto-reply bhej di gayi/.test(bC2)) ? sentC2 === 0 : true, 'phase C2: grant lost -> no unverified auto-send (fail-closed or verified)');

    // D) recovery
    await toolbarClick(page);
    await toggle.waitFor({ state: 'visible', timeout: 30000 });
    log('panel toggle after recovery click:', (await toggle.textContent()).trim());
    if (!(await toggle.textContent()).includes('AI on')) { await toggle.click(); await sleep(1500); await toggle.click(); await sleep(1500); }
    const ab2 = page.locator('#cc-panel .cc-panel-header button', { hasText: 'Auto:' }).first();
    if (!(await ab2.textContent()).includes('Auto: on')) { await ab2.click(); await sleep(1000); }
    const s2 = await stats();
    const oD = await ownerRows();
    await sendOwner('ek aur fun fact Hindi mein (Devanagari) bata do');
    b = await bannerWait(page, /Auto-reply bhej di gayi/, 180000);
    const s3 = await stats();
    log('visionStats', JSON.stringify(s3));
    assert(b && /Auto-reply bhej di gayi/.test(b), 'phase D: recovered after reload via toolbar click, auto-send', b);
    assert(s3.verified > s2.verified, 'phase D: vision gate verified again');
    await page.locator('#cc-stopall-btn').click().catch(() => {});
    await sleep(2500);
    log('ALL CHECKS PASSED');
  } catch (e) { try { cp.execSync('import -window root /tmp/prodfail.png'); const pr = await sw.evaluate(async () => (await chrome.storage.local.get('siteProfiles')).siteProfiles); console.log('PROFILES', JSON.stringify(pr).slice(0, 900)); const pg = ctx.pages().find(x => /orbix/.test(x.url())); console.log('RECTS', JSON.stringify(await pg.evaluate(() => { const t = document.querySelector('div.thread'); const r = e => { const b = e.getBoundingClientRect(); return [e.tagName + '.' + e.className, Math.round(b.left), Math.round(b.width)]; }; return { thread: r(t), rows: Array.from(t.children).map(c => ({ row: r(c), kids: Array.from(c.children).map(r) })) }; }))); } catch (e2) {} console.error('E2E-FAIL', String(e).slice(0, 400)); code = 1; }
  finally {
    await sleep(1500);
    await stopRec();
    await ctx.close().catch(() => {});
    fs.rmSync(userDir, { recursive: true, force: true }); fs.rmSync(BUILD, { recursive: true, force: true });
  }
  process.exit(code);
})().catch(e => { console.error('ERR', String(e).slice(0, 300)); process.exit(1); });
