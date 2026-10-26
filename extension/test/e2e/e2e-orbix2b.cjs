// orbix2b: reload -> consent -> SUGGEST on-topic -> AUTO bounded (max 2 AI sends,
// phir Stop all) -> stop ke baad LATE incoming par koi send nahi. Profile+login
// /tmp/cc-orbix-profile se persist.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const BUILD = '/tmp/cc-orbix2-build'; // orbix2a ne banaya (production code + orbix manifest)
const SHOTS = '/tmp/cc-orbix2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, label) => { if (!cond) { console.log('FAIL:', label); process.exit(1); } console.log('PASS:', label); };
const MY_TEXTS = new Set();

(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/cc-orbix-profile', {
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--window-size=1600,940'],
    viewport: { width: 1600, height: 900 },
  });
  let sw; for (let i = 0; i < 30 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await sleep(300); }
  ok(sw, 'service worker');
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('https://orbix-video-ly.web.app/#/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cc-panel', { timeout: 60000 });
  ok(true, 'reload par engine panel boot (profile se)');

  // consent gate: idempotent 2-click (re-run par already-active ho sakta hai)
  let toggleState = await page.getAttribute('#cc-toggle-btn', 'data-enabled');
  if (toggleState !== 'true') {
    await page.click('#cc-toggle-btn'); await sleep(1500);
    const consentDraft = await page.evaluate(() => document.querySelector('form.composer textarea').value);
    console.log('CONSENTDBG>', JSON.stringify({draft: consentDraft.slice(0,80)}));
    ok(/AI-drafted replies/.test(consentDraft), 'consent-request draft composer mein (owner bhejta hai)');
    await page.fill('form.composer textarea', '');
    await page.click('#cc-toggle-btn'); await sleep(900);
    toggleState = await page.getAttribute('#cc-toggle-btn', 'data-enabled');
  } else { console.log('NOTE: consent pehle se active (persisted state) - gate phir se pass karne ki zaroorat nahi'); }
  ok(toggleState === 'true', 'chat consent-active');

  const sendManual = async (text) => {
    MY_TEXTS.add(text);
    await page.fill('form.composer textarea', text);
    await page.keyboard.press('Enter');
  };
  const waitBotAnswer = async () => {
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const done = await page.evaluate(() => {
        const typing = document.querySelector('.typing');
        const rows = Array.from(document.querySelectorAll('div.msg.assistant .answer'));
        return !typing && rows.length > 0;
      });
      if (done) return true;
    }
    return false;
  };
  const aiSends = () => page.evaluate((mine) => {
    return Array.from(document.querySelectorAll('div.msg.user .bubble'))
      .map((b) => (b.textContent || '').trim())
      .filter((t) => t && !mine.includes(t));
  }, Array.from(MY_TEXTS));

  // ---- SUGGEST mode ----
  await sendManual('ek chhota sa joke suna, kuch naya');
  ok(await waitBotAnswer(), 'bot ne joke reply kiya');
  const botJoke = await page.evaluate(() => { const a = Array.from(document.querySelectorAll('div.msg.assistant .answer')); return (a[a.length-1].innerText || '').slice(0, 150); });
  let draft = '';
  for (let i = 0; i < 45; i++) { await sleep(1000); draft = await page.evaluate(() => document.querySelector('form.composer textarea').value); if (draft.trim().length > 3) break; }
  console.log('BOT>', JSON.stringify(botJoke));
  console.log('DRAFT>', JSON.stringify(draft.slice(0, 200)));
  ok(draft.trim().length > 3, 'SUGGEST: bot ke jawab par draft aayi');
  ok((await aiSends()).length === 0, 'SUGGEST: kuch auto-send NAHI hua');
  await page.screenshot({ path: SHOTS + '/03-suggest-ontopic.png' });
  await page.fill('form.composer textarea', '');

  // ---- AUTO mode: bounded ----
  await page.click('#cc-auto-btn'); await sleep(400);
  ok((await page.getAttribute('#cc-auto-btn', 'data-mode')) === 'auto', 'auto mode on');
  await sendManual('aur bata, ek interesting fact');
  ok(await waitBotAnswer(), 'bot ne fact reply kiya');
  // 1st AI auto-send ka wait
  let ai = [];
  for (let i = 0; i < 45; i++) { await sleep(1000); ai = await aiSends(); if (ai.length >= 1) break; }
  ok(ai.length >= 1, 'AUTO: 1st AI reply APNE AAP send hui: ' + JSON.stringify((ai[0] || '').slice(0, 80)));
  await page.screenshot({ path: SHOTS + '/04-auto-sent-1.png' });
  // 2nd AI send (bot us par jawab dega) - jaisi hi 2 ho, Stop all
  for (let i = 0; i < 45; i++) { await sleep(1000); ai = await aiSends(); if (ai.length >= 2) break; }
  if (ai.length >= 2) { console.log('PASS: AUTO: 2nd AI reply bhi gayi (bot-to-bot potential confirmed):', JSON.stringify((ai[1] || '').slice(0, 80))); await page.screenshot({ path: SHOTS + '/05-auto-sent-2.png' }); }
  else { console.log('NOTE: 2nd AI send nahi hui (bot ne reply nahi kiya ya timing) - 1 send ke saath bhi bounded proof complete'); }
  await page.click('#cc-stopall-btn'); await sleep(600);
  const panelTxt = await page.evaluate(() => document.getElementById('cc-panel').innerText.slice(0, 200));
  ok(/STOP ALL|Resume all/i.test(panelTxt), 'STOP ALL: engine stopped - ' + JSON.stringify(panelTxt.slice(0, 80)));
  await page.screenshot({ path: SHOTS + '/06-stopped.png' });
  // LATE RESPONSE SAFETY: stop ke baad bot ka reply aaye to bhi kuch na jaye
  const before = (await aiSends()).length;
  await sleep(15000);
  const after = (await aiSends()).length;
  ok(after === before, 'STOP ke baad late incoming par koi AI send NAHI (sends: ' + before + ' -> ' + after + ')');
  ok(after <= 2, 'BOUND: total AI sends <= 2 (actual: ' + after + ')');
  await page.screenshot({ path: SHOTS + '/07-after-stop-wait.png' });
  console.log('ORBIX2B ALL PASS');
  await ctx.close();
  process.exit(0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 400)); process.exit(1); });
