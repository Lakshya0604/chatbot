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
      <div class="composer"><div class="box" contenteditable="true"></div></div>
    </div></div>`;
}

function makeWorld({ sendMessage, initialHtml }, t) {
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

  const store = { local: {}, sync: { character: { name: 'TestBot' } } };
  const calls = [];
  window.chrome = {
    storage: {
      local: { get: (k, cb) => cb({ [k]: store.local[k] }), set: (o, cb) => { Object.assign(store.local, o); cb(); } },
      sync: { get: (k, cb) => cb({ [k]: store.sync[k] }), set: (o, cb) => { Object.assign(store.sync, o); cb(); } },
    },
    runtime: { sendMessage: (msg) => { calls.push(msg); return sendMessage(msg); } },
  };

  window.__CC_TEST__ = { BATCH_DELAY_MS: BATCH };
  window.eval(SCRIPT);
  window.ChatEngine.createChatAssistant(CONFIG);
  return { window, calls, store };
}

const composerOf = (w) => w.document.querySelector('.composer .box');
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

function switchChat(window, chatId, messages) {
  window.document.querySelector('.screen').innerHTML = chatHtml(chatId, messages)
    .replace(/<div id="app"><div class="screen">|<\/div><\/div>$/g, '');
}

test('happy path: naye incoming par suggestion composer mein (send NAHI)', async (t) => {
  const reply = 'AI DRAFT REPLY';
  const { window, calls } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply } }),
    initialHtml: chatHtml('aaa', [{ out: true, text: 'pichla jawab' }]),
  }, t);
  await enableChat(window);
  appendIncoming(window, 'aaa', 'hello ji');
  await sleep(250);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.messages.at(-1).role, 'user');
  assert.equal(calls[0].payload.authToken, undefined, 'engine token kabhi na bheje');
  assert.equal(composerOf(window).textContent, reply + ' (AI)', 'marker ke saath suggestion');
  assert.ok(bannerText(window).includes('KHUD send dabao'), bannerText(window));
});

test('RACE: chat switch ke dauraan reply doosri chat mein NAHI jaati', async (t) => {
  let resolveReply;
  const pending = new Promise((r) => { resolveReply = r; });
  const { window } = makeWorld({
    sendMessage: () => pending,
    initialHtml: chatHtml('aaa', [{ out: true, text: 'A ka pichla' }]),
  }, t);
  await enableChat(window);
  appendIncoming(window, 'aaa', 'A ka naya message');
  await sleep(BATCH + 80);

  switchChat(window, 'bbb', [{ out: false, text: 'B ka message' }]);
  await sleep(80);
  resolveReply({ ok: true, data: { reply: 'REPLY FOR A' } });
  await sleep(120);

  assert.equal(composerOf(window).textContent, '', 'B ka composer khaali rahe');
  assert.ok(!bannerText(window).includes('REPLY FOR A'));

  switchChat(window, 'aaa', [{ out: true, text: 'A ka pichla' }, { out: false, text: 'A ka naya message' }]);
  await sleep(120);
  const got = composerOf(window).textContent || bannerText(window);
  assert.ok(got.includes('REPLY FOR A'), 'wapas A par aane par suggestion deliver ho');
});

test('composer mein user text ho to overwrite nahi hota (banner fallback)', async (t) => {
  const { window } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'SUGGESTED' } }),
    initialHtml: chatHtml('aaa', [{ out: true, text: 'old' }]),
  }, t);
  await enableChat(window);
  composerOf(window).textContent = 'mera apna draft';
  appendIncoming(window, 'aaa', 'kya haal');
  await sleep(250);

  assert.equal(composerOf(window).textContent, 'mera apna draft');
  assert.ok(bannerText(window).includes('SUGGESTED'));
});

test('disabled chat par koi request nahi jaati', async (t) => {
  const { window, calls } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'x' } }),
    initialHtml: chatHtml('aaa', [{ out: true, text: 'old' }]),
  }, t);
  await sleep(60);
  appendIncoming(window, 'aaa', 'hello');
  await sleep(250);
  assert.equal(calls.length, 0);
});

test('same message par duplicate trigger nahi hota', async (t) => {
  const { window, calls } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'r' } }),
    initialHtml: chatHtml('aaa', [{ out: true, text: 'old' }]),
  }, t);
  await enableChat(window);
  appendIncoming(window, 'aaa', 'ek hi message');
  await sleep(250);
  window.document.querySelector('.msgs').appendChild(window.document.createElement('span'));
  await sleep(250);
  assert.equal(calls.length, 1);
});

test('FAIL CLOSED: stable id ke bina toggle hi nahi banta, koi request nahi', async (t) => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="app"><div class="screen">
      <div class="chat-header"><span>Sirf Naam</span></div>
      <div class="msgs"></div>
      <div class="composer"><div class="box" contenteditable="true"></div></div>
    </div></div></body></html>`, { url: 'https://chat.example/', runScripts: 'dangerously' });
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
  window.ChatEngine.createChatAssistant(CONFIG);
  await sleep(120);

  assert.equal(window.document.getElementById('cc-toggle-btn'), null, 'bina stable id toggle nahi');

  const msgs = window.document.querySelector('.msgs');
  msgs.innerHTML = '<div class="msg in"><span class="txt">hi</span></div>';
  await sleep(250);
  assert.equal(calls.length, 0);
});

test('CONSENT GATE: pending state mein incoming par koi AI request nahi jaati', async (t) => {
  const { window, calls } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'x' } }),
    initialHtml: chatHtml('aaa', [{ out: true, text: 'old' }]),
  }, t);
  await sleep(60);
  const btn = window.document.getElementById('cc-toggle-btn');
  btn.click(); // sirf step 1 - recipient consent confirm NAHI hui
  await sleep(60);
  assert.ok(composerOf(window).textContent.includes('Heads up'), 'consent request draft composer mein');

  appendIncoming(window, 'aaa', 'hello');
  await sleep(250);
  assert.equal(calls.length, 0, 'recipient consent ke bina zero AI requests');
});

test('STOP GATE: saamne wala stop kahe to chat band, message AI ko nahi jaata', async (t) => {
  const { window, calls, store } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'x' } }),
    initialHtml: chatHtml('aaa', [{ out: true, text: 'old' }]),
  }, t);
  await enableChat(window);

  appendIncoming(window, 'aaa', 'please stop');
  await sleep(250);
  assert.equal(calls.length, 0, 'stop message AI provider ko nahi gaya');
  const btn = window.document.getElementById('cc-toggle-btn');
  assert.equal(btn.textContent, 'Stopped', 'chat stopped state mein');
  assert.ok(bannerText(window).includes('band kar diya'), 'owner ko stop notification');

  // Stop ke baad normal message bhi process nahi hota.
  appendIncoming(window, 'aaa', 'hello again', 100);
  await sleep(250);
  assert.equal(calls.length, 0, 'stopped chat mein kuch process nahi hota');

  // Consent log mein dono events (active + stopped) record hue.
  const log = store.local.consentLog || [];
  assert.ok(log.some((e) => e.state === 'active'), 'activation logged');
  assert.ok(log.some((e) => e.state === 'stopped'), 'stop logged');
});

test('owner off kare to turant band aur naye incoming par kuch nahi', async (t) => {
  const { window, calls } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'x' } }),
    initialHtml: chatHtml('aaa', [{ out: true, text: 'old' }]),
  }, t);
  await enableChat(window);
  const btn = window.document.getElementById('cc-toggle-btn');
  btn.click(); // active -> off
  await sleep(60);
  appendIncoming(window, 'aaa', 'hello');
  await sleep(250);
  assert.equal(calls.length, 0);
});

test('ACTIVATION SNAPSHOT: enable karte hi purana incoming message trigger NAHI hota', async (t) => {
  const { window, calls } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'x' } }),
    initialHtml: chatHtml('aaa', [{ out: false, text: 'bahut purana incoming' }]),
  }, t);
  await enableChat(window);
  await sleep(250);
  assert.equal(calls.length, 0, 'activation se pehle ka message kabhi AI ko nahi jaana chahiye');

  appendIncoming(window, 'aaa', 'ab naya aaya');
  await sleep(250);
  assert.equal(calls.length, 1, 'activation ke baad ka naya message trigger hota hai');
});

test('IN-FLIGHT CANCEL: reply aane se pehle owner off kare to late reply discard hoti hai', async (t) => {
  let resolveReply;
  const pending = new Promise((r) => { resolveReply = r; });
  const { window } = makeWorld({
    sendMessage: () => pending,
    initialHtml: chatHtml('aaa', [{ out: true, text: 'old' }]),
  }, t);
  await enableChat(window);
  appendIncoming(window, 'aaa', 'hello ji');
  await sleep(120); // batch fire ho gayi, request in-flight
  const btn = window.document.getElementById('cc-toggle-btn');
  btn.click(); // owner off, reply abhi nahi aayi
  await sleep(60);
  resolveReply({ ok: true, data: { reply: 'LATE REPLY' } });
  await sleep(120);
  assert.equal(composerOf(window).textContent, '', 'late reply insert NAHI hui');
  const stored = window.document.querySelector('.msgs').textContent;
  assert.ok(!stored.includes('LATE REPLY'));
});

test('STOP ALL: global stop par koi request nahi, in-flight discard; resume explicit', async (t) => {
  let resolveReply;
  const pending = new Promise((r) => { resolveReply = r; });
  const { window, calls } = makeWorld({
    sendMessage: (m) => { return pending; },
    initialHtml: chatHtml('aaa', [{ out: true, text: 'old' }]),
  }, t);
  await enableChat(window);
  const stopAllBtn = window.document.getElementById('cc-stopall-btn');
  assert.ok(stopAllBtn, 'Stop all button dikhna chahiye');

  appendIncoming(window, 'aaa', 'pehla');
  await sleep(120); // request in-flight
  stopAllBtn.click(); // STOP ALL
  await sleep(80);
  resolveReply({ ok: true, data: { reply: 'LATE GLOBAL' } });
  await sleep(120);
  assert.equal(composerOf(window).textContent, '', 'global stop ke baad late reply discard');

  const callsBefore = calls.length;
  appendIncoming(window, 'aaa', 'doosra', 100);
  await sleep(250);
  assert.equal(calls.length, callsBefore, 'stopped state mein naya incoming trigger nahi');

  stopAllBtn.click(); // Resume all (explicit)
  await sleep(80);
  appendIncoming(window, 'aaa', 'teesra', 101);
  await sleep(250);
  assert.equal(calls.length, callsBefore + 1, 'resume ke baad naya message phir trigger hota hai');
});
