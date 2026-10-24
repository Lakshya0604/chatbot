// whatsapp.fixture.test.mjs - content script ka integration test, FAKE WhatsApp DOM par.
// Real WhatsApp Web / real contacts use nahi hote. jsdom mein WhatsApp jaise
// selectors banaye hain (#main header, .message-in/out[data-id], footer textbox)
// aur chrome.* APIs ko in-memory stub kiya hai.
// Isse verify hota hai: suggestion sahi jagah aati hai, chat switch par reply
// galat chat mein NAHI jaati, aur disabled/unknown chat mein kuch nahi hota.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const SCRIPT = fs.readFileSync(new URL('../content/whatsapp.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BATCH = 40; // test override: real 2500ms ki jagah 40ms

// ---------- fixture helpers ----------
function chatHtml(jid, messages) {
  const rows = messages
    .map((m, i) => `<div class="${m.out ? 'message-out' : 'message-in'}" data-id="${m.out ? 'false' : 'true'}_${jid}_MSG${i}"><span class="selectable-text">${m.text}</span></div>`)
    .join('');
  return `
    <div id="app"><div id="main">
      <header><span title="Test Chat">Test Chat</span></header>
      <div id="msgs">${rows}</div>
      <footer><div contenteditable="true" role="textbox"></div></footer>
    </div></div>`;
}

function makeWorld({ sendMessage, initialHtml }) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${initialHtml}</body></html>`, { url: 'https://web.whatsapp.com/', runScripts: 'dangerously' });
  const { window } = dom;

  // jsdom mein innerText nahi hota - textContent se polyfill (test-only).
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    set(v) { this.textContent = v; },
    configurable: true,
  });
  // execCommand bhi nahi hota - focused element mein text daalne ka stub (test-only).
  window.document.execCommand = (cmd, ui, text) => {
    const el = window.document.activeElement;
    if (el) el.textContent += text;
    return true;
  };
  window.confirm = () => true; // consent dialog auto-accept (behavior alag test hota hai)

  // chrome.* in-memory stub
  const store = { local: {}, sync: { character: { name: 'TestBot' } } };
  const calls = [];
  window.chrome = {
    storage: {
      local: {
        get: (k, cb) => cb({ [k]: store.local[k] }),
        set: (o, cb) => { Object.assign(store.local, o); cb(); },
      },
      sync: {
        get: (k, cb) => cb({ [k]: store.sync[k] }),
        set: (o, cb) => { Object.assign(store.sync, o); cb(); },
      },
    },
    runtime: {
      sendMessage: (msg) => { calls.push(msg); return sendMessage(msg); },
    },
  };

  window.__CC_TEST__ = { BATCH_DELAY_MS: BATCH };
  window.eval(SCRIPT); // content script load (boot() chalega)
  return { window, calls, store };
}

const composerOf = (window) => window.document.querySelector('#main footer div[contenteditable="true"][role="textbox"]');
const bannerText = (window) => {
  const b = window.document.getElementById('cc-banner');
  return b ? b.textContent : '';
};

async function enableChat(window) {
  await sleep(60); // boot + refreshToggle
  const btn = window.document.getElementById('cc-toggle-btn');
  assert.ok(btn, 'toggle button dikhna chahiye (data-id wali chat mein)');
  btn.click();
  await sleep(60);
  assert.equal(btn.dataset.enabled, 'true', 'toggle on hona chahiye');
}

function appendIncoming(window, jid, text, i = 99) {
  const msgs = window.document.getElementById('msgs');
  const row = window.document.createElement('div');
  row.className = 'message-in';
  row.setAttribute('data-id', `true_${jid}_MSG${i}`);
  row.innerHTML = `<span class="selectable-text">${text}</span>`;
  msgs.appendChild(row);
}

// ---------- tests ----------
test('happy path: naye incoming par suggestion composer mein aati hai (send NAHI hota)', async (t) => {
  const reply = 'AI DRAFT REPLY';
  const { window, calls } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply } }),
    initialHtml: chatHtml('aaa@c.us', [{ out: true, text: 'pichla jawab' }]),
  });
  t.after(() => window.close());
  await enableChat(window);
  appendIncoming(window, 'aaa@c.us', 'hello ji');
  await sleep(250);

  assert.equal(calls.length, 1, 'ek backend request honi chahiye');
  assert.equal(calls[0].type, 'GENERATE_REPLY');
  assert.equal(calls[0].payload.messages.at(-1).role, 'user');
  assert.equal(calls[0].payload.authToken, undefined, 'content script token kabhi na bheje');
  assert.equal(composerOf(window).textContent, reply, 'composer mein suggestion insert hui');
  assert.ok(bannerText(window).includes('khud send dabao'), 'banner manual-send remind kare');
});

test('RACE: chat switch ke dauraan reply doosri chat mein NAHI jaati, wapas aane par milti hai', async (t) => {
  let resolveReply;
  const pending = new Promise((r) => { resolveReply = r; });
  const { window } = makeWorld({
    sendMessage: () => pending,
    initialHtml: chatHtml('aaa@c.us', [{ out: true, text: 'A ka pichla' }]),
  });
  t.after(() => window.close());
  await enableChat(window);
  appendIncoming(window, 'aaa@c.us', 'A ka naya message');
  await sleep(BATCH + 80); // request flight mein (busy)

  // User chat B par switch karta hai - poore #main ka DOM badalta hai.
  window.document.getElementById('main').innerHTML = `
    <header><span title="Doosri Chat">Doosri Chat</span></header>
    <div id="msgs"><div class="message-in" data-id="true_bbb@c.us_M1"><span class="selectable-text">B ka message</span></div></div>
    <footer><div contenteditable="true" role="textbox"></div></footer>`;
  await sleep(80);

  resolveReply({ ok: true, data: { reply: 'REPLY FOR A' } });
  await sleep(120);

  assert.equal(composerOf(window).textContent, '', 'B ka composer khaali rahe - cross-chat leak nahi');
  assert.ok(!bannerText(window).includes('REPLY FOR A'), 'B mein A ka suggestion banner nahi');

  // Wapas chat A par - pending suggestion ab deliver honi chahiye.
  window.document.getElementById('main').innerHTML = chatHtml('aaa@c.us', [
    { out: true, text: 'A ka pichla' },
    { out: false, text: 'A ka naya message' },
  ]).match(/<div id="main">([\s\S]*)<\/div><\/div>/)[1].replace(/<\/div>$/, '');
  await sleep(120);

  const composer = composerOf(window);
  const got = composer.textContent || bannerText(window);
  assert.ok(got.includes('REPLY FOR A'), 'wapas A par aane par suggestion deliver ho');
});

test('composer mein user ka text ho to overwrite nahi hota (banner fallback)', async (t) => {
  const reply = 'SUGGESTED TEXT';
  const { window } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply } }),
    initialHtml: chatHtml('aaa@c.us', [{ out: true, text: 'old' }]),
  });
  t.after(() => window.close());
  await enableChat(window);
  composerOf(window).textContent = 'mera apna draft';
  appendIncoming(window, 'aaa@c.us', 'kya haal');
  await sleep(250);

  assert.equal(composerOf(window).textContent, 'mera apna draft', 'user ka text safe rahe');
  assert.ok(bannerText(window).includes(reply), 'suggestion banner mein dikhe');
});

test('disabled chat par koi backend request nahi jaati', async (t) => {
  const { window, calls } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'x' } }),
    initialHtml: chatHtml('aaa@c.us', [{ out: true, text: 'old' }]),
  });
  t.after(() => window.close());
  await sleep(60); // boot; toggle OFF hi rehta hai
  appendIncoming(window, 'aaa@c.us', 'hello');
  await sleep(250);
  assert.equal(calls.length, 0, 'disabled chat = zero requests');
});

test('same message par duplicate trigger nahi hota', async (t) => {
  const { window, calls } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'r' } }),
    initialHtml: chatHtml('aaa@c.us', [{ out: true, text: 'old' }]),
  });
  t.after(() => window.close());
  await enableChat(window);
  appendIncoming(window, 'aaa@c.us', 'ek hi message');
  await sleep(250);
  // Unrelated DOM change - naya message nahi, sirf mutation.
  window.document.getElementById('msgs').appendChild(window.document.createElement('span'));
  await sleep(250);
  assert.equal(calls.length, 1, 'ek hi incoming ke liye sirf ek request');
});

test('FAIL CLOSED: data-id ke bina chat key nahi banti, toggle hi nahi aata', async (t) => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="app"><div id="main">
      <header><span title="Sirf Naam">Sirf Naam</span></header>
      <div id="msgs"></div>
      <footer><div contenteditable="true" role="textbox"></div></footer>
    </div></div></body></html>`, { url: 'https://web.whatsapp.com/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; }, set(v) { this.textContent = v; }, configurable: true,
  });
  const calls = [];
  window.chrome = {
    storage: {
      local: { get: (k, cb) => cb({}), set: (o, cb) => cb() },
      sync: { get: (k, cb) => cb({}), set: (o, cb) => cb() },
    },
    runtime: { sendMessage: (m) => { calls.push(m); return Promise.resolve({ ok: true, data: { reply: 'x' } }); } },
  };
  window.__CC_TEST__ = { BATCH_DELAY_MS: BATCH };
  window.eval(SCRIPT);
  await sleep(120);

  assert.equal(window.document.getElementById('cc-toggle-btn'), null,
    'display-name fallback nahi: bina data-id ke toggle nahi banna chahiye');

  // Message aaye par usme data-id na ho (selector drift ka scenario) - phir bhi kuch nahi hona chahiye.
  const msgs = window.document.getElementById('msgs');
  msgs.innerHTML = '<div class="message-in"><span class="selectable-text">hi</span></div>';
  await sleep(250);
  assert.equal(calls.length, 0, 'unknown identity chat mein kabhi request nahi');
});
