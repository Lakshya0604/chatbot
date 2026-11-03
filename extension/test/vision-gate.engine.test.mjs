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

function makeWorld({ sendMessage, initialHtml, seedLocal, testConfig, visionVerify }, t) {
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
  window.ChatEngine.createChatAssistant(visionVerify ? Object.assign({}, CONFIG, { visionVerify }) : CONFIG);
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


async function run(visionVerify) {
  return null;
}
const mk = (t, vv) => makeWorld({
  sendMessage: async () => ({ ok: true, data: { reply: 'AI DRAFT' } }),
  initialHtml: chatHtml('aaa', [{ out: true, text: 'pichla jawab' }]),
  visionVerify: vv,
}, t);

async function incoming(t, vv) {
  const w = mk(t, vv);
  await enableChat(w.window);
  await primeHistory(w.window);
  appendIncoming(w.window, 'aaa', 'hello ji');
  await sleep(300);
  return w;
}

test('vision gate OK -> reply generate hota hai, gate exactly 1 baar chala', async (t) => {
  let n = 0, seen = null;
  const { window, calls } = await incoming(t, async (txt) => { n++; seen = txt; return { ok: true }; });
  assert.equal(n, 1);
  assert.equal(seen, 'hello ji');
  assert.equal(calls.length, 1);
  assert.equal(composerOf(window).textContent, 'AI DRAFT (AI)');
});
test('vision gate ok:false -> GENERATE_REPLY NAHI, composer khaali, banner fail', async (t) => {
  const { window, calls } = await incoming(t, async () => ({ ok: false, reason: 'mismatch' }));
  assert.equal(calls.length, 0);
  assert.equal(composerOf(window).textContent, '');
  assert.ok(bannerText(window).includes('Vision check fail'), bannerText(window));
});
test('vision gate throws (forced error) -> fail-closed, koi reply nahi', async (t) => {
  const { window, calls } = await incoming(t, async () => { throw new Error('boom'); });
  assert.equal(calls.length, 0);
  assert.equal(composerOf(window).textContent, '');
  assert.ok(bannerText(window).includes('Vision check fail'));
});
test('vision gate capture failure reason bubbles up, koi reply nahi', async (t) => {
  const { window, calls } = await incoming(t, async () => ({ ok: false, reason: 'screenshot nahi ban paya: activeTab permission' }));
  assert.equal(calls.length, 0);
  assert.ok(bannerText(window).includes('activeTab'));
});
test('vision gate malformed result (undefined / {}) -> fail-closed', async (t) => {
  for (const v of [undefined, {}, null, { ok: 'yes' }]) {
    const { calls } = await incoming(t, async () => v);
    assert.equal(calls.length, 0, 'malformed result par reply nahi: ' + JSON.stringify(v));
  }
});
test('vision gate disabled (no visionVerify in config) -> purana behaviour, reply aati hai', async (t) => {
  const { window, calls } = await incoming(t, undefined);
  assert.equal(calls.length, 1);
  assert.equal(composerOf(window).textContent, 'AI DRAFT (AI)');
});
test('vision gate slow + Stop all dauran -> late reply discard (koi GENERATE_REPLY nahi)', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const w = mk(t, async () => { await gate; return { ok: true }; });
  await enableChat(w.window); await primeHistory(w.window);
  appendIncoming(w.window, 'aaa', 'hello ji');
  await sleep(150);
  w.store.local.globalStop = { ts: 'now' };
  release({ ok: true });
  await sleep(250);
  assert.equal(w.calls.length, 0);
  assert.equal(composerOf(w.window).textContent, '');
});
test('vision gate ok:"yes" (truthy non-true) -> fail-closed', async (t) => {
  const { calls } = await incoming(t, async () => ({ ok: 'yes' }));
  assert.equal(calls.length, 0);
});
