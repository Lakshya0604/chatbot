// custom-utils.test.mjs - CUSTOM mode selector-derivation utilities ke tests.
// Ye utilities generic hain; tests PROVE karte hain ki simple DOM par sahi
// selectors banti hain, fragile (hashed-class) DOM par WARNING milti hai, aur
// reliable selector na bane to null (fail-closed) milta hai - galat selector nahi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const SCRIPT = fs.readFileSync(new URL('../content/adapters/custom-utils.js', import.meta.url), 'utf8');

function makeWorld(html, t) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://example.com/chat', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.eval(SCRIPT);
  return window;
}

test('deriveRowSelector: id wali row se #id selector', (t) => {
  const w = makeWorld('<div class="msg-row" id="m1">hi</div><div class="msg-row" id="m2">yo</div>', t);
  const row = w.document.querySelector('#m1');
  assert.equal(w.ChatCustom.deriveRowSelector(row, w.document), '#m1');
});

test('deriveRowSelector: stable classes se saari sibling rows match hoti hain', (t) => {
  const w = makeWorld(
    '<div class="bubble in">a</div><div class="bubble out">b</div><div class="bubble in">c</div>', t);
  const row = w.document.querySelectorAll('.bubble')[0];
  const sel = w.ChatCustom.deriveRowSelector(row, w.document);
  assert.equal(sel, 'div.bubble');
  assert.equal(w.document.querySelectorAll(sel).length, 3);
});

test('deriveRowSelector: hashed/fragile classes par selector banti hai par fragile flag hota hai', (t) => {
  const w = makeWorld('<div class="x9f3k2q zz1aa">a</div><div class="x9f3k2q zz1aa">b</div>', t);
  const row = w.document.querySelector('.x9f3k2q');
  const sel = w.ChatCustom.deriveRowSelector(row, w.document);
  assert.ok(sel, 'selector bani');
  assert.ok(w.ChatCustom.isFragileSelector(sel), 'fragile flag: ' + sel);
});

test('deriveRowSelector: simple stable classes fragile NAHI lagti', (t) => {
  const w = makeWorld('<div class="message incoming">a</div>', t);
  assert.equal(w.ChatCustom.isFragileSelector('div.message.incoming'), false);
});

test('deriveElementSelector: unique contenteditable composer', (t) => {
  const w = makeWorld(
    '<div class="chatbox" contenteditable="true" role="textbox"></div><footer><button>Send</button></footer>', t);
  const comp = w.document.querySelector('.chatbox');
  const sel = w.ChatCustom.deriveElementSelector(comp, w.document);
  assert.ok(sel, 'selector mili');
  assert.equal(w.document.querySelectorAll(sel).length, 1, 'unique');
  assert.equal(w.document.querySelector(sel), comp, 'same element');
});

test('deriveOutgoingClass: incoming vs outgoing ka class diff', (t) => {
  const w = makeWorld('<div class="bubble in">a</div><div class="bubble out is-out">b</div>', t);
  const inRow = w.document.querySelector('.bubble.in');
  const outRow = w.document.querySelector('.bubble.out');
  assert.equal(w.ChatCustom.deriveOutgoingClass(inRow, outRow), 'out');
});

test('deriveOutgoingClass: diff na ho to null (fallback, galat class nahi)', (t) => {
  const w = makeWorld('<div class="bubble">a</div><div class="bubble">b</div>', t);
  const rows = w.document.querySelectorAll('.bubble');
  assert.equal(w.ChatCustom.deriveOutgoingClass(rows[0], rows[1]), null);
});

// Orbix jaisa nested markup: row > bubble/answer. User INNER element par click
// karta hai; row selector phir bhi outer row tak pahunchni chahiye (ancestor walk).
test('deriveRowSelector: nested markup mein inner click se outer row selector (Orbix shape)', (t) => {
  const w = makeWorld(
    '<div class="msg user"><div class="bubble">mera msg</div></div>' +
    '<div class="msg assistant"><div class="meta">bot header</div><div class="answer">bot jawab</div></div>' +
    '<div class="msg user"><div class="bubble">mera msg 2</div></div>' +
    '<div class="msg assistant"><div class="meta">bot header</div><div class="answer">bot jawab 2</div></div>', t);
  // Inner bubble par click (user message ka content)
  const bubble = w.document.querySelector('.bubble');
  const sel = w.ChatCustom.deriveRowSelector(bubble, w.document);
  assert.equal(sel, 'div.msg', 'inner bubble click se outer row selector bani');
  assert.equal(w.document.querySelectorAll(sel).length, 4, 'saari rows (incoming+outgoing) match');
  // Inner answer par click (bot message ka content)
  const answer = w.document.querySelector('.answer');
  const sel2 = w.ChatCustom.deriveRowSelector(answer, w.document);
  assert.equal(sel2, 'div.msg', 'inner answer click se bhi outer row selector bani');
});

test('deriveOutgoingClass: resolved rows (closest) se sahi role class - bubble NAHI', (t) => {
  const w = makeWorld(
    '<div class="msg user"><div class="bubble">mera msg</div></div>' +
    '<div class="msg assistant"><div class="answer">bot jawab</div></div>', t);
  // custom.js finish() ka pattern: dono picked elements ko rows selector tak resolve
  const rows = 'div.msg';
  const inRow = w.document.querySelector('.answer').closest(rows);
  const outRow = w.document.querySelector('.bubble').closest(rows);
  const out = w.ChatCustom.deriveOutgoingClass(inRow, outRow);
  assert.equal(out, 'user', 'outgoingClass row ki class honi chahiye, inner bubble ki nahi');
  // isIncoming check: user row incoming NAHI, assistant row incoming HAI
  assert.equal(inRow.classList.contains(out), false);
  assert.equal(outRow.classList.contains(out), true);
});

test('deriveRowSelector: repeated inner content (markdown blocks) row selector NAHI banta', (t) => {
  // Orbix shape: har answer ke andar KAI .md blocks; rows se zyada count, par
  // alag-alag parents. Score=count/parents se outer .thread ke sibling rows jeet-te hain.
  const w = makeWorld(
    '<div class="thread">' +
    '<div class="msg user"><div class="bubble">m1</div></div>' +
    '<div class="msg assistant"><div class="answer"><div class="md">a</div><div class="md">b</div><div class="md">c</div></div></div>' +
    '<div class="msg user"><div class="bubble">m2</div></div>' +
    '<div class="msg assistant"><div class="answer"><div class="md">d</div><div class="md">e</div><div class="md">f</div></div></div>' +
    '</div>', t);
  const md = w.document.querySelector('.md');
  const sel = w.ChatCustom.deriveRowSelector(md, w.document);
  assert.equal(sel, 'div.msg', 'repeated inner .md (6 matches, 2 parents) ko outer row (4 matches, 1 parent) harata hai');
});

// ---- ChatGPT-shaped DOM: hashed classes, same-class rows, "You said:" heading ----
const GPT = `<ol aria-label="Conversation">
<li class="xeuugli xak2u8z"><h5>You said:</h5><div>hello there</div></li>
<li class="xeuugli xak2u8z"><h6>ChatGPT said:</h6><section aria-label="DIL content">hi, how can I help</section></li>
</ol><textarea name="prompt" id="p"></textarea><button aria-label="Send message"><svg><use/></svg></button>`;
function gptWorld(t) {
  const w = makeWorld(GPT, t);
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent.replace(/(said:)/g, '$1\n'); } });
  return w;
}
test('hashed-class row: parent hook selector + prefix direction', (t) => {
  const w = gptWorld(t); const d = w.document; const U = w.ChatCustom;
  const [a, b] = d.querySelectorAll('li');
  const sel = U.deriveRowSelector(b, d);
  assert.equal(sel, 'ol[aria-label^="Conversation"] > li');
  const dir = U.deriveDirection(b, a); // inRow=assistant, outRow=user
  assert.equal(dir.outgoingPrefix, 'You said:');
  assert.equal(U.isOutgoingRow(a, dir), true);
  assert.equal(U.isOutgoingRow(b, dir), false);
  assert.equal(U.rowText(a, dir), 'hello there');
});
test('send/composer resolve to stable selectors', (t) => {
  const w = gptWorld(t); const d = w.document; const U = w.ChatCustom;
  assert.equal(U.deriveElementSelector(d.querySelector('button'), d), 'button[aria-label^="Send message"]');
  assert.match(U.deriveElementSelector(d.querySelector('textarea'), d), /name="prompt"|#p/);
});
test('no direction marker -> null (fail closed)', (t) => {
  const w = makeWorld('<div class="aaa1 bbb2">x</div><div class="aaa1 bbb2">y</div>', t);
  const [a, b] = w.document.querySelectorAll('div');
  assert.equal(w.ChatCustom.deriveDirection(a, b), null);
});

test('per-chat id in aria-label -> stable prefix selector', (t) => {
  const w = makeWorld('<ol aria-label="Conversation chat-6532ceab-940f-4827-84d1-2d3f6d39d782"><li class="aa1 bb2">a</li><li class="aa1 bb2">b</li></ol>', t);
  const li = w.document.querySelector('li');
  const sel = w.ChatCustom.deriveRowSelector(li, w.document);
  assert.equal(sel, 'ol[aria-label^="Conversation"] > li');
  assert.equal(w.document.querySelectorAll(sel).length, 2);
});
