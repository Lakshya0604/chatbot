// engine.fixture.test.mjs - platform-agnostic engine ka integration test.
// GENERIC fake chat-app DOM par chalta hai (kisi real website ke selectors nahi).
// Verify karta hai: suggestion sahi jagah aati hai, chat switch par reply galat
// chat mein NAHI jaati, user ka text overwrite nahi hota, disabled/unknown chat
// mein kuch nahi hota, duplicate trigger nahi hota.
// NOTE: ye engine ke behavior ka proof hai, kisi platform ke selectors ka nahi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const SCRIPT = fs.readFileSync(new URL('../content/engine.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BATCH = 40;

// Generic fixture config - kisi fictional chat app ke selectors.
const CONFIG = {
  rowsSelector: '.msg',
  isIncoming: (row) => row.classList.contains('in'),
  getText: (row) => { const el = row.querySelector('.txt'); return el ? el.innerText : ''; },
  getChatKey: (doc) => {
    const rows = doc.querySelectorAll('.msg[data-chat]');
    const last = rows[rows.length - 1];
    return last ? 'id:' + last.getAttribute('data-chat') : null;
  },
  composerSelector: '.composer .box[contenteditable="true"]',
  headerSelector: '.chat-header',
  footerSelector: '.composer',
  rootSelector: '#app',
  sendSelector: '.composer .send',
  consentMessage: 'Is chat ke messages AI provider ko bheje jaayenge. OK?',
  consentRequestText: 'Heads up: is chat mein AI-drafted replies aa sakti hain. Okay? (stop likhne par band)',
  aiMarker: ' (AI)',
};

function chatHtml(chatId, messages) {
  const rows = messages
    .map((m, i) => `<div class="msg ${m.out ? 'out' : 'in'}" data-chat="${chatId}"><span class="txt">${m.text}</span></div>`)
    .join('');
  return `
    <div id="app"><div class="screen">
      <div class="chat-header"><span>Chat</span></div>
      <div class="msgs">${rows}</div>
      <div class="composer"><div class="box" contenteditable="true"></div><button class="send" type="button">Send</button></div>
    </div></div>`;
}

function makeWorld({ sendMessage, initialHtml, seedLocal, testConfig, visionVerify, extra }, t) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${initialHtml}</body></html>`, {
    url: 'https://chat.example/', runScripts: 'dangerously',
  });
  const { window } = dom;
  t.after(() => window.close());

  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; }, set(v) { this.textContent = v; }, configurable: true,
  });
  window.document.execCommand = (cmd, ui, text) => {
    const el = window.document.activeElement;
    if (el) el.textContent += text;
    return true;
  };
  window.confirm = () => true;

  const store = { local: seedLocal || {}, sync: { character: { name: 'TestBot' } } };
  const calls = [];
  window.chrome = {
    storage: {
      local: { get: (k, cb) => cb({ [k]: store.local[k] }), set: (o, cb) => { Object.assign(store.local, o); cb(); } },
      sync: { get: (k, cb) => cb({ [k]: store.sync[k] }), set: (o, cb) => { Object.assign(store.sync, o); cb(); } },
    },
    runtime: { sendMessage: (msg) => { calls.push(msg); return sendMessage(msg); } },
  };

  window.__CC_TEST__ = Object.assign({ BATCH_DELAY_MS: BATCH }, testConfig || {});
  window.eval(SCRIPT);
  window.ChatEngine.createChatAssistant(Object.assign({}, CONFIG, visionVerify ? { visionVerify } : {}, extra || {}));
  return { window, calls, store };
}

const composerOf = (w) => w.document.querySelector('.composer .box');

async function primeHistory(window) {
  // Engine first-bind par visible history BASELINE karta hai (bina trigger) -
  // real sites par history boot ke baad render hoti hai = priming mutation.
  // Fixture mein history pre-rendered hai, isliye no-op mutation se prime karo.
  const msgs = window.document.querySelector('.msgs');
  const tmp = window.document.createElement('span');
  msgs.appendChild(tmp);
  tmp.remove();
  await sleep(BATCH + 120);
}

const bannerText = (w) => { const b = w.document.getElementById('cc-banner'); return b ? b.textContent : ''; };

async function enableChat(window) {
  await sleep(60);
  const btn = window.document.getElementById('cc-toggle-btn');
  assert.ok(btn, 'toggle dikhna chahiye (stable id wali chat mein)');
  btn.click(); // step 1: owner consent + recipient consent-request draft
  await sleep(60);
  assert.equal(btn.dataset.enabled, 'false', 'pehle click ke baad bhi AI dormant rahe (consent pending)');
  btn.click(); // step 2: owner confirms recipient ne haan kaha
  await sleep(60);
  assert.equal(btn.dataset.enabled, 'true', 'recipient consent confirm hone par AI active');
  // Owner ne consent request send kar di (manual) - composer khaali.
  const composer = window.document.querySelector('.composer .box');
  composer.textContent = '';
}

function appendIncoming(window, chatId, text, i = 99) {
  const msgs = window.document.querySelector('.msgs');
  const row = window.document.createElement('div');
  row.className = 'msg in';
  row.setAttribute('data-chat', chatId);
  row.innerHTML = `<span class="txt">${text}</span>`;
  msgs.appendChild(row);
}

function appendOutgoing(window, chatId, text) {
  const msgs = window.document.querySelector('.msgs');
  const row = window.document.createElement('div');
  row.className = 'msg out';
  row.setAttribute('data-chat', chatId);
  row.innerHTML = `<span class="txt">${text}</span>`;
  msgs.appendChild(row);
}

function switchChat(window, chatId, messages) {
  window.document.querySelector('.screen').innerHTML = chatHtml(chatId, messages)
    .replace(/<div id="app"><div class="screen">|<\/div><\/div>$/g, '');
}



function wireSend(window) {
  const sent = [];
  const btn = window.document.querySelector('.composer .send');
  btn.addEventListener('click', () => {
    const box = window.document.querySelector('.composer .box');
    const text = (box.textContent || '').trim();
    if (!text) return;
    sent.push(text);
    box.textContent = '';
    appendOutgoing(window, 'aaa', text);
  });
  return sent;
}
async function enableAuto(window) {
  const b = window.document.getElementById('cc-auto-btn');
  b.click(); await sleep(80);
  assert.equal(b.dataset.mode, 'auto');
}
// store.local.visionConfig live-read: visionRequired config storage se padhta hai (adapter jaisa)
const liveRequired = (store) => async () => { const c = store.local.visionConfig; return !!c && c.enabled !== false; };
async function auto(t, { vv, seed, withRequiredFn = true, noVV = false }) {
  const store = { ref: null };
  const w = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'AI JAWAB' } }),
    initialHtml: chatHtml('aaa', [{ out: true, text: 'pichla jawab' }]),
    seedLocal: JSON.parse(JSON.stringify(seed || {})),
    visionVerify: noVV ? undefined : vv,
    extra: withRequiredFn ? { visionRequired: async () => { const c = w.store.local.visionConfig; return !!c && c.enabled !== false; } } : {},
  }, t);
  const sent = wireSend(w.window);
  await enableChat(w.window); await primeHistory(w.window); await enableAuto(w.window);
  return { w, sent };
}
const CFG = { visionConfig: { provider: 'cloudflare', accountId: 'a'.repeat(32), apiKey: 'x', enabled: true } };

test('INVARIANT configured + gate ok:true -> auto-send hota hai, token single-use', async (t) => {
  let n = 0;
  const { w, sent } = await auto(t, { vv: async () => { n++; return { ok: true }; }, seed: CFG });
  appendIncoming(w.window, 'aaa', 'hello ji'); await sleep(400);
  assert.equal(n, 1); assert.deepEqual(sent, ['AI JAWAB (AI)']);
});
test('INVARIANT configured + gate ok:false/undefined/skipped/throw -> auto-send NAHI', async (t) => {
  for (const v of [{ ok: false, reason: 'x' }, undefined, { ok: true, skipped: true }, 'throw']) {
    const { w, sent } = await auto(t, { vv: async () => { if (v === 'throw') throw new Error('b'); return v; }, seed: CFG });
    appendIncoming(w.window, 'aaa', 'hello ji'); await sleep(400);
    assert.deepEqual(sent, [], 'no send for ' + JSON.stringify(v));
  }
});
test('INVARIANT configured but NO gate function (never invoked) -> send nahi, GENERATE_REPLY bhi nahi', async (t) => {
  const { w, sent } = await auto(t, { noVV: true, seed: CFG });
  appendIncoming(w.window, 'aaa', 'hello ji'); await sleep(400);
  assert.deepEqual(sent, []); assert.equal(w.calls.length, 0);
});
test('INVARIANT config seeded AFTER engine init (late seed) -> gate phir bhi mandatory (0-call autosend root cause)', async (t) => {
  let n = 0;
  const { w, sent } = await auto(t, { vv: async () => { n++; return { ok: false, reason: 'no' }; }, seed: {} });
  w.store.local.visionConfig = CFG.visionConfig; // init ke baad
  appendIncoming(w.window, 'aaa', 'hello ji'); await sleep(400);
  assert.equal(n, 1, 'gate chala'); assert.deepEqual(sent, []);
});
test('INVARIANT required fn throws / storage unreadable -> fail closed', async (t) => {
  const w = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'AI JAWAB' } }),
    initialHtml: chatHtml('aaa', [{ out: true, text: 'pichla' }]),
    visionVerify: async () => ({ ok: true }),
    extra: { visionRequired: async () => { throw new Error('storage dead'); } },
  }, t);
  const sent = wireSend(w.window);
  await enableChat(w.window); await primeHistory(w.window); await enableAuto(w.window);
  appendIncoming(w.window, 'aaa', 'hello ji'); await sleep(400);
  assert.equal(sent.length, 1, 'required=true, gate ok -> gate se hi guzra'); // throws => required, gate ok:true
  const w2 = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'AI JAWAB' } }),
    initialHtml: chatHtml('aaa', [{ out: true, text: 'pichla' }]),
    visionVerify: async () => ({ ok: false, reason: 'n' }),
    extra: { visionRequired: async () => { throw new Error('storage dead'); } },
  }, t);
  const sent2 = wireSend(w2.window);
  await enableChat(w2.window); await primeHistory(w2.window); await enableAuto(w2.window);
  appendIncoming(w2.window, 'aaa', 'hello ji'); await sleep(400);
  assert.deepEqual(sent2, []);
});
test('INVARIANT disabled config (enabled:false) -> legacy path, send hota hai (user ne khud band kiya)', async (t) => {
  let n = 0;
  const { w, sent } = await auto(t, { vv: async () => { n++; return { ok: false }; }, seed: { visionConfig: Object.assign({}, CFG.visionConfig, { enabled: false }) } });
  appendIncoming(w.window, 'aaa', 'hello ji'); await sleep(400);
  assert.equal(n, 0); assert.deepEqual(sent, ['AI JAWAB (AI)']);
});
test('INVARIANT last message gate ke dauran badal gaya -> purane text ka verdict par send nahi', async (t) => {
  let release; const hold = new Promise((r) => { release = r; });
  const texts = [];
  const { w, sent } = await auto(t, { vv: async (txt) => { texts.push(txt); if (texts.length === 1) await hold; return { ok: true }; }, seed: CFG });
  appendIncoming(w.window, 'aaa', 'hello ji'); await sleep(200);
  appendIncoming(w.window, 'aaa', 'doosra naya msg');
  release(); await sleep(800);
  assert.equal(texts[0], 'hello ji');
  // koi send hua to sirf aise reply jiska gate us waqt ke last incoming par ok tha
  assert.ok(sent.length === 0 || texts.includes('doosra naya msg'), 'send without gate for current last: ' + JSON.stringify({ sent, texts }));
});
test('INVARIANT repeated same-text messages: har naye message ka apna gate (token single-use)', async (t) => {
  let n = 0;
  const { w, sent } = await auto(t, { vv: async () => { n++; return { ok: true }; }, seed: CFG });
  appendIncoming(w.window, 'aaa', 'same text'); await sleep(450);
  appendIncoming(w.window, 'aaa', 'same text'); await sleep(450);
  assert.equal(sent.length, n, 'har send ka apna gate (engine same-text dedupe kar sakta hai)'); assert.ok(n >= 1);
});
test('INVARIANT vision mode mein follow-up bina gate generate nahi hota', async (t) => {
  const { w, sent } = await auto(t, { vv: async () => ({ ok: true }), seed: CFG });
  appendIncoming(w.window, 'aaa', 'hello'); await sleep(450);
  const callsAfter = w.calls.length;
  await sleep(1500);
  assert.equal(w.calls.length, callsAfter); assert.equal(sent.length, 1);
});
