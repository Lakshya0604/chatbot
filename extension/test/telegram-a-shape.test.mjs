// telegram-a-shape.test.mjs - COPY-TEXT route ka extraction-fidelity test.
// DOM shape Telegram Web A (github.com/Ajaxy/telegram-tt) ke SOURCE se li gayi hai:
//   - message container: class "Message" (+ "own" jab message khud ka ho),
//     attribute data-message-id (components/middle/message/Message.tsx ~L826,1928)
//   - wrapper: ".message-list-item" (components/middle/MessageList.tsx ~L920)
//   - text: ".text-content" (Message.tsx ~L1250)
// IMAANADAAR LIMIT: ye SOURCE se li gayi shape ka DUMMY DOM hai. Live Telegram Web
// par selectors verify NAHI hue (login ke bina chat DOM milta hi nahi). Ye test
// prove karta hai ki copy-text route ka extraction logic sahi kaam karta hai
// jab DOM ye shape follow kare - platform ka actual live DOM alag ho sakta hai.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const SCRIPT = fs.readFileSync(new URL('../content/engine.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BATCH = 40;

// Telegram Web A shaped config.
const CONFIG = {
  rowsSelector: '.Message[data-message-id]',
  isIncoming: (row) => !row.classList.contains('own'),
  getText: (row) => { const el = row.querySelector('.text-content'); return el ? el.innerText : ''; },
  getChatKey: (doc) => {
    const list = doc.querySelector('.messages-list[data-chat-id]');
    return list ? 'tg:' + list.getAttribute('data-chat-id') : null;
  },
  composerSelector: '#editable-message-text[contenteditable="true"]',
  headerSelector: '.MiddleHeader',
  footerSelector: '.middle-column-footer',
  rootSelector: '#root',
  consentMessage: 'Is chat ke messages AI provider ko bheje jaayenge. OK?',
  consentRequestText: 'Heads up: is chat mein AI-drafted replies aa sakti hain. Okay? (stop likhne par band)',
  aiMarker: ' (AI)',
};

function msgHtml(chatId, id, own, text) {
  return `<div class="message-list-item"><div class="Message${own ? ' own' : ''}" data-message-id="${id}" data-chat="${chatId}"><span class="text-content">${text}</span></div></div>`;
}

function chatHtml(chatId, messages) {
  const rows = messages.map((m, i) => msgHtml(chatId, m.id || i + 1, m.own, m.text)).join('');
  return `
    <div id="root"><div class="middle-column">
      <div class="MiddleHeader"><span>Chat</span></div>
      <div class="messages-list" data-chat-id="${chatId}">${rows}</div>
      <div class="middle-column-footer"><div id="editable-message-text" contenteditable="true"></div></div>
    </div></div>`;
}

function makeWorld({ sendMessage, initialHtml }, t) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${initialHtml}</body></html>`, {
    url: 'https://web.telegram.org/a/', runScripts: 'dangerously',
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

const composerOf = (w) => w.document.querySelector('#editable-message-text');

async function primeHistory(window) {
  // Engine first-bind par visible history BASELINE karta hai (bina trigger).
  // Fixture mein history pre-rendered hai, isliye no-op mutation se prime karo.
  const msgs = window.document.querySelector('.messages-list');
  const tmp = window.document.createElement('span');
  msgs.appendChild(tmp);
  tmp.remove();
  await sleep(BATCH + 120);
}


async function enableChat(window) {
  await sleep(60);
  const btn = window.document.getElementById('cc-toggle-btn');
  assert.ok(btn, 'A-shaped DOM par toggle banna chahiye');
  btn.click();
  await sleep(60);
  btn.click();
  await sleep(60);
  assert.equal(btn.dataset.enabled, 'true');
  composerOf(window).textContent = '';
}

function appendIncoming(window, chatId, id, text) {
  const list = window.document.querySelector('.messages-list');
  list.insertAdjacentHTML('beforeend', msgHtml(chatId, id, false, text));
}

test('COPY-TEXT route: A-shaped DOM se text sahi extract hota hai, roles aur order sahi', async (t) => {
  const reply = 'THEEK HAI JI';
  const { window, calls } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply } }),
    initialHtml: chatHtml('555', [
      { id: 10, own: false, text: 'pehla sawal' },
      { id: 11, own: true, text: 'mera jawab' },
    ]),
  }, t);
  await enableChat(window);
  await primeHistory(window);

  appendIncoming(window, '555', 12, 'naya message aa gaya');
  await sleep(250);

  assert.equal(calls.length, 1, 'ek AI request');
  const msgs = calls[0].payload.messages;
  // Extraction fidelity: order aur roles DOM se sahi map hue.
  // NOTE: msgs engine ke window-realm mein bana hai; assert.deepEqual prototypes
  // check karta hai, isliye pehle local-realm array mein convert karo (Array.from).
  assert.deepEqual(
    Array.from(msgs, (m) => [m.role, m.content]),
    [
      ['user', 'pehla sawal'],
      ['assistant', 'mera jawab'],
      ['user', 'naya message aa gaya'],
    ],
    'copy-text route: incoming=user, own=assistant, DOM order preserved',
  );
  assert.equal(composerOf(window).textContent, reply + ' (AI)', 'suggestion + AI marker composer mein (send NAHI)');
});

test('STOP GATE A-shaped DOM par bhi kaam karta hai (stop text AI ko nahi jaata)', async (t) => {
  const { window, calls } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'x' } }),
    initialHtml: chatHtml('555', [{ id: 10, own: false, text: 'hi' }]),
  }, t);
  await enableChat(window);
  await primeHistory(window);
  appendIncoming(window, '555', 11, 'please stop');
  await sleep(250);
  assert.equal(calls.length, 0, 'stop message extract hua par AI ko NAHI gaya');
  const btn = window.document.getElementById('cc-toggle-btn');
  assert.equal(btn.textContent, 'Stopped');
});

test('FAIL CLOSED: messages-list par chat-id attribute na ho to feature off', async (t) => {
  const html = chatHtml('555', [{ id: 10, own: false, text: 'hi' }])
    .replace(' data-chat-id="555"', '');
  const { window, calls } = makeWorld({
    sendMessage: async () => ({ ok: true, data: { reply: 'x' } }),
    initialHtml: html,
  }, t);
  await sleep(80);
  assert.equal(window.document.getElementById('cc-toggle-btn'), null, 'stable id ke bina toggle nahi');
  appendIncoming(window, '555', 11, 'hello');
  await sleep(250);
  assert.equal(calls.length, 0);
});
