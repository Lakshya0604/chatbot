// e2e-orbix-local.cjs - REAL local Chrome mein extension + faithful Orbix-shaped mock page.
// Koi real-site login nahi, koi live provider nahi (mock backend in-process), koi live send
// nahi (sab kuch is mock DOM mein). Playwright route interception se page https://orbix-video-ly.web.app/
// par serve hota hai (adapter ka host check pass), backend 127.0.0.1:8787 mock hai.
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { chromium } = require('playwright-core');

const SRC = path.join(__dirname, '..', '..');
const SHOTS = '/tmp/cc-orbix-local';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond, label) => { if (!cond) { failures++; console.log('FAIL:', label); } else console.log('PASS:', label); };
async function waitCalls(n, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (backendCalls.length >= n) return true; await sleep(200); } return false; }

// ---------- mock backend (in-process, /reply) ----------
let replyDelay = 0;
let failReplies = false;
const backendCalls = [];
const server = http.createServer((req, res) => {
  if (req.url === '/__fail') { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { failReplies = JSON.parse(b).on === true; res.end('ok'); }); return; }
  if (req.url === '/__delay') { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { replyDelay = Number(JSON.parse(b).ms) || 0; res.end('ok'); }); return; }
  if (req.url !== '/reply') { res.writeHead(404); res.end('nf'); return; }
  let b = ''; req.on('data', (c) => b += c);
  req.on('end', () => {
    backendCalls.push(JSON.parse(b));
    if (failReplies) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"mock backend down"}'); return; }
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply: 'MOCK AI REPLY ' + backendCalls.length }));
    }, replyDelay);
  });
});

(async () => {
  await new Promise((r) => server.listen(8787, '127.0.0.1', r));

  // ---------- test build (scoped manifest) ----------
  let BUILD;
  if (process.env.PKG_DIR) {
    BUILD = process.env.PKG_DIR; // PACKAGED build as-is (production manifest, no rewrite)
    console.log('MODE: packaged build verification -', BUILD);
  } else {
    BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-orbixlocal-'));
    fs.cpSync(SRC, BUILD, { recursive: true, filter: (s) => !s.includes(`${path.sep}node_modules`) && !s.includes(`${path.sep}test${path.sep}e2e${path.sep}build`) });
    const mf = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
    mf.name = 'CC ORBIX LOCAL E2E BUILD';
    mf.host_permissions = ['http://127.0.0.1:8787/*', 'http://localhost:8787/*', 'https://*.onrender.com/*']; // onrender = verification fetch (production manifest mein pehle se hai)
    mf.content_scripts = [
      { matches: ['https://orbix-video-ly.web.app/*'], js: ['content/engine.js', 'content/adapters/orbix.js'], run_at: 'document_idle' },
      { matches: ['https://orbix-video-ly.web.app/*'], js: ['content/orbix-hook.js'], run_at: 'document_start', world: 'MAIN' }, // v21 passive capture hook
    ];
    delete mf.optional_host_permissions;
    fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(mf, null, 2));
    console.log('MODE: scoped test manifest');
  }

  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-orbixlocal-profile-')), {
    headless: false,
    // Bundled chromium prefer; missing ho to system google-chrome fallback
    executablePath: fs.existsSync(path.join(os.homedir(), '.cache', 'ms-playwright')) ? undefined : (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined),
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1280,800'],
    viewport: { width: 1280, height: 720 },
  });
  let sw; for (let i = 0; i < 100 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); } // cold Chrome first-launch slow
  ok(!!sw, 'service worker registered');
  await sw.evaluate(() => new Promise((r) => {
    chrome.storage.sync.set({
      character: { name: 'Meera', role: 'friend', tone: 'casual', replyLength: 'short' },
      backendUrl: 'http://127.0.0.1:8787',
    }, () => chrome.storage.local.set({ authToken: 'tok123' }, r));
  }));

  const html = fs.readFileSync(path.join(__dirname, 'mock-orbix.html'), 'utf8');
  await ctx.route('https://orbix-video-ly.web.app/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  // v18: adapter ki network identity /api/chats/<id> resource entries par chalti hai.
  // Playwright routes last-registered-first match karte hain - ye catch-all se pehle lagega.
  let chatFetchDelay = {}; // id -> ms (inversion test ke liye)
  const chatFetchFail = new Set(); // id -> detail 500 (fetch-fail test ke liye)
  // v21 accounting: adapter KHUD koi API request nahi karta - har /api/chats/* hit
  // page-initiated honi chahiye (harness trigger). detailFetches vs expectedFetches.
  const detailFetches = [];
  let apiListHits = 0;
  const expectedFetches = [];
  // v19: adapter verification GET /api/chats/<id> ka CONTENT rendered thread se match
  // karti hai. Is map ko rendered state ke saath sync rakhna harness ki zimmedari hai.
  const apiChatData = {
    '00000000000000000000aa01': [{ role: 'user', content: 'pehla owner message' }, { role: 'assistant', content: 'orbix ka pehla jawab' }],
  };
  await ctx.route('**/api/chats/*', async (route) => {
    const id = route.request().url().split('/').pop();
    detailFetches.push(id);
    const d = chatFetchDelay[id] || 0;
    if (d) await sleep(d);
    if (chatFetchFail.has(id)) { await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }); return; }
    const msgs = apiChatData[id];
    if (!msgs) { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); return; }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id, title: 'mock', messages: msgs }) });
  });
  // v20 ka list endpoint ab sirf ACCOUNTING ke liye: v21 adapter ise KABHI nahi pukarta
  await ctx.route('**/api/chats', (route) => {
    apiListHits++;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(Object.keys(apiChatData).map((id) => ({ id, title: 'mock', updatedAt: '2026-11-03' }))),
    });
  });
  const pageLogs = [];

  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => { const t = m.text(); if (/CC_|cc-|ORBIX/.test(t)) { console.log('PAGE>', t.slice(0, 160)); pageLogs.push(t); } });
  page.on('pageerror', (e) => console.log('PAGEERR>', String(e).slice(0, 200)));
  await page.goto('https://orbix-video-ly.web.app/');
  expectedFetches.push('00000000000000000000aa01'); // mock page ka initial open-chat fetch
  await sleep(2000); // adapter boot + engine baseline priming

  const toggle = await page.$('#cc-toggle-btn');
  ok(!!toggle, 'A: adapter boot - consent toggle render hua');
  await page.screenshot({ path: SHOTS + '/a-boot.png' });

  // B: bina consent incoming -> koi backend call nahi
  await page.evaluate(() => {
    const r = document.createElement('div');
    r.className = 'msg assistant';
    r.innerHTML = '<div class="steps">s</div><div class="answer">bina consent wala incoming</div>';
    document.querySelector('.thread').appendChild(r);
  });
  await sleep(2500);
  ok(backendCalls.length === 0, 'B: consent ke bina AI request nahi gayi (' + backendCalls.length + ' calls)');

  // C: consent -> suggestion (send NAHI)
  await page.click('#cc-toggle-btn'); await sleep(400);
  await page.click('#cc-toggle-btn'); await sleep(800); // 2-step consent (dialogs auto-accept)
  await page.evaluate(() => { document.querySelector('form.composer textarea').value = ''; });
  await page.evaluate(() => {
    const r = document.createElement('div');
    r.className = 'msg assistant';
    r.innerHTML = '<div class="steps">s</div><div class="answer">consent ke baad incoming</div>';
    document.querySelector('.thread').appendChild(r);
  });
  await waitCalls(1, 20000); // pehli request: MV3 service worker cold start
  ok(backendCalls.length === 1, 'C: consent ke baad 1 AI request (' + backendCalls.length + ')');
  await sleep(800);
  const cComposer = await page.evaluate(() => document.querySelector('form.composer textarea').value);
  ok(/MOCK AI REPLY 1/.test(cComposer), 'C: suggestion composer mein draft (send nahi): "' + cComposer.slice(0, 40) + '"');
  let userRows = await page.evaluate(() => document.querySelectorAll('.msg.user').length);
  ok(userRows === 1, 'C: suggest mode mein kuch send NAHI hua (user rows=' + userRows + ')');
  await page.screenshot({ path: SHOTS + '/c-suggest.png' });

  // D: streaming chunks -> exactly 1 batched request
  await page.evaluate(() => {
    const r = document.createElement('div');
    r.className = 'msg assistant';
    r.innerHTML = '<div class="steps">s</div><div class="answer">chunk1</div>';
    document.querySelector('.thread').appendChild(r);
    const a = r.querySelector('.answer');
    let i = 1;
    const t = setInterval(() => { i++; a.textContent = 'chunk1+chunk' + i; if (i >= 4) clearInterval(t); }, 250);
  });
  await waitCalls(2, 16000); // 20% slow-pacing draw (8-10s) cover
  await sleep(1200); // koi duplicate request nahi aani chahiye
  if (backendCalls.length !== 2) {
    console.log('D debug:', JSON.stringify(await page.evaluate(() => ({
      banner: (document.getElementById('cc-banner') || {}).textContent || '',
      composer: document.querySelector('form.composer textarea').value,
      enabled: (document.getElementById('cc-toggle-btn') || {}).dataset && document.getElementById('cc-toggle-btn').dataset.enabled,
      rows: document.querySelectorAll('.msg').length,
      lastRowCls: (document.querySelector('.thread').lastElementChild || {}).className,
    }))));
  }
  ok(backendCalls.length === 2, 'D: streaming chunks batch hoke sirf 1 request (' + backendCalls.length + ')');
  await page.evaluate(() => { document.querySelector('form.composer textarea').value = ''; });

  // E: AUTO is adapter par DISABLED (v18 - overlapping-switch identity inversion open).
  // AUTO button render hi NAHI hona chahiye; incoming par draft aaye, send KABHI nahi.
  const autoBtn = await page.$('#cc-auto-btn');
  ok(!autoBtn, 'E: AUTO button render NAHI hua (adapter AUTO-disabled)');
  await page.evaluate(() => {
    const r = document.createElement('div');
    r.className = 'msg assistant';
    r.innerHTML = '<div class="steps">s</div><div class="answer">auto mode incoming</div>';
    document.querySelector('.thread').appendChild(r);
  });
  await waitCalls(3, 16000); // 20% slow-pacing draw cover
  await sleep(2500); // purane AUTO window ke barabar wait - kuch bhi send nahi hona chahiye
  userRows = await page.evaluate(() => document.querySelectorAll('.msg.user').length);
  ok(backendCalls.length === 3, 'E: incoming par 1 request (suggest) (' + backendCalls.length + ')');
  ok(userRows === 1, 'E: AUTO-disabled mein kuch SEND NAHI hua (user rows=' + userRows + ')');
  const eComposer = await page.evaluate(() => document.querySelector('form.composer textarea').value);
  ok(/MOCK AI REPLY 3/.test(eComposer), 'E: reply draft ke roop mein composer mein: "' + eComposer.slice(0, 40) + '"');
  await page.screenshot({ path: SHOTS + '/e-auto.png' });
  // Chat disable karke aage ke tests ko deterministic rakho (F fresh consent karta hai).
  await page.click('#cc-toggle-btn'); await sleep(500);

  // H: sidebar re-render (identical nodes, naye elements) -> switch invalidation -> fresh consent
  await page.evaluate(() => {
    const rows = document.getElementById('rows');
    rows.innerHTML = '<div class="chat-row on"><button>local mock chat · Nov 2</button><button class="x">×</button></div>' +
      '<div class="chat-row"><button>doosri chat · Nov 1</button><button class="x">×</button></div>';
  });
  await page.evaluate(() => window.__mockRefetch('00000000000000000000aa01')); // re-render ke saath site refetch karti hai
  expectedFetches.push('00000000000000000000aa01');
  await sleep(2500); // sync invalidation + debounced reboot
  await page.evaluate(() => {
    const r = document.createElement('div');
    r.className = 'msg assistant';
    r.innerHTML = '<div class="steps">s</div><div class="answer">rerender ke baad incoming</div>';
    document.querySelector('.thread').appendChild(r);
  });
  await sleep(3000);
  ok(backendCalls.length === 3, 'H: sidebar re-render ke baad consent restore NAHI (calls=' + backendCalls.length + ')');
  await page.screenshot({ path: SHOTS + '/h-rerender.png' });

  // F: send-window race - slow backend, mid-generation contract violation -> koi send nahi
  // (page is halt ke baad bhi consent fresh maangega; pehle re-consent karo)
  const toggleCount = await page.evaluate(() => document.querySelectorAll('#cc-toggle-btn').length);
  ok(toggleCount === 1, 'F: exactly 1 toggle button (koi dead duplicate UI nahi), got ' + toggleCount);
  await page.click('#cc-toggle-btn'); await sleep(400);
  await page.click('#cc-toggle-btn'); await sleep(600);
  const fEnabled = await page.evaluate(() => document.getElementById('cc-toggle-btn').dataset.enabled);
  console.log('F debug: toggle enabled after consent =', fEnabled);
  await page.evaluate(() => { document.querySelector('form.composer textarea').value = ''; });
  const ab2 = await page.$('#cc-auto-btn'); if (ab2) { await ab2.click(); await sleep(400); }
  await fetch('http://127.0.0.1:8787/__delay', { method: 'POST', body: JSON.stringify({ ms: 1200 }) });
  await page.evaluate(() => {
    const r = document.createElement('div');
    r.className = 'msg assistant';
    r.innerHTML = '<div class="steps">s</div><div class="answer">race incoming</div>';
    document.querySelector('.thread').appendChild(r);
  });
  await waitCalls(4, 20000); // request FIRE ho gayi (reply 1200ms delayed = generation in-flight)
  ok(backendCalls.length === 4, 'F: request in-flight hai (calls=' + backendCalls.length + ', expected 4)');
  await page.evaluate(() => {
    const bad = document.createElement('div');
    bad.className = 'msg user assistant'; // contract violation MID-GENERATION
    bad.id = 'cc-bad-row';
    document.querySelector('.thread').appendChild(bad);
  });
  await sleep(4000); // reply aata hai + discard window
  userRows = await page.evaluate(() => document.querySelectorAll('.msg.user:not(#cc-bad-row)').length);
  const reply4Sent = await page.evaluate(() => Array.from(document.querySelectorAll('.msg.user .bubble')).some((b) => /MOCK AI REPLY 4/.test(b.textContent)));
  // v18 (AUTO disabled): user rows sirf 1 (original) - koi AUTO send hua hi nahi; point
  // ye hai ki violation ke baad reply4 commit NAHI hua.
  ok(userRows === 1 && !reply4Sent, 'F: in-flight generation ke beech violation -> send COMMIT NAHI (user rows=' + userRows + ', reply4Sent=' + reply4Sent + ')');
  await page.screenshot({ path: SHOTS + '/f-race.png' });

  // G: reload -> persisted consent apply NAHI (fresh document, naya nonce)
  await fetch('http://127.0.0.1:8787/__delay', { method: 'POST', body: JSON.stringify({ ms: 0 }) });
  await page.reload();
  expectedFetches.push('00000000000000000000aa01'); // reload par mock page phir initial fetch karta hai
  await sleep(2500);
  const toggle2 = await page.$('#cc-toggle-btn');
  ok(!!toggle2, 'G: reload par adapter dobara boot');
  await page.evaluate(() => {
    const r = document.createElement('div');
    r.className = 'msg assistant';
    r.innerHTML = '<div class="steps">s</div><div class="answer">reload ke baad incoming</div>';
    document.querySelector('.thread').appendChild(r);
  });
  await sleep(3000);
  ok(backendCalls.length === 4, 'G: reload par purani consent apply NAHI - koi nayi request nahi (calls=' + backendCalls.length + ', expected 4)');
  await page.screenshot({ path: SHOTS + '/g-reload.png' });

  // ---------- extended controlled coverage (Nov 2 PM, naye home-view drift ke baad) ----------
  async function consentNow() {
    await page.click('#cc-toggle-btn'); await sleep(400);
    await page.click('#cc-toggle-btn'); await sleep(700);
    await page.evaluate(() => { document.querySelector('form.composer textarea').value = ''; });
  }
  async function loadChat(anchor, ans) {
    await page.evaluate(([a, b]) => {
      const t = document.querySelector('.thread');
      t.innerHTML = '<div class="msg user"><div class="bubble"></div></div><div class="msg assistant"><div class="steps">s</div><div class="answer"></div></div>';
      t.querySelector('.bubble').textContent = a;
      t.querySelector('.answer').textContent = b;
    }, [anchor, ans]);
  }
  async function addIncoming(text) {
    await page.evaluate((txt) => {
      const r = document.createElement('div');
      r.className = 'msg assistant';
      r.innerHTML = '<div class="steps">s</div><div class="answer"></div>';
      r.querySelector('.answer').textContent = txt;
      document.querySelector('.thread').appendChild(r);
    }, text);
  }

  // I: DISTINCT chat switch (sidebar present + thread replace) -> fresh consent
  await consentNow();
  let callsBefore = backendCalls.length;
  apiChatData['00000000000000000000bb02'] = [{ role: 'user', content: 'alag chat opener' }, { role: 'assistant', content: 'alag jawab' }];
  await page.evaluate(() => window.__mockOpenChat('00000000000000000000bb02', 'alag chat opener', 'alag jawab'));
  expectedFetches.push('00000000000000000000bb02');
  await sleep(2500);
  ok(!!(await page.$('#cc-toggle-btn')), 'I: switch ke baad naya instance (toggle wapas)');
  await addIncoming('switched chat ka incoming');
  await sleep(3000);
  ok(backendCalls.length === callsBefore, 'I: distinct chat switch par consent carry over NAHI (calls=' + backendCalls.length + ')');

  // K: IDENTITY OBSERVABILITY LOST (sidebar unmount - naye home-view case) -> engine band,
  // signals wapas aane par bhi FRESH consent (identical-opener replacement bhi covered)
  await consentNow();
  callsBefore = backendCalls.length;
  await page.evaluate(() => { const sb = document.querySelector('.sidebar'); if (sb) sb.remove(); });
  await sleep(300);
  ok(!(await page.$('#cc-toggle-btn')), 'K: sidebar unmount par engine UI hat gayi (instance stopped)');
  await loadChat('teesri chat opener', 'teesra jawab'); // thread replace WHILE sidebar absent
  await addIncoming('sidebar-less incoming');
  await sleep(2500);
  ok(backendCalls.length === callsBefore, 'K: observability lost mein koi request NAHI (calls=' + backendCalls.length + ')');
  ok(!(await page.$('#cc-toggle-btn')), 'K: sidebar absent mein adapter boot NAHI karta');
  // signals wapas: sidebar restore + chat open
  await page.evaluate(() => {
    const sb = document.createElement('aside');
    sb.className = 'sidebar';
    sb.innerHTML = '<div id="rows"><div class="chat-row on"><button>local mock chat · Nov 2</button><button class="x">×</button></div><div class="chat-row"><button>doosri chat · Nov 1</button><button class="x">×</button></div></div>';
    document.body.prepend(sb);
  });
  apiChatData['00000000000000000000aa01'] = [{ role: 'user', content: 'teesri chat opener' }, { role: 'assistant', content: 'teesra jawab' }];
  await page.evaluate(() => window.__mockRefetch('00000000000000000000aa01')); // chat phir khuli = refetch
  expectedFetches.push('00000000000000000000aa01');
  await sleep(2500);
  ok(!!(await page.$('#cc-toggle-btn')), 'K: signals wapas -> naya instance (fresh consent maangega)');
  await addIncoming('reboot ke baad incoming');
  await sleep(3000);
  ok(backendCalls.length === callsBefore, 'K: reboot ke baad bhi purani consent apply NAHI (calls=' + backendCalls.length + ')');

  // L: backend failure -> fail-closed, koi retry storm nahi, kuch send nahi
  await consentNow();
  await fetch('http://127.0.0.1:8787/__fail', { method: 'POST', body: JSON.stringify({ on: true }) });
  callsBefore = backendCalls.length;
  const userRowsBefore = await page.evaluate(() => document.querySelectorAll('.msg.user').length);
  await addIncoming('backend down incoming');
  await waitCalls(callsBefore + 1, 15000);
  await sleep(4000);
  const lComposer = await page.evaluate(() => document.querySelector('form.composer textarea').value);
  userRows = await page.evaluate(() => document.querySelectorAll('.msg.user').length);
  ok(backendCalls.length === callsBefore + 1, 'L: backend 500 par retry storm NAHI (calls=' + backendCalls.length + ', expected ' + (callsBefore + 1) + ')');
  ok(lComposer.trim() === '' && userRows === userRowsBefore, 'L: backend failure par koi suggestion/send NAHI (composer empty, user rows ' + userRowsBefore + '->' + userRows + ')');
  await fetch('http://127.0.0.1:8787/__fail', { method: 'POST', body: JSON.stringify({ on: false }) });

  // M: recipient STOP -> chat band, aage koi request nahi
  callsBefore = backendCalls.length;
  await addIncoming('theek hai stop');
  await sleep(3000);
  await addIncoming('stop ke baad normal message');
  await sleep(3000);
  ok(backendCalls.length === callsBefore, 'M: recipient STOP par chat band - koi AI request nahi (calls=' + backendCalls.length + ')');
  const mEnabled = await page.evaluate(() => (document.getElementById('cc-toggle-btn') || {}).dataset && document.getElementById('cc-toggle-btn').dataset.enabled);
  ok(mEnabled === 'false', 'M: stop ke baad toggle disabled (enabled=' + mEnabled + ')');
  await page.screenshot({ path: SHOTS + '/m-stop.png' });

  // N: EMPTY-THREAD window (rows->0 -> same-anchor repopulate) -> invalidate + fresh consent
  await page.click('#cc-toggle-btn'); await sleep(400); // stop ke baad fresh enable = full consent flow
  await page.click('#cc-toggle-btn'); await sleep(700);
  await page.evaluate(() => { document.querySelector('form.composer textarea').value = ''; });
  callsBefore = backendCalls.length;
  await page.evaluate(() => { document.querySelectorAll('.thread > .msg').forEach((r) => r.remove()); });
  await sleep(300);
  await loadChat('teesri chat opener', 'teesra jawab'); // SAME anchor wapas (same-chat re-render bhi ho sakta)
  await page.evaluate(() => window.__mockRefetch('00000000000000000000aa01')); // thread repopulate = fetch hua
  expectedFetches.push('00000000000000000000aa01');
  await sleep(2000);
  ok(!!(await page.$('#cc-toggle-btn')), 'N: empty->repopulate par naya instance');
  await addIncoming('repopulate ke baad incoming');
  await sleep(3000);
  ok(backendCalls.length === callsBefore, 'N: empty-window ke baad consent carry over NAHI (calls=' + backendCalls.length + ')');

  // O: OVERLAPPING-SWITCH completion inversion (race verification under AUTO-disabled
  // boundary): chat B ka fetch SLOW (delay 2500ms), turant chat C kholo (fast fetch) -
  // B ka response LAST complete hota hai (inversion). Is window mein bina fresh consent
  // ke koi backend request NAHI jani chahiye, chahe identity kisi bhi id par land ho.
  apiChatData['00000000000000000000bb02'] = [{ role: 'user', content: 'b opener' }, { role: 'assistant', content: 'b jawab' }];
  apiChatData['00000000000000000000cc03'] = [{ role: 'user', content: 'c opener' }, { role: 'assistant', content: 'c jawab' }];
  chatFetchDelay['00000000000000000000bb02'] = 2500;
  callsBefore = backendCalls.length;
  const logsBefore = pageLogs.length;
  await page.evaluate(() => window.__mockOpenChat('00000000000000000000bb02', 'b opener', 'b jawab'));
  expectedFetches.push('00000000000000000000bb02');
  await sleep(150); // B in-flight, abhi complete nahi
  await page.evaluate(() => window.__mockOpenChat('00000000000000000000cc03', 'c opener', 'c jawab'));
  expectedFetches.push('00000000000000000000cc03');
  await sleep(3200); // C complete, phir B complete (inversion window cross)
  await addIncoming('inversion ke baad incoming');
  await sleep(3000);
  ok(backendCalls.length === callsBefore, 'O: inversion window ke ACROSS bina fresh consent koi request NAHI (calls=' + backendCalls.length + ')');
  // Content-correlation proof: late-completing B REJECT hua, C hi verified bind hua.
  const boundLines = pageLogs.slice(logsBefore).filter((l) => l.includes('bound verified chat'));
  const lastBound = boundLines.length ? boundLines[boundLines.length - 1] : '';
  ok(lastBound.includes('00000000000000000000cc03'), 'O: inversion ke baad verified bind = C (content match), late B nahi. Line: ' + lastBound.slice(0, 90));
  chatFetchDelay = {};

  // P: IDENTICAL-CONTENT TWINS (v21 semantics):
  // P1: UNSEEN twin (dd04 API universe mein hai par page ne KABHI fetch nahi ki).
  //     Render ka data-source sirf captured response ho sakta hai (site cacheless -
  //     Nov 2 live probe: refetch on switch, storage mein chat data nahi). Bind =
  //     ee05 = wohi chat jiska response render hua. (v20 enumeration isko ambiguous
  //     karti thi; v21 direct correlation SAHI chat se bind karta hai.)
  apiChatData['00000000000000000000dd04'] = [{ role: 'user', content: 'twin opener' }, { role: 'assistant', content: 'twin jawab' }];
  apiChatData['00000000000000000000ee05'] = [{ role: 'user', content: 'twin opener' }, { role: 'assistant', content: 'twin jawab' }];
  callsBefore = backendCalls.length;
  let pl = pageLogs.length;
  await page.evaluate(() => window.__mockOpenChat('00000000000000000000ee05', 'twin opener', 'twin jawab'));
  expectedFetches.push('00000000000000000000ee05');
  await sleep(3000);
  const p1Bound = pageLogs.slice(pl).filter((l) => l.includes('bound verified chat'));
  ok(p1Bound.some((l) => l.includes('00000000000000000000ee05')), 'P1: unseen twin ke baawajood bind = ee05 (rendered chat ka captured response)');
  ok(!!(await page.$('#cc-toggle-btn')), 'P1: unique correlation par engine UI aayi');

  // P2: FETCHED identical twin - ab page dd04 bhi kholta hai (bilkul same content).
  // Dono session-captures rendered se consistent -> kaunsa response render hua pata
  // nahi -> AMBIGUOUS -> engine stop, koi UI, koi provider request (fundamental limit:
  // identical-content fetched chats ko koi client logic alag nahi kar sakta).
  pl = pageLogs.length;
  await page.evaluate(() => window.__mockOpenChat('00000000000000000000dd04', 'twin opener', 'twin jawab'));
  expectedFetches.push('00000000000000000000dd04');
  await sleep(3000);
  ok(!pageLogs.slice(pl).some((l) => l.includes('bound verified chat')), 'P2: fetched identical twin -> koi verified bind NAHI');
  ok(pageLogs.slice(pl).some((l) => l.includes('AMBIGUOUS')), 'P2: ambiguity fail-closed log aaya');
  ok(!(await page.$('#cc-toggle-btn')), 'P2: ambiguous mein engine UI NAHI (koi capture/draft)');
  await addIncoming('twin chat mein incoming');
  await sleep(3000);
  ok(backendCalls.length === callsBefore, 'P2: ambiguous window mein koi provider request NAHI (calls=' + backendCalls.length + ')');

  // P3: divergence recovery - dono twins mein ALAG naye messages (dono capture hote
  // hain); rendered thread dd04 wala naya message dikhata hai -> sirf dd04 consistent
  // -> fresh bind dd04. (Render-ahead divergence AKELA prefix-twin ko disambiguate
  // NAHI karta - conservative consistency; doosri twin ka divergent capture zaroori.)
  apiChatData['00000000000000000000ee05'] = [{ role: 'user', content: 'twin opener' }, { role: 'assistant', content: 'twin jawab' }, { role: 'assistant', content: 'ee05 ka alag naya message' }];
  apiChatData['00000000000000000000dd04'] = [{ role: 'user', content: 'twin opener' }, { role: 'assistant', content: 'twin jawab' }, { role: 'assistant', content: 'dd04 ka naya message' }];
  await page.evaluate(() => window.__mockRefetch('00000000000000000000ee05')); // ee05 ka divergent snapshot capture
  expectedFetches.push('00000000000000000000ee05');
  // Thread ko dd04 ke ACTUAL diverged content par set karo (P2 ka probe incoming row
  // hatana zaroori - warna koi bhi twin body render se match nahi karti)
  await page.evaluate(() => {
    const t = document.querySelector('.thread');
    t.innerHTML = '<div class="msg user"><div class="bubble">twin opener</div></div>' +
      '<div class="msg assistant"><div class="steps">s</div><div class="answer">twin jawab</div><button class="chip">c</button></div>' +
      '<div class="msg assistant"><div class="steps">s</div><div class="answer">dd04 ka naya message</div><button class="chip">c</button></div>';
  });
  await page.evaluate(() => window.__mockRefetch('00000000000000000000dd04'));
  expectedFetches.push('00000000000000000000dd04');
  pl = pageLogs.length;
  await sleep(3000);
  ok(pageLogs.slice(pl).some((l) => l.includes('bound verified chat') && l.includes('00000000000000000000dd04')), 'P3: divergence ke baad unique bind = dd04 (recovery)');

  // Q: SITE ka chat fetch FAIL (500) -> koi captured body NAHI -> render unverifiable
  // -> bind NAHI. (Failed fetch ka matlab "non-match" bhi nahi - bas evidence nahi.)
  apiChatData['00000000000000000000ff06'] = [{ role: 'user', content: 'q opener' }, { role: 'assistant', content: 'q jawab' }];
  chatFetchFail.add('00000000000000000000ff06');
  callsBefore = backendCalls.length;
  pl = pageLogs.length;
  await page.evaluate(() => window.__mockOpenChat('00000000000000000000ff06', 'q opener', 'q jawab'));
  expectedFetches.push('00000000000000000000ff06');
  await sleep(3000);
  ok(!pageLogs.slice(pl).some((l) => l.includes('bound verified chat')), 'Q: site ka fetch fail -> koi bind NAHI');
  ok(!(await page.$('#cc-toggle-btn')), 'Q: unverifiable mein engine UI NAHI');
  await addIncoming('error window mein incoming');
  await sleep(3000);
  ok(backendCalls.length === callsBefore, 'Q: failed-fetch window mein koi provider request NAHI (calls=' + backendCalls.length + ')');
  chatFetchFail.clear();

  // S: CACHE/BOOTSTRAP render (KOI fetch nahi) - render ka koi observed network source
  // nahi = bind NAHI. ("Site cacheless hai" sirf time-stamped observation hai, invariant
  // nahi - future caching ka simulation; fail-closed degradation.)
  pl = pageLogs.length;
  await loadChat('bootstrap se aaya opener', 'bootstrap jawab'); // sirf DOM replace, KOI fetch trigger nahi
  await sleep(3000);
  ok(!pageLogs.slice(pl).some((l) => l.includes('bound verified chat')), 'S: bina fetch ke render (cache/bootstrap) -> koi bind NAHI');
  ok(!(await page.$('#cc-toggle-btn')), 'S: unverifiable render par engine UI NAHI');

  // T: DISCARDED overlapping response - page ne ab07 fetch ki PAR response discard
  // karke ALAG source se render kiya. Captured body render se match nahi karti =
  // candidate nahi = bind NAHI (fetch hona != render usi se hona).
  apiChatData['00000000000000000000ab07'] = [{ role: 'user', content: 'discard hua opener' }, { role: 'assistant', content: 'discard jawab' }];
  pl = pageLogs.length;
  await page.evaluate(() => {
    fetch('https://orbix-3av3.onrender.com/api/chats/00000000000000000000ab07').catch(() => {}); // response DISCARD hogi
    const t = document.querySelector('.thread');
    t.innerHTML = '<div class="msg user"><div class="bubble">doosre source ka opener</div></div>' +
      '<div class="msg assistant"><div class="steps">s</div><div class="answer">doosre source ka jawab</div><button class="chip">c</button></div>';
  });
  expectedFetches.push('00000000000000000000ab07');
  await sleep(3000);
  ok(!pageLogs.slice(pl).some((l) => l.includes('bound verified chat')), 'T: discarded response (render alag source se) -> koi bind NAHI');
  ok(!(await page.$('#cc-toggle-btn')), 'T: discarded case mein engine UI NAHI');

  // R: ZERO adapter-initiated API reads (v21) - list endpoint KABHI hit nahi; har
  // detail fetch page-initiated (harness-triggered) hai, exact order mein.
  ok(apiListHits === 0, 'R: adapter ne /api/chats LIST kabhi nahi pukara - enumeration poore tarah khatam (hits=' + apiListHits + ')');
  ok(detailFetches.length === expectedFetches.length && detailFetches.every((id, i) => id === expectedFetches[i]),
    'R: sirf page-initiated detail fetches (' + detailFetches.length + ' vs expected ' + expectedFetches.length + '): ' + JSON.stringify(detailFetches));

  console.log(failures === 0 ? 'ALL LOCAL-BROWSER CHECKS PASSED' : failures + ' CHECKS FAILED');
  await ctx.close();
  server.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('E2E-ERR', e); process.exit(1); });
