// orbix-adapter.test.mjs - Orbix site-grounded adapter ke contract tests.
// DOM shape from Nov 2 read-only capture of the Orbix page. Adapter only reads expected
// structure par chalta hai; mismatch/conflict = fail-closed (createChatAssistant call hi nahi).
//
// v21: identity = HOOK-CAPTURED response-body correlation. Adapter khud KOI API request
// NAHI karta (v19/v20 ke active reads/enumeration poore hataye). Harness mein hook ko
// SAME realm mein eval karte hain (jsdom mein MAIN world nahi hota) + fetch stub jo
// site ke page fetch ko simulate karta hai (hook usi ko wrap karta hai).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const SCRIPT = fs.readFileSync(new URL('../content/adapters/orbix.js', import.meta.url), 'utf8');
const HOOK = fs.readFileSync(new URL('../content/orbix-hook.js', import.meta.url), 'utf8');

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const CHAT_A = '6ae4b91ba856385bd56743b7';
const CHAT_B = '6ae4b907a856385bd5674394';
const CHAT_C = '6ade4ea9be9d50179645264d';
const API = 'https://orbix-3av3.onrender.com';

// Site ke page-fetch ka stub. dataMap: id -> messages array | '__FAIL__' | {__delay, messages}.
// Response mein clone() hai (hook res.clone().json() karta hai).
// window.__pageFetch(id) = site ne woh chat kholi (hook isi fetch ko capture karta hai).
function installSiteFetch(window, dataMap) {
  window.__chatData = dataMap;
  window.fetch = async (url) => {
    const m = /\/api\/chats\/([0-9a-f]{24})/.exec(String(url));
    const entry = m ? window.__chatData[m[1]] : undefined;
    const fail = () => ({ ok: false, status: 500, clone: () => ({ json: async () => ({}) }), json: async () => ({}) });
    if (!m || entry === undefined || entry === '__FAIL__') return fail();
    let e = entry;
    let delay = 0;
    if (!Array.isArray(e)) { delay = e.__delay || 0; e = e.messages; }
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const body = { id: m[1], title: 't', messages: e };
    return { ok: true, status: 200, clone: () => ({ json: async () => body }), json: async () => body };
  };
  window.__pageFetch = (id) => window.fetch(API + '/api/chats/' + id).catch(() => {});
}

// Rendered thread ko naye content se replace karo (chat switch ka DOM hissa)
function setThreadContent(w, userText, ansText) {
  const t = w.document.querySelector('.thread');
  t.innerHTML = '<div class="msg user"><div class="bubble">' + userText + '</div></div>' +
    '<div class="msg assistant"><div class="steps">s</div><div class="answer">' + ansText + '</div></div>';
}
const RT_MSGS = [{ role: 'user', content: 'same opener' }, { role: 'assistant', content: 'ans' }];
const THREAD_MSGS = [
  { role: 'user', content: 'hi orbix, ek line mein bata' },
  { role: 'assistant', content: 'Main text ke jawab de sakta hoon' },
  { role: 'user', content: 'accha ek fact sunao' },
];
const THREAD = '<main class="center"><div class="thread">' +
  '<div class="msg user"><div class="bubble">hi orbix, ek line mein bata</div></div>' +
  '<div class="msg assistant"><div class="steps">s</div><div class="answer">Main text ke jawab de sakta hoon</div><button class="chip">c</button></div>' +
  '<div class="msg user"><div class="bubble">accha ek fact sunao</div></div>' +
  '</div><form class="composer"><textarea></textarea><button class="btn primary" type="submit">Send</button></form></main>' +
  '<div class="chat-row on"><button>meri test chat · Oct 30</button><button class="x">×</button></div>';

function makeWorld(html, t, url) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: url || 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__captured = null;
  window.ChatEngine = { createChatAssistant: (cfg) => { window.__captured = cfg; return { stop() {} }; } };
  installSiteFetch(window, { [CHAT_A]: THREAD_MSGS });
  window.eval(HOOK); // MAIN world hook (jsdom: same realm)
  window.__pageFetch(CHAT_A); // site ka initial open-chat fetch - ADAPTER SE PEHLE (replay buffering bhi test)
  window.eval(SCRIPT);
  return window;
}

test('Orbix adapter: expected structure par engine config banta hai (grounded selectors)', async (t) => {
  const w = makeWorld(THREAD, t);
  await tick(80); // hook replay -> capture -> sync correlate -> bind
  const c = w.__captured;
  assert.ok(c, 'assistant created');
  assert.equal(c.rowsSelector, '.msg');
  assert.equal(c.composerSelector, 'form.composer textarea');
  assert.equal(c.sendSelector, 'form.composer button.btn.primary');
});

test('Orbix adapter: POSITIVE incoming evidence - assistant row hi incoming; user kabhi nahi', async (t) => {
  const w = makeWorld(THREAD, t);
  await tick(80);
  const c = w.__captured;
  const rows = w.document.querySelectorAll('.msg');
  assert.equal(c.isIncoming(rows[0]), false); // user
  assert.equal(c.isIncoming(rows[1]), true);  // assistant
  assert.equal(c.isIncoming(rows[2]), false); // user
  assert.equal(c.getText(rows[1]), 'Main text ke jawab de sakta hoon');
  assert.equal(c.getText(rows[0]), 'hi orbix, ek line mein bata');
});

test('Orbix adapter: chat identity = hook-correlated owning-site chatId (text-composite NAHI)', async (t) => {
  const w = makeWorld(THREAD, t);
  await tick(80);
  const key = w.__captured.getChatKey();
  assert.ok(key.includes(CHAT_A), 'chatId in key: ' + key);
  assert.ok(/^orbix:[^:]+:1:/.test(key), 'nonce+seq prefix: ' + key);
  assert.ok(!key.includes('meri test chat'), 'title key mein NAHI (identity text se nahi): ' + key);
});

test('Orbix adapter FAIL-CLOSED: hook installed par KOI chat fetch capture nahi -> bind NAHI', async (t) => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${THREAD}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__captured = null;
  window.ChatEngine = { createChatAssistant: (cfg) => { window.__captured = cfg; return { stop() {} }; } };
  installSiteFetch(window, { [CHAT_A]: THREAD_MSGS });
  window.eval(HOOK); // hook HAI, par site ne koi fetch nahi ki (render ka source unknown)
  window.eval(SCRIPT);
  await tick(150);
  assert.equal(window.__captured, null, 'captured response ke bina bind nahi');
});

test('Orbix adapter FAIL-CLOSED: page-world hook ABSENT (injection fail) to bind NAHI', async (t) => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${THREAD}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__captured = null;
  window.ChatEngine = { createChatAssistant: (cfg) => { window.__captured = cfg; return { stop() {} }; } };
  window.eval(SCRIPT); // hook eval hi nahi hua
  await tick(100);
  assert.equal(window.__captured, null, 'hook ke bina bind nahi (identity impossible)');
});

test('Orbix adapter FAIL-CLOSED: host mismatch par kuch nahi chalta', async (t) => {
  const w = makeWorld(THREAD, t, 'https://evil-clone.example.com/');
  await tick(80);
  assert.equal(w.__captured, null);
});

test('Orbix adapter FAIL-CLOSED: row par user+assistant dono classes (conflict)', async (t) => {
  const w = makeWorld(THREAD.replace('class="msg assistant"', 'class="msg assistant user"'), t);
  await tick(80);
  assert.equal(w.__captured, null);
});

test('Orbix adapter FAIL-CLOSED: row mein nested quote/role structure (contract violation)', async (t) => {
  const w = makeWorld(THREAD.replace('<div class="bubble">accha ek fact sunao</div>', '<div class="bubble"><div class="quoted-message">quoted</div>accha ek fact sunao</div>'), t);
  await tick(80);
  assert.equal(w.__captured, null);
});

test('Orbix adapter FAIL-CLOSED: send button missing/ambiguous', async (t) => {
  const w = makeWorld(THREAD.replace('<button class="btn primary" type="submit">Send</button>', ''), t);
  await tick(80);
  assert.equal(w.__captured, null);
});

test('Orbix adapter: XHR se aaya chat response bhi capture hota hai (fetch-only site assumption NAHI)', async (t) => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${THREAD}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__captured = null;
  window.ChatEngine = { createChatAssistant: (cfg) => { window.__captured = cfg; return { stop() {} }; } };
  installSiteFetch(window, { [CHAT_A]: THREAD_MSGS });
  // Fake XHR (hook eval se PEHLE install - hook prototype wrap karta hai)
  window.XMLHttpRequest = class {
    open(m, u) { this.__m = m; this.__u = u; }
    addEventListener(type, fn) { (this.__l = this.__l || {})[type] = (this.__l[type] || []).concat(fn); }
    send() {
      this.status = 200;
      this.responseText = JSON.stringify({ id: CHAT_A, title: 't', messages: THREAD_MSGS });
      (this.__l.load || []).forEach((f) => f.call(this));
    }
  };
  window.eval(HOOK);
  const x = new window.XMLHttpRequest(); // site ka XHR-based chat load
  x.open('GET', API + '/api/chats/' + CHAT_A);
  x.send();
  window.eval(SCRIPT);
  await tick(80);
  assert.ok(window.__captured, 'XHR capture se bind');
  assert.ok(window.__captured.getChatKey().includes(CHAT_A));
});

// ---------- runtime SPA behavior (switch / collision / post-bind violation) ----------
const THREAD_RT = '<main class="center"><div class="thread">' +
  '<div class="msg user"><div class="bubble">same opener</div></div>' +
  '<div class="msg assistant"><div class="steps">s</div><div class="answer">ans</div></div>' +
  '</div><form class="composer"><textarea></textarea><button class="btn primary" type="submit">Send</button></form></main>';
const SIDEBAR_DUP = '<div class="sidebar">' +
  '<div class="chat-row on"><button>same title · Oct 30</button><button class="x">×</button></div>' +
  '<div class="chat-row"><button>same title · Oct 30</button><button class="x">×</button></div>' +
  '</div>';
function makeRuntimeWorld(html, t) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__CC_ORBIX_DEBOUNCE_MS = 20;
  const B_DISTINCT = [{ role: 'user', content: 'b opener' }, { role: 'assistant', content: 'b jawab' }];
  const C_DISTINCT = [{ role: 'user', content: 'c opener' }, { role: 'assistant', content: 'c jawab' }];
  installSiteFetch(window, { [CHAT_A]: RT_MSGS, [CHAT_B]: B_DISTINCT, [CHAT_C]: C_DISTINCT });
  window.eval(HOOK);
  window.__pageFetch(CHAT_A); // initial open
  window.__instances = [];
  window.ChatEngine = {
    createChatAssistant: (cfg) => {
      const inst = { cfg, stopped: false, stop() { inst.stopped = true; } };
      window.__instances.push(inst);
      return inst;
    },
  };
  window.eval(SCRIPT);
  return window;
}

test('Orbix adapter: duplicate-title chats - switch par purana instance key null (fail-closed), naya instance nayi chatId', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80); // initial capture + bind
  const key = w.__instances[0].cfg.getChatKey();
  assert.ok(key.includes(CHAT_A), 'bound chat A: ' + key);
  const rows = w.document.querySelectorAll('.chat-row');
  rows[0].classList.remove('on');
  rows[1].classList.add('on');
  await tick(0); // synchronous DOM invalidation
  assert.equal(w.__instances[0].cfg.getChatKey(), null, 'switch ke baad purana instance keyless (send block)');
  setThreadContent(w, 'b opener', 'b jawab'); // nayi chat ka render (B ka content)
  await w.__pageFetch(CHAT_B); // site ka naya chat fetch
  await tick(100);
  assert.equal(w.__instances.length, 2, 'naya instance bana');
  const key2 = w.__instances[1].cfg.getChatKey();
  assert.ok(key2.includes(CHAT_B), 'naya instance chat B: ' + key2);
  assert.notEqual(key, key2, 'identical title chats ko alag keys (hook-correlated chatId se)');
});

test('Orbix adapter: chat switch par purana instance stop + naya instance (fresh consent key)', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  assert.equal(w.__instances.length, 1);
  const rows = w.document.querySelectorAll('.chat-row');
  rows[0].classList.remove('on');
  rows[1].classList.add('on');
  setThreadContent(w, 'b opener', 'b jawab');
  await w.__pageFetch(CHAT_B);
  await tick(100);
  assert.equal(w.__instances.length, 2, 'switch par naya assistant instance');
  assert.equal(w.__instances[0].stopped, true, 'purana instance stopped');
  assert.equal(w.__instances[1].stopped, false);
});

test('Orbix adapter FAIL-CLOSED runtime: post-bind invalid row par engine halt, koi restart nahi', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  const bad = w.document.createElement('div');
  bad.className = 'msg user assistant'; // conflict
  w.document.querySelector('.thread').appendChild(bad);
  await tick(80);
  assert.equal(w.__instances.length, 1, 'koi naya instance nahi');
  assert.equal(w.__instances[0].stopped, true, 'engine halted on runtime violation');
});

test('Orbix adapter: transient render (class baad mein aayi) par halt NAHI', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  const row = w.document.createElement('div');
  row.className = 'msg';
  w.document.querySelector('.thread').appendChild(row);
  row.classList.add('user'); // same tick mein class aa gayi
  row.innerHTML = '<div class="bubble">naya</div>';
  await tick(80);
  assert.equal(w.__instances[0].stopped, false, 'transient state par engine chalta rahe');
});

// ---------- consent-never-restored + preSendCheck ----------
test('Orbix adapter v21 FAIL-CLOSED: identical title+anchor+CONTENT chat dono SESSION mein fetch hui = AMBIGUOUS -> rebind NAHI', async (t) => {
  // Do chats ka content bilkul same AUR dono session mein fetch ho chuki = kaunsi ka
  // response render hua pata nahi = koi bind NAHI jab tak diverge na hon. Ye fundamental
  // limit hai (content se indistinguishable chats ko koi client logic alag nahi kar sakta).
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  const key1 = w.__instances[0].cfg.getChatKey();
  assert.ok(key1.includes(CHAT_A));
  w.__chatData[CHAT_B] = RT_MSGS; // B bhi bilkul same content
  const rows = w.document.querySelectorAll('.chat-row');
  rows[0].classList.remove('on');
  rows[1].classList.add('on');
  await w.__pageFetch(CHAT_B); // B bhi session mein fetch hui -> twin evidence
  await tick(150);
  assert.equal(w.__instances[0].stopped, true, 'switch par purana instance stopped');
  assert.equal(w.__instances.length, 1, 'identical-content fetched twins = ambiguous = koi naya bind NAHI (fail-closed, consent isolate)');
});

test('Orbix adapter: ordinal shift (same-title chat delete) = switch treat; retained captures se rebind (fresh key)', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  const rows = w.document.querySelectorAll('.chat-row');
  rows[0].classList.remove('on');
  rows[1].classList.add('on');
  setThreadContent(w, 'b opener', 'b jawab'); // B ka render
  await w.__pageFetch(CHAT_B);
  await tick(100);
  assert.equal(w.__instances.length, 2);
  const keyB = w.__instances[1].cfg.getChatKey();
  assert.ok(keyB.includes(CHAT_B));
  // pehli same-title chat delete -> active element/sig change -> DOM invalidation + stop
  rows[0].remove();
  await tick(0);
  assert.equal(w.__instances[1].stopped, true, 'DOM switch signal par stop');
  // v21: sidebar-only change ke baad thread STALE ho sakta hai (delayed React commit) -
  // retained captures se turant rebind NAHI (stale-window condemnation). Rebind sirf
  // FRESH capture par (site active chat ko refetch karti hai) - nayi key ke saath.
  await tick(200);
  assert.equal(w.__instances.length, 2, 'fresh capture ke bina rebind NAHI (stale window fail-closed)');
  await w.__pageFetch(CHAT_B); // site ne active chat refetch ki
  await tick(100);
  assert.equal(w.__instances.length, 3, 'fresh capture se rebind');
  assert.ok(w.__instances[2].cfg.getChatKey().includes(CHAT_B), 'content wahi B se uniquely milta hai');
  assert.notEqual(w.__instances[2].cfg.getChatKey(), keyB, 'naya bind = nayi key (fresh consent)');
});

test('Orbix adapter: preSendCheck - stable par true; switch ke TURANT baad false (reboot se pehle bhi)', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  assert.equal(w.__instances[0].cfg.preSendCheck(), true, 'stable contract par true');
  const rows = w.document.querySelectorAll('.chat-row');
  rows[0].classList.remove('on');
  rows[1].classList.add('on');
  await tick(0); // sirf microtask flush - synchronous invalidation ho chuki
  assert.equal(w.__instances[0].cfg.preSendCheck(), false, 'switch detect hote hi purana instance send-block');
  // Render abhi bhi A ka content hai (sidebar-only signal); stale window mein rebind
  // sirf tab jab site RENDERED chat ko refetch kare (fresh evidence).
  await w.__pageFetch(CHAT_A);
  await tick(80); // reboot complete
  assert.equal(w.__instances.length, 2);
  assert.equal(w.__instances[0].stopped, true);
  assert.equal(w.__instances[1].cfg.preSendCheck(), true, 'naya instance rendered chat ke liye valid');
  assert.equal(w.__instances[0].cfg.preSendCheck(), false, 'purana instance hamesha blocked (seq stale)');
});

test('Orbix adapter: preSendCheck false after runtime violation', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  assert.equal(w.__instances[0].cfg.preSendCheck(), true);
  const bad = w.document.createElement('div');
  bad.className = 'msg'; // koi direction class nahi = contract violation
  w.document.querySelector('.thread').appendChild(bad);
  await tick(0); // synchronous invalidation
  assert.equal(w.__instances[0].cfg.preSendCheck(), false, 'violation ke turant baad send-block');
  await tick(80);
  assert.equal(w.__instances[0].stopped, true);
  assert.equal(w.__instances.length, 1, 'violation par reboot NAHI (page-load ke liye halt)');
});

test('Orbix adapter: RELOAD (naya document) par prepopulated consent apply NAHI hoti', async (t) => {
  const w1 = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  const key1 = w1.__instances[0].cfg.getChatKey();
  const persistedConsent = { [key1]: { state: 'active', ts: new Date().toISOString() } };

  const w2 = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  const key2 = w2.__instances[0].cfg.getChatKey();

  assert.notEqual(key1, key2, 'reload par key kabhi recur nahi hoti');
  assert.equal(persistedConsent[key2], undefined, 'naya document ki key par purani consent exist hi nahi karti');
  assert.ok(/^orbix:[^:]+:1:/.test(key2), 'naya document bhi seq 1 se shuru: ' + key2);
  const nonce1 = key1.split(':')[1], nonce2 = key2.split(':')[1];
  assert.notEqual(nonce1, nonce2, 'per-document nonce unpredictable/alag');
});

test('Orbix adapter: thread anchor change (sidebar signals same) bhi switch treat hota hai', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  assert.equal(w.__instances.length, 1);
  // Sidebar SAME rakho, sirf thread ka pehla user message badlo
  w.document.querySelector('.thread > .msg.user .bubble').textContent = 'bilkul nayi chat ka opener';
  await tick(80);
  assert.equal(w.__instances[0].stopped, true, 'purana instance stopped');
  assert.equal(w.__instances[0].cfg.preSendCheck(), false, 'purana instance send-block');
  assert.equal(w.__instances.length, 1, 'matching capture ke bina rebind nahi');
  // asal switch: site nayi chat fetch karti hai jiska content rendered se match karega
  w.__chatData[CHAT_B] = [{ role: 'user', content: 'bilkul nayi chat ka opener' }, { role: 'assistant', content: 'ans' }];
  await w.__pageFetch(CHAT_B);
  await tick(80);
  assert.equal(w.__instances.length, 2, 'hook-captured matching response ke baad naya instance');
});

// ---------- identity observability (fail-closed jab signals observable na hon) ----------
test('Orbix adapter: sidebar list DOM mein nahi (home view) to boot NAHI; aane par boot', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT, t); // koi sidebar nahi
  await tick(60);
  await tick(60);
  assert.equal(w.__instances.length, 0, 'sidebar ke bina adapter wait karta hai, boot nahi');
  // Chats tab khula + chat active -> signals observable -> boot
  const sb = w.document.createElement('div');
  sb.innerHTML = SIDEBAR_DUP;
  w.document.body.appendChild(sb.firstElementChild);
  await tick(60);
  await tick(2100); // boot retry 2000ms par hai
  assert.equal(w.__instances.length, 1, 'signals observable hote hi boot');
});

test('Orbix adapter: runtime sidebar unmount = invalidate; wapas aane par naya instance (fresh consent)', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  const key1 = w.__instances[0].cfg.getChatKey();
  const sb = w.document.querySelector('.sidebar');
  sb.remove();
  await tick(0); // synchronous invalidation
  assert.equal(w.__instances[0].stopped, true, 'sidebar unmount par turant stop');
  assert.equal(w.__instances[0].cfg.preSendCheck(), false);
  await tick(80);
  assert.equal(w.__instances.length, 1, 'sidebar absent mein reboot NAHI');
  // sidebar wapas + chat phir khuli (site refetch karti hai) -> naya instance + nayi key
  const sb2 = w.document.createElement('div');
  sb2.innerHTML = SIDEBAR_DUP;
  w.document.body.appendChild(sb2.firstElementChild);
  await w.__pageFetch(CHAT_A);
  await tick(100);
  assert.equal(w.__instances.length, 2, 'signals + fetch wapas -> naya instance');
  assert.ok(w.__instances[1].cfg.getChatKey().includes(CHAT_A), 'same content -> A hi rebind');
  assert.notEqual(w.__instances[1].cfg.getChatKey(), key1, 'naya bind = nayi key (fresh consent)');
});

test('Orbix adapter: thread empty (rows->0) = invalidate; same-anchor repopulate par bhi naya instance', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  const key1 = w.__instances[0].cfg.getChatKey();
  w.document.querySelectorAll('.thread > .msg').forEach((r) => r.remove());
  await tick(0);
  assert.equal(w.__instances[0].stopped, true, 'rows->0 par turant stop');
  // SAME content wapas (identical opener) - conservative: naya instance + nayi key
  const t2 = w.document.querySelector('.thread');
  t2.innerHTML = '<div class="msg user"><div class="bubble">same opener</div></div><div class="msg assistant"><div class="steps">s</div><div class="answer">ans</div></div>';
  await w.__pageFetch(CHAT_A); // repopulate ke saath fetch (same content -> A hi unique match)
  await tick(100);
  assert.equal(w.__instances.length, 2, 'repopulate + fetch par naya instance');
  assert.notEqual(w.__instances[1].cfg.getChatKey(), key1, 'naya bind = fresh consent');
});

test('Orbix adapter: preSendCheck false jab thread empty ya sidebar absent', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  assert.equal(w.__instances[0].cfg.preSendCheck(), true);
  w.document.querySelectorAll('.thread > .msg').forEach((r) => r.remove());
  assert.equal(w.__instances[0].cfg.preSendCheck(), false, 'empty thread');
});

test('Orbix adapter: AUTO disabled (main boundary) - suggest mode only', async (t) => {
  const w = makeWorld(THREAD, t);
  await tick(80);
  assert.equal(w.__captured.autoEnabled, false, 'autoEnabled false hona chahiye');
});

// ---------- v21: hook-correlation identity (inversion/ambiguity/drift/twins) ----------
test('Orbix adapter FAIL-CLOSED: fetch hui par response content rendered se MATCH nahi -> bind NAHI', async (t) => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${THREAD_RT + SIDEBAR_DUP}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__CC_ORBIX_DEBOUNCE_MS = 20;
  installSiteFetch(window, { [CHAT_A]: [{ role: 'user', content: 'KUCH AUR LIKHA HAI' }, { role: 'assistant', content: 'ans' }] });
  window.eval(HOOK);
  window.__pageFetch(CHAT_A); // response aaya par content alag
  window.__instances = [];
  window.ChatEngine = { createChatAssistant: (cfg) => { const i = { cfg, stop() {} }; window.__instances.push(i); return i; } };
  window.eval(SCRIPT);
  await tick(300);
  assert.equal(window.__instances.length, 0, 'content mismatch par koi bind nahi');
});

test('Orbix adapter: INVERSION - late-completing B ka content match nahi, C ka match -> C hi verified bind (order irrelevant)', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  assert.equal(w.__instances.length, 1);
  const rows = w.document.querySelectorAll('.chat-row');
  rows[0].classList.remove('on');
  rows[1].classList.add('on');
  setThreadContent(w, 'c opener', 'c jawab'); // rendered = C ka content
  w.__chatData[CHAT_B] = [{ role: 'user', content: 'B KA ALAG CONTENT' }, { role: 'assistant', content: 'b ans' }];
  // B ka response LATE complete hota hai (inversion) - correlation content se hai, order se nahi
  w.__chatData[CHAT_B] = { __delay: 120, messages: [{ role: 'user', content: 'B KA ALAG CONTENT' }, { role: 'assistant', content: 'b ans' }] };
  await w.__pageFetch(CHAT_B); // in-flight (delay)
  await w.__pageFetch(CHAT_C); // pehle complete
  await tick(60);
  assert.equal(w.__instances.length, 2, 'C ke capture par bind');
  const key = w.__instances[1].cfg.getChatKey();
  assert.ok(key && key.includes(CHAT_C), 'verified identity C (content match), B nahi: ' + key);
  await tick(300); // B ka LATE response aaya
  assert.ok(w.__instances[1].cfg.getChatKey().includes(CHAT_C), 'late B ke baad bhi C hi bound (inversion-proof)');
  assert.equal(w.__instances.length, 2, 'late B se koi churn nahi');
});

test('Orbix adapter FAIL-CLOSED: AMBIGUOUS (do fetched candidates same matching content) -> bind NAHI; divergence par recovery', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  assert.equal(w.__instances.length, 1);
  const rows = w.document.querySelectorAll('.chat-row');
  rows[0].classList.remove('on');
  rows[1].classList.add('on');
  // B aur C dono session mein fetch hui aur dono rendered se match karti hain
  w.__chatData[CHAT_B] = RT_MSGS;
  w.__chatData[CHAT_C] = RT_MSGS;
  await w.__pageFetch(CHAT_B);
  await w.__pageFetch(CHAT_C);
  await tick(200);
  assert.equal(w.__instances.length, 1, 'ambiguous identity par koi naya bind NAHI (fail-closed)');
  assert.equal(w.__instances[0].stopped, true, 'purana instance stopped');
  // Recovery: C ka content DIVERGE hua (usme naya message aaya, wo bhi capture hua)
  rows[1].classList.remove('on');
  rows[0].classList.add('on');
  w.__chatData[CHAT_C] = [{ role: 'user', content: 'doosra opener' }, { role: 'assistant', content: 'ans2' }];
  w.document.querySelector('.thread > .msg.user .bubble').textContent = 'doosra opener';
  w.document.querySelector('.thread > .msg.assistant .answer').textContent = 'ans2';
  await w.__pageFetch(CHAT_C);
  await tick(200);
  assert.equal(w.__instances.length, 2, 'divergence ke baad unambiguous bind (recovery)');
  assert.ok(w.__instances[1].cfg.getChatKey().includes(CHAT_C));
});

test('Orbix adapter: drift control - append OK, non-append content change = getChatKey null (capture/draft block)', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  const key = w.__instances[0].cfg.getChatKey();
  assert.ok(key, 'bound key');
  // append (naya message aaya) = identity intact
  const r = w.document.createElement('div');
  r.className = 'msg user';
  r.innerHTML = '<div class="bubble">naya appended message</div>';
  w.document.querySelector('.thread').appendChild(r);
  await tick(60);
  assert.equal(w.__instances[0].cfg.getChatKey(), key, 'append ke baad bhi wahi key');
  // NON-APPEND change (beech ka message badla) = identity uncertain = block
  w.document.querySelector('.thread > .msg.assistant .answer').textContent = 'EDITED CONTENT';
  await tick(60);
  assert.equal(w.__instances[0].cfg.getChatKey(), null, 'non-append drift par key null (capture/provider/draft blocked)');
});

test('Orbix adapter v21: UNSEEN twin (kabhi fetch nahi hui) bind ko rokti NAHI - render ka source captured response hi hai', async (t) => {
  // v20 is case mein enumeration se ambiguous jaati thi. v21 mein judgment ka universe
  // SESSION KE CAPTURED responses hain: render ka data-source sirf ek fetch ho sakta
  // hai (site cacheless - Nov 2 live probe: refetch on back-switch, koi storage mein
  // chat data nahi). Kabhi fetch na hui twin render ka source HO hi nahi sakti.
  // RESIDUAL (adapter header documented): agar site FUTURE mein cache/bootstrap se
  // render kare aur stale identical twin captured ho - pehli divergence/refetch par
  // fail-closed ho jaata hai.
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${THREAD_RT + SIDEBAR_DUP}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__CC_ORBIX_DEBOUNCE_MS = 20;
  installSiteFetch(window, {
    [CHAT_A]: RT_MSGS, // universe mein hai par PAGE NE KABHI FETCH NAHI KI
    [CHAT_B]: RT_MSGS, // active chat - fetch hui
  });
  window.eval(HOOK);
  window.__pageFetch(CHAT_B); // SIRF active chat fetch hui
  window.__instances = [];
  window.ChatEngine = { createChatAssistant: (cfg) => { const i = { cfg, stop() {} }; window.__instances.push(i); return i; } };
  window.eval(SCRIPT);
  await tick(200);
  assert.equal(window.__instances.length, 1, 'unseen twin irrelevant - captured response se bind');
  assert.ok(window.__instances[0].cfg.getChatKey().includes(CHAT_B), 'identity = wohi chat jiska response render hua (B)');
});

test('Orbix adapter v21 FAIL-CLOSED: LATE identical twin arrival AFTER bind -> invalidate + stop (uncertainty preserved, kuch block)', async (t) => {
  // Main ka case: stale candidate par bind ke BAAD active/twin ka response late aaye.
  // Transient window (B-only verdict) kaam karti hai KYUNKI us waqt B hi render ka
  // unique observed source hai; JAISE HI twin capture aati hai -> ambiguous -> engine
  // stop + getChatKey null = capture/provider/draft SAB block.
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  assert.equal(w.__instances.length, 1);
  assert.ok(w.__instances[0].cfg.getChatKey().includes(CHAT_A));
  // Ab A jaisi identical-content chat B bhi fetch ho gayi (late twin)
  w.__chatData[CHAT_B] = RT_MSGS;
  await w.__pageFetch(CHAT_B);
  await tick(100);
  assert.equal(w.__instances[0].stopped, true, 'late twin -> engine stop');
  assert.equal(w.__instances[0].cfg.getChatKey(), null, 'ambiguous mein key null (capture/provider/draft blocked)');
  assert.equal(w.__instances.length, 1, 'koi naya bind NAHI jab tak diverge na ho');
});

test('Orbix adapter v21 FAIL-CLOSED: PREFIX-twin dono fetch hui (ek doosri ka strict prefix) -> ambiguous -> bind NAHI', async (t) => {
  // A=[m1], B=[m1,m2], rendered=[m1,m2] (B active). A bhi prefix-consistent = 2 matches.
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${THREAD_RT + SIDEBAR_DUP}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__CC_ORBIX_DEBOUNCE_MS = 20;
  installSiteFetch(window, {
    [CHAT_A]: [{ role: 'user', content: 'same opener' }], // strict prefix of rendered
    [CHAT_B]: RT_MSGS,                                     // exact match (active chat)
  });
  window.eval(HOOK);
  window.__pageFetch(CHAT_A); // pehle A khuli thi (prefix capture)
  window.__pageFetch(CHAT_B); // ab B khuli
  window.__instances = [];
  window.ChatEngine = { createChatAssistant: (cfg) => { const i = { cfg, stop() {} }; window.__instances.push(i); return i; } };
  window.eval(SCRIPT);
  await tick(200);
  assert.equal(window.__instances.length, 0, 'fetched prefix-twin -> ambiguous -> bind NAHI');
});

test('Orbix adapter v21: active chat ka fetch LATE (render pehle, response baad mein) - pehle koi bind NAHI, capture par bind', async (t) => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${THREAD_RT + SIDEBAR_DUP}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__CC_ORBIX_DEBOUNCE_MS = 20;
  installSiteFetch(window, { [CHAT_A]: { __delay: 150, messages: RT_MSGS } });
  window.eval(HOOK);
  window.__pageFetch(CHAT_A); // slow response
  window.__instances = [];
  window.ChatEngine = { createChatAssistant: (cfg) => { const i = { cfg, stop() {} }; window.__instances.push(i); return i; } };
  window.eval(SCRIPT);
  await tick(60); // response abhi nahi aaya
  assert.equal(window.__instances.length, 0, 'response se pehle bind NAHI (render unverifiable)');
  await tick(300);
  assert.equal(window.__instances.length, 1, 'capture ke baad bind');
  assert.ok(window.__instances[0].cfg.getChatKey().includes(CHAT_A));
});

test('Orbix adapter v21 FAIL-CLOSED: site ka chat fetch FAIL (500) -> response body nahi -> bind NAHI', async (t) => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${THREAD_RT + SIDEBAR_DUP}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__CC_ORBIX_DEBOUNCE_MS = 20;
  installSiteFetch(window, { [CHAT_A]: '__FAIL__' });
  window.eval(HOOK);
  window.__pageFetch(CHAT_A); // 500 - hook capture nahi karta
  window.__instances = [];
  window.ChatEngine = { createChatAssistant: (cfg) => { const i = { cfg, stop() {} }; window.__instances.push(i); return i; } };
  window.eval(SCRIPT);
  await tick(200);
  assert.equal(window.__instances.length, 0, 'failed fetch = koi candidate nahi = bind NAHI');
});

test('Orbix adapter v21: correlation HAMESHA current render par - slow response ke DURING render badla to purane render par bind NAHI', async (t) => {
  // v20 ka "DOM mutation during verification" case v21 mein by-construction band:
  // correlation synchronous hai (koi async flight nahi), verdict hamesha (abhi ka DOM,
  // abhi ke captures) ka function hai.
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${THREAD_RT + SIDEBAR_DUP}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__CC_ORBIX_DEBOUNCE_MS = 20;
  installSiteFetch(window, { [CHAT_A]: { __delay: 150, messages: RT_MSGS } });
  window.eval(HOOK);
  window.__pageFetch(CHAT_A); // in-flight
  window.__instances = [];
  window.ChatEngine = { createChatAssistant: (cfg) => { const i = { cfg, stop() {} }; window.__instances.push(i); return i; } };
  window.eval(SCRIPT);
  await tick(50); // A ka response pending
  setThreadContent(window, 'bilkul naya content', 'naya jawab'); // MID-FLIGHT DOM change
  await tick(400); // A ka response aa gaya par current render se match nahi karta
  assert.equal(window.__instances.length, 0, 'completion ke waqt CURRENT render se match nahi -> bind NAHI');
});

// ---------- v21 adversarial: page-controlled bridge + render-source uncertainty ----------
test('Orbix adapter v21: FORGED bridge message (page-realm forge) mismatching render = ignore; matching render = sirf ephemeral bind, kisi AUR chat ko consent transfer NAHI', async (t) => {
  // MAIN world + postMessage page-controlled hai: page JS chat-response forge kar sakti
  // hai. Security properties jo MAINE rakhni hain: (1) mismatch forge = koi effect nahi;
  // (2) matching forge = bind ho sakta hai PAR key ephemeral (per-bind nonce/seq) -
  // consent kabhi persist nahi hoti, kisi doosri/real chat par apply nahi ho sakti.
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${THREAD_RT + SIDEBAR_DUP}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__CC_ORBIX_DEBOUNCE_MS = 20;
  installSiteFetch(window, { [CHAT_A]: RT_MSGS });
  window.eval(HOOK); // hook HAI par site ne koi REAL fetch nahi ki
  window.__instances = [];
  window.ChatEngine = { createChatAssistant: (cfg) => { const i = { cfg, stop() {} }; window.__instances.push(i); return i; } };
  window.eval(SCRIPT);
  // Forge 1: MISMATCHING body - ignore hona chahiye
  window.postMessage({ __ccOrbixHook: true, type: 'chat-response', id: CHAT_B, messages: [{ role: 'user', content: 'FORGED ALAG CONTENT' }] }, window.location.origin);
  await tick(100);
  assert.equal(window.__instances.length, 0, 'mismatching forge = koi bind nahi');
  // Forge 2: MATCHING body (render ke barabar) - page-realm trust boundary ke ANDAR bind
  window.postMessage({ __ccOrbixHook: true, type: 'chat-response', id: CHAT_B, messages: RT_MSGS }, window.location.origin);
  await tick(100);
  assert.equal(window.__instances.length, 1, 'matching forge render-consistent = bind (page trust domain)');
  const key = window.__instances[0].cfg.getChatKey();
  assert.ok(/^orbix:[^:]+:1:/.test(key), 'key per-bind ephemeral (nonce+seq): ' + key);
  // Real A fetch ke bina bhi B bind hua, par ye consent SIRF is key/instance ki hai -
  // doosri chat ya reload par transfer ka koi raasta nahi (consent-never-restored).
});

test('Orbix adapter v21 FAIL-CLOSED: forged FLOOD sirf ambiguity badhati hai (DoS = safe direction), real verdict nahi badal paati', async (t) => {
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  assert.equal(w.__instances.length, 1, 'real capture se bound');
  const key = w.__instances[0].cfg.getChatKey();
  assert.ok(key.includes(CHAT_A));
  // Page-realm flood: 5 forged twins same content ke -> AMBIGUOUS -> stop (fail-closed)
  for (let i = 0; i < 5; i++) {
    const fakeId = ('00000000000000000000ff' + String(10 + i)).slice(0, 24);
    w.postMessage({ __ccOrbixHook: true, type: 'chat-response', id: fakeId, messages: RT_MSGS }, w.location.origin);
  }
  await tick(150);
  assert.equal(w.__instances[0].stopped, true, 'forged flood -> ambiguous -> engine stop');
  assert.equal(w.__instances[0].cfg.getChatKey(), null, 'ambiguous mein key null');
  // Malformed messages ignore
  w.postMessage({ __ccOrbixHook: true, type: 'chat-response', id: 'NOT-HEX', messages: RT_MSGS }, w.location.origin);
  w.postMessage({ __ccOrbixHook: true, type: 'chat-response', id: CHAT_C }, w.location.origin); // messages missing
  w.postMessage({ type: 'chat-response', id: CHAT_C, messages: RT_MSGS }, w.location.origin); // tag missing
  await tick(80);
  assert.equal(w.__instances.length, 1, 'malformed forged messages ignored, koi naya bind nahi');
});

test('Orbix adapter v21: identical-content node-replacement BINA fetch (cache render) - content same to bind stable; consent ephemeral hi rehti hai', async (t) => {
  // Render text bilkul same, nodes naye, koi fetch NAHI (cache/bootstrap render ka
  // simulation). Detect hi nahi ho sakta (mutation same-text) - documented residual (3).
  // Jo guarantee hai: bind content-equivalent chat ka hai + consent ephemeral.
  const w = makeRuntimeWorld(THREAD_RT + SIDEBAR_DUP, t);
  await tick(80);
  const key1 = w.__instances[0].cfg.getChatKey();
  const t2 = w.document.querySelector('.thread');
  t2.innerHTML = '<div class="msg user"><div class="bubble">same opener</div></div><div class="msg assistant"><div class="steps">s</div><div class="answer">ans</div></div>';
  await tick(80);
  assert.equal(w.__instances[0].stopped, false, 'same-content re-render par instance stable (content-equivalent)');
  assert.equal(w.__instances[0].cfg.getChatKey(), key1, 'key wahi (koi nayi consent nahi li gayi)');
});

// ---------- markdown render-correlation (live finding Nov 4: react-markdown strips formatting) ----------
// Site assistant replies react-markdown + remark-gfm se render hote hain (client/src/Rich.jsx);
// hook RAW API bodies capture karta hai. Assistant compare render-equivalent plain text par,
// user compare STRICT plain par (user equivalence expand nahi).

function makeWorldMd(html, t, dataMap, extraFetch) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.__captured = null;
  window.ChatEngine = { createChatAssistant: (cfg) => { window.__captured = cfg; return { stop() {} }; } };
  installSiteFetch(window, dataMap);
  window.eval(HOOK);
  for (const id of extraFetch) window.__pageFetch(id);
  window.eval(SCRIPT);
  return window;
}
function mdThread(userText, ansHtml) {
  return '<main class="center"><div class="thread">' +
    '<div class="msg user"><div class="bubble">' + userText + '</div></div>' +
    '<div class="msg assistant"><div class="steps">s</div><div class="answer">' + ansHtml + '</div><button class="chip">c</button></div>' +
    '</div><form class="composer"><textarea></textarea><button class="btn primary" type="submit">Send</button></form></main>' +
    '<div class="chat-row on"><button>md chat · Nov 4</button><button class="x">×</button></div>';
}
const MD_USER = 'Test Beta: samundar ke baare mein ek line mein interesting fact batao';

test('Orbix adapter markdown: raw bold/italic markers vs rendered plain -> bind (live failure ka fix)', async (t) => {
  const msgs = [
    { role: 'user', content: MD_USER },
    { role: 'assistant', content: '**Samundar ki sabse gehri** jagah *Mariana Trench* hai, jo **lagbhag 11km** tak nichli hai.' },
  ];
  const html = mdThread(MD_USER, '<strong>Samundar ki sabse gehri</strong> jagah <em>Mariana Trench</em> hai, jo <strong>lagbhag 11km</strong> tak nichli hai.');
  const w = makeWorldMd(html, t, { [CHAT_A]: msgs }, [CHAT_A]);
  await tick(120);
  assert.ok(w.__captured, 'markdown raw vs rendered plain par bind hona chahiye');
  assert.ok(w.__captured.getChatKey().includes(CHAT_A), 'sahi chat id se bind');
});

test('Orbix adapter markdown: link text vs rendered anchor text -> bind; destination compare mein nahi', async (t) => {
  const msgs = [
    { role: 'user', content: MD_USER },
    { role: 'assistant', content: 'Dekho [Orbix](https://orbix-video-ly.web.app) site abhi.' },
  ];
  const w = makeWorldMd(mdThread(MD_USER, 'Dekho Orbix site abhi.'), t, { [CHAT_A]: msgs }, [CHAT_A]);
  await tick(120);
  assert.ok(w.__captured, 'link text render-equivalence par bind');
});

test('Orbix adapter markdown: heading/list/quote/code markers vs rendered text -> bind', async (t) => {
  const raw = '## Facts\n- pehla point\n- dusra point\n> quote line\n`inline code` aur yeh:\n```js\nconst a = 1;\n```';
  const msgs = [
    { role: 'user', content: MD_USER },
    { role: 'assistant', content: raw },
  ];
  const w = makeWorldMd(mdThread(MD_USER, 'Facts pehla point dusra point quote line inline code aur yeh: const a = 1;'), t, { [CHAT_A]: msgs }, [CHAT_A]);
  await tick(120);
  assert.ok(w.__captured, 'heading/list/quote/code render-equivalence par bind');
});

test('Orbix adapter FAIL-CLOSED markdown: render-equivalent TWIN raws (sirf formatting farak) = AMBIGUOUS -> bind NAHI', async (t) => {
  const a = [{ role: 'user', content: MD_USER }, { role: 'assistant', content: '**plain fact** yahan' }];
  const b = [{ role: 'user', content: MD_USER }, { role: 'assistant', content: 'plain fact yahan' }];
  const w = makeWorldMd(mdThread(MD_USER, 'plain fact yahan'), t, { [CHAT_A]: a, [CHAT_B]: b }, [CHAT_A, CHAT_B]);
  await tick(150);
  assert.equal(w.__captured, null, 'render-equivalent alag raw chats = undecidable = fail-closed');
});

test('Orbix adapter FAIL-CLOSED markdown: same link text ALAG destinations (twin) = AMBIGUOUS -> bind NAHI', async (t) => {
  const a = [{ role: 'user', content: MD_USER }, { role: 'assistant', content: 'ye [link](https://evil.example) dekho' }];
  const b = [{ role: 'user', content: MD_USER }, { role: 'assistant', content: 'ye [link](https://good.example) dekho' }];
  const w = makeWorldMd(mdThread(MD_USER, 'ye link dekho'), t, { [CHAT_A]: a, [CHAT_B]: b }, [CHAT_A, CHAT_B]);
  await tick(150);
  assert.equal(w.__captured, null, 'destination-alag render-same twins undecidable = fail-closed');
});

test('Orbix adapter markdown: user side STRICT - literal markers in bubble must match exactly', async (t) => {
  // user ne literal ** bheja; bubble wahi dikhata hai (koi render nahi) -> strict match -> bind
  const msgs = [
    { role: 'user', content: '**not bold** bola maine' },
    { role: 'assistant', content: '**theek hai** samjha' },
  ];
  const w = makeWorldMd(mdThread('**not bold** bola maine', 'theek hai samjha'), t, { [CHAT_A]: msgs }, [CHAT_A]);
  await tick(120);
  assert.ok(w.__captured, 'literal markers dono side same -> strict match -> bind');
});

test('Orbix adapter FAIL-CLOSED markdown: captured user text vs rendered bubble farak = bind NAHI (user equivalence expand nahi)', async (t) => {
  const msgs = [
    { role: 'user', content: 'not bold bola maine' },
    { role: 'assistant', content: '**theek hai** samjha' },
  ];
  const w = makeWorldMd(mdThread('**not bold** bola maine', 'theek hai samjha'), t, { [CHAT_A]: msgs }, [CHAT_A]);
  await tick(150);
  assert.equal(w.__captured, null, 'user side markdown-normalize NAHI - mismatch = unverified = fail-closed');
});

test('Orbix adapter FAIL-CLOSED markdown: unpaired marker literal rehta hai - stripped raw se match NAHI', async (t) => {
  // '2 * 3 = 6' mein * paired emphasis nahi; renderer literal dikhata hai
  const msgs = [
    { role: 'user', content: MD_USER },
    { role: 'assistant', content: '2 * 3 = 6 hota hai' },
  ];
  const w = makeWorldMd(mdThread(MD_USER, '2 * 3 = 6 hota hai'), t, { [CHAT_A]: msgs }, [CHAT_A]);
  await tick(120);
  assert.ok(w.__captured, 'unpaired asterisk literal preserved dono side -> bind');
});

// ---------- CONSERVATIVE BIND (Nov 4): exact-equality bind + anchored continuity ----------
// Risk jo ye tests pin karte hain: incomplete/stale prefix-consistent capture ya unobserved
// prefix-twin se GALAT chat ko consent/draft context milna (privacy). Naya bind = SIRF
// exact snapshot (length + role/text). Append-growth SIRF established bind par.

test('Orbix adapter FAIL-CLOSED: render single candidate ka STRICT PREFIX (capture naya snapshot) = bind NAHI', async (t) => {
  // Purani append-only semantics mein bind hota tha - wahi wrong-chat privacy risk tha.
  const msgs = [
    { role: 'user', content: MD_USER },
    { role: 'assistant', content: 'Samundar ka fact' },
  ];
  const html = mdThread(MD_USER.slice(0, 40), 'kuch aur'); // rendered alag chhota thread
  // rendered ko candidate ka strict prefix banate hain: pehla message same, render 1 msg, capture 2
  const w = makeWorldMd('<main class="center"><div class="thread">' +
    '<div class="msg user"><div class="bubble">' + MD_USER + '</div></div>' +
    '</div><form class="composer"><textarea></textarea><button class="btn primary" type="submit">Send</button></form></main>' +
    '<div class="chat-row on"><button>md chat · Nov 4</button><button class="x">×</button></div>',
    t, { [CHAT_A]: msgs }, [CHAT_A]);
  await tick(150);
  assert.equal(w.__captured, null, 'render = candidate ka strict prefix -> bind NAHI (exact-equality required)');
});

test('Orbix adapter FAIL-CLOSED: candidate render ka STRICT PREFIX (capture purana snapshot, koi prior bind nahi) = bind NAHI', async (t) => {
  const msgs = [{ role: 'user', content: MD_USER }]; // capture purana: sirf 1 message
  const html = mdThread(MD_USER, '<strong>Samundar</strong> ka fact'); // render 2 messages
  const w = makeWorldMd(html, t, { [CHAT_A]: msgs }, [CHAT_A]);
  await tick(150);
  assert.equal(w.__captured, null, 'candidate = render ka strict prefix -> naya bind NAHI');
});

test('Orbix adapter FAIL-CLOSED: render twin A ka EXACT, twin B ka prefix (dono captured) = AMBIGUOUS -> bind NAHI', async (t) => {
  const msgsA = [
    { role: 'user', content: MD_USER },
    { role: 'assistant', content: 'Samundar ka fact' },
  ];
  const msgsB = msgsA.concat([{ role: 'user', content: 'B ka extra message' }]); // B = A + append
  const html = mdThread(MD_USER, 'Samundar ka fact'); // render == A exactly, B ka prefix
  const w = makeWorldMd(html, t, { [CHAT_A]: msgsA, [CHAT_B]: msgsB }, [CHAT_A, CHAT_B]);
  await tick(150);
  assert.equal(w.__captured, null, 'exact twin + prefix twin = ambiguous, bind NAHI');
});

test('Orbix adapter CONTINUITY: exact bind ke BAAD render append-only grow kare (koi fresh capture nahi) = bind STABLE', async (t) => {
  const msgs = [
    { role: 'user', content: MD_USER },
    { role: 'assistant', content: 'Samundar ka fact' },
  ];
  const w = makeWorldMd(mdThread(MD_USER, 'Samundar ka fact'), t, { [CHAT_A]: msgs }, [CHAT_A]);
  await tick(150);
  assert.ok(w.__captured, 'exact par bind');
  const key1 = w.__captured.getChatKey();
  assert.ok(key1.includes(CHAT_A), 'sahi id');
  // Site par naya message aaya (render grow) par chat-refetch nahi hua (koi fresh capture NAHI)
  const t2 = w.document.querySelector('.thread');
  const row = w.document.createElement('div');
  row.className = 'msg assistant';
  row.innerHTML = '<div class="steps">s</div><div class="answer">naya jawab jo capture mein nahi</div>';
  t2.insertBefore(row, t2.children[2]);
  await tick(150);
  const key2 = w.__captured.getChatKey();
  assert.ok(key2 && key2.includes(CHAT_A), 'anchored continuity: append-growth par bind stable');
});

test('Orbix adapter FAIL-CLOSED: bound chat ke grow karte render se PREFIX-consistent doosra capture aaye = AMBIGUOUS', async (t) => {
  const msgs = [
    { role: 'user', content: MD_USER },
    { role: 'assistant', content: 'Samundar ka fact' },
  ];
  const w = makeWorldMd(mdThread(MD_USER, 'Samundar ka fact'), t, { [CHAT_A]: msgs }, [CHAT_A]);
  await tick(150);
  assert.ok(w.__captured, 'exact par bind');
  // Render grow (1 append), phir doosri chat ka capture jo grown render ka prefix hai
  const t2 = w.document.querySelector('.thread');
  const row = w.document.createElement('div');
  row.className = 'msg assistant';
  row.innerHTML = '<div class="steps">s</div><div class="answer">B wala extra</div>';
  t2.insertBefore(row, t2.children[2]);
  w.__chatData[CHAT_B] = msgs.concat([{ role: 'assistant', content: 'B wala extra' }]); // twin B == grown render EXACTLY
  w.__pageFetch(CHAT_B);
  await tick(150);
  const key = w.__captured.getChatKey();
  assert.equal(key, null, 'twin capture = ambiguity -> getChatKey null (fail-closed)');
});

test('Orbix adapter CONTINUITY: bound id ka STALE capture (purana snapshot overwrite) bind NAHI todta', async (t) => {
  const msgs = [
    { role: 'user', content: MD_USER },
    { role: 'assistant', content: 'Samundar ka fact' },
  ];
  const w = makeWorldMd(mdThread(MD_USER, 'Samundar ka fact'), t, { [CHAT_A]: msgs }, [CHAT_A]);
  await tick(150);
  assert.ok(w.__captured, 'exact par bind');
  // Render grow + bound id ka stale (purana 2-msg) capture dobara aaye (late async response)
  const t2 = w.document.querySelector('.thread');
  const row = w.document.createElement('div');
  row.className = 'msg assistant';
  row.innerHTML = '<div class="steps">s</div><div class="answer">naya append</div>';
  t2.insertBefore(row, t2.children[2]);
  w.__pageFetch(CHAT_A); // same stale dataMap content (2 msgs) - late duplicate response
  await tick(150);
  const key = w.__captured.getChatKey();
  assert.ok(key && key.includes(CHAT_A), 'stale same-id snapshot overwrite par bind stable (append-only continuity)');
});

test('Orbix adapter FAIL-CLOSED: bound id ka DIVERGENT capture (forged/tampered same-id) = bind TUTTA hai', async (t) => {
  const msgs = [
    { role: 'user', content: MD_USER },
    { role: 'assistant', content: 'Samundar ka fact' },
  ];
  const w = makeWorldMd(mdThread(MD_USER, 'Samundar ka fact'), t, { [CHAT_A]: msgs }, [CHAT_A]);
  await tick(150);
  assert.ok(w.__captured, 'exact par bind');
  w.__chatData[CHAT_A] = [{ role: 'user', content: 'bilkul alag content' }];
  w.__pageFetch(CHAT_A); // divergent same-id capture (forge/tamper/stale-cross)
  await tick(150);
  const key = w.__captured.getChatKey();
  assert.equal(key, null, 'divergent same-id capture = fail-closed unbind');
});
