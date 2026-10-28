// auto-utils.test.mjs - AUTO mode detection helpers ke tests.
// jsdom mein layout nahi hota, isliye measure() inject karke rects dete hain.
// Har test PROVE karta hai: sahi signal par detect hota hai, doubtful par
// null/false (fail-closed) - guess kabhi nahi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const SCRIPT = fs.readFileSync(new URL('../content/adapters/auto-utils.js', import.meta.url), 'utf8');

function makeWorld(html, t) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://example.com/chat', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  window.eval(SCRIPT);
  return window;
}

// rects: Map<Element, {left,width,top,height}> se measure function
function measurer(rects) {
  return (el) => rects.get(el) || { left: 0, width: 0, top: 0, height: 0 };
}

test('findComposer: sabse neeche wala visible editable milta hai', (t) => {
  const w = makeWorld('<div contenteditable="true" id="search"></div><div contenteditable="true" id="composer"></div>', t);
  const rects = new Map([
    [w.document.querySelector('#search'), { left: 0, width: 300, top: 10, height: 30 }],
    [w.document.querySelector('#composer'), { left: 0, width: 600, top: 600, height: 40 }],
  ]);
  const found = w.ChatAuto.findComposer(w.document, measurer(rects));
  assert.equal(found && found.id, 'composer');
});

test('findComposer: hidden (zero-size) editable ignore hota hai; kuch na mile to null', (t) => {
  const w = makeWorld('<div contenteditable="true" id="c"></div>', t);
  // zero rect (jsdom default) = invisible
  assert.equal(w.ChatAuto.findComposer(w.document), null);
});

test('findMessageList: composer ke upar wali list milti hai, door ki sidebar list nahi', (t) => {
  const w = makeWorld(
    '<div id="sidebar"><div class="conv">A: hi</div><div class="conv">B: yo</div><div class="conv">C: ok</div></div>' +
    '<div id="chatwrap"><div id="list"><div class="m">one</div><div class="m">two</div><div class="m">three</div></div>' +
    '<div id="composer" contenteditable="true"></div></div>', t);
  const $ = (s) => w.document.querySelector(s);
  const rects = new Map([
    [$('#composer'), { left: 0, width: 600, top: 600, height: 40 }],
    [$('#list'), { left: 0, width: 600, top: 100, height: 480 }],
    [$('#sidebar'), { left: 0, width: 200, top: 100, height: 480 }],
    [$('#chatwrap'), { left: 200, width: 600, top: 80, height: 560 }],
    [w.document.body, { left: 0, width: 800, top: 0, height: 700 }],
  ]);
  // rows ke bhi rects chahiye (rowLikeChildren text use karta hai, measure nahi)
  const list = w.ChatAuto.findMessageList(w.document, $('#composer'), measurer(rects));
  assert.ok(list, 'list mili');
  assert.equal(list.container.id, 'list');
  assert.equal(list.rows.length, 3);
});

test('findMessageList: nav tab bar (buttons/role=tab) ko message list nahi maanta - Orbix regression', (t) => {
  // Orbix bug: top navbar ke 7 uniform tab buttons "best list" ban gaye the;
  // asli thread (2 messages) haar gaya tha. Ab controls/nav hard-reject hote hain.
  const w = makeWorld(
    '<div id="app">' +
    '<nav><button role="tab">Servers</button><button role="tab">Catalog</button><button role="tab">Chats</button>' +
    '<button role="tab">Docs</button><button role="tab">Videos</button><button role="tab">Playground</button><button role="tab">Memory</button></nav>' +
    '<div id="chatwrap"><div id="thread">' +
    '<div class="msg user">hi orbix, ek line mein bata tu kya kar sakta hai</div>' +
    '<div class="msg assistant"><div class="answer">Main text ke jawab de sakta hoon, images bana sakta hoon</div></div>' +
    '<div class="msg user">accha ek fact sunao</div>' +
    '<div class="msg assistant"><div class="answer">Billiyon ki whiskers unhe navigate karne mein madad karti hain</div></div>' +
    '</div><form class="composer"><textarea id="composer"></textarea></form></div>' +
    '</div>', t);
  const $ = (s) => w.document.querySelector(s);
  const rects = new Map([
    [$('#composer'), { left: 380, width: 700, top: 640, height: 44 }],
    [$('#thread'), { left: 370, width: 900, top: 120, height: 500 }],
    [$('nav'), { left: 0, width: 1280, top: 60, height: 50 }],
    [$('#chatwrap'), { left: 360, width: 920, top: 110, height: 580 }],
    [$('#app'), { left: 0, width: 1280, top: 0, height: 720 }],
    [w.document.body, { left: 0, width: 1280, top: 0, height: 720 }],
  ]);
  const list = w.ChatAuto.findMessageList(w.document, $('#composer'), measurer(rects));
  assert.ok(list, 'list mili');
  assert.equal(list.container.id, 'thread', 'navbar nahi, asli thread chuna');
  assert.equal(list.rows.length, 4);
});

test('findMessageList: div role=tablist wale div rows bhi reject (tag BUTTON na ho tab bhi)', (t) => {
  const w = makeWorld(
    '<div id="app">' +
    '<div role="tablist" id="tabs"><div role="tab">Home</div><div role="tab">Chats</div><div role="tab">Settings</div></div>' +
    '<div id="chatwrap"><div id="thread">' +
    '<div class="m">pehla message yahan likha hua hai</div>' +
    '<div class="m">doosra message ka jawab yahan hai</div>' +
    '<div class="m">teesra message bhi kaafi lamba hai bhai</div>' +
    '</div><div id="composer" contenteditable="true"></div></div>' +
    '</div>', t);
  const $ = (s) => w.document.querySelector(s);
  const rects = new Map([
    [$('#composer'), { left: 0, width: 600, top: 640, height: 40 }],
    [$('#thread'), { left: 0, width: 600, top: 120, height: 500 }],
    [$('#tabs'), { left: 0, width: 800, top: 10, height: 44 }],
    [$('#chatwrap'), { left: 0, width: 640, top: 100, height: 580 }],
    [$('#app'), { left: 0, width: 800, top: 0, height: 720 }],
    [w.document.body, { left: 0, width: 800, top: 0, height: 720 }],
  ]);
  const list = w.ChatAuto.findMessageList(w.document, $('#composer'), measurer(rects));
  assert.ok(list, 'list mili');
  assert.equal(list.container.id, 'thread', 'tablist reject hui');
});

test('detectDirectionMarker: data-message-author-role inner attribute se', (t) => {
  const w = makeWorld(
    '<div class="r"><div data-message-author-role="user">mera msg</div></div>' +
    '<div class="r"><div data-message-author-role="assistant">unka msg</div></div>', t);
  const rows = Array.from(w.document.querySelectorAll('.r'));
  const d = w.ChatAuto.detectDirectionMarker(rows);
  assert.ok(d, 'marker mila');
  assert.equal(d.kind, 'innerAttr');
  assert.equal(d.outgoingValue, 'user');
});

test('detectDirectionMarker: "You said:" style prefix label se', (t) => {
  const w = makeWorld(
    '<div class="r">You said:\nmera msg</div>' +
    '<div class="r">Rohan said:\nunka msg</div>', t);
  const rows = Array.from(w.document.querySelectorAll('.r'));
  const d = w.ChatAuto.detectDirectionMarker(rows);
  assert.ok(d, 'marker mila');
  assert.equal(d.kind, 'prefix');
  assert.equal(d.prefix, 'You said:');
});

test('detectDirectionMarker: out/sent class token se', (t) => {
  const w = makeWorld(
    '<div class="msg x9q message-out">mera</div>' +
    '<div class="msg x9q message-in">unka</div>', t);
  const rows = Array.from(w.document.querySelectorAll('.msg'));
  const d = w.ChatAuto.detectDirectionMarker(rows);
  assert.ok(d, 'marker mila');
  assert.equal(d.kind, 'classToken');
  assert.equal(d.cls, 'message-out');
});

test('detectDirectionMarker: koi signal nahi to null (fail-closed)', (t) => {
  const w = makeWorld('<div class="m ab1cd2">one</div><div class="m ab1cd2">two</div><div class="m ab1cd2">three</div>', t);
  const rows = Array.from(w.document.querySelectorAll('.m'));
  assert.equal(w.ChatAuto.detectDirectionMarker(rows), null);
});

test('detectDirectionByAlignment: right cluster outgoing, dono sides chahiye', (t) => {
  const w = makeWorld(
    '<div id="list"><div class="m"><span class="b">left one</span></div>' +
    '<div class="m"><span class="b">right one</span></div>' +
    '<div class="m"><span class="b">left two</span></div></div>', t);
  const $ = (s) => w.document.querySelector(s);
  const list = $('#list');
  const bubbles = Array.from(w.document.querySelectorAll('.b'));
  const rects = new Map([[list, { left: 0, width: 600, top: 0, height: 400 }]]);
  // list center = 300. left bubbles center 150, right bubble center 520.
  rects.set(bubbles[0], { left: 50, width: 200, top: 0, height: 30 });
  rects.set(bubbles[1], { left: 420, width: 200, top: 0, height: 30 });
  rects.set(bubbles[2], { left: 50, width: 200, top: 0, height: 30 });
  // rows full width
  Array.from(w.document.querySelectorAll('.m')).forEach((r) => rects.set(r, { left: 0, width: 600, top: 0, height: 40 }));
  const d = w.ChatAuto.detectDirectionByAlignment(Array.from(w.document.querySelectorAll('.m')), list, measurer(rects));
  assert.ok(d, 'alignment direction mila');
  assert.equal(d.outgoing, 'right');
});

test('detectDirectionByAlignment: sirf ek side ho to null (fail-closed)', (t) => {
  const w = makeWorld('<div id="list"><div class="m"><span class="b">a</span></div><div class="m"><span class="b">b</span></div></div>', t);
  const $ = (s) => w.document.querySelector(s);
  const list = $('#list');
  const rects = new Map([[list, { left: 0, width: 600, top: 0, height: 400 }]]);
  Array.from(w.document.querySelectorAll('.b')).forEach((b) => rects.set(b, { left: 50, width: 200, top: 0, height: 30 }));
  Array.from(w.document.querySelectorAll('.m')).forEach((r) => rects.set(r, { left: 0, width: 600, top: 0, height: 40 }));
  assert.equal(w.ChatAuto.detectDirectionByAlignment(Array.from(w.document.querySelectorAll('.m')), list, measurer(rects)), null);
});

test('isIncomingByAlign/isOutgoingByAlign: clear sides detect, center/system row dono mein false (fail-closed)', (t) => {
  const w = makeWorld('<div id="list"></div><div class="m"><span class="b">x</span></div>', t);
  const $ = (s) => w.document.querySelector(s);
  const list = $('#list');
  const row = $('.m');
  const bubble = $('.b');
  const rects = new Map([[list, { left: 0, width: 600, top: 0, height: 400 }], [row, { left: 0, width: 600, top: 0, height: 40 }]]);
  rects.set(bubble, { left: 50, width: 200, top: 0, height: 30 }); // LEFT side
  assert.equal(w.ChatAuto.isIncomingByAlign(row, list, 'right', measurer(rects)), true);
  assert.equal(w.ChatAuto.isOutgoingByAlign(row, list, 'right', measurer(rects)), false);
  rects.set(bubble, { left: 420, width: 200, top: 0, height: 30 }); // RIGHT side
  assert.equal(w.ChatAuto.isIncomingByAlign(row, list, 'right', measurer(rects)), false);
  assert.equal(w.ChatAuto.isOutgoingByAlign(row, list, 'right', measurer(rects)), true);
  rects.set(bubble, { left: 250, width: 100, top: 0, height: 30 }); // CENTER (system msg)
  assert.equal(w.ChatAuto.isIncomingByAlign(row, list, 'right', measurer(rects)), false);
  assert.equal(w.ChatAuto.isOutgoingByAlign(row, list, 'right', measurer(rects)), false);
  // zero-size (unlaid-out) -> dono false
  rects.set(bubble, { left: 0, width: 0, top: 0, height: 0 });
  assert.equal(w.ChatAuto.isIncomingByAlign(row, list, 'right', measurer(rects)), false);
});

test('findMessageList: composer wali branch pehle exclude hoti hai - sharebar+thread galat rows nahi bante (Orbix MAIN.center regression)', (t) => {
  // Real Orbix: main.center ke direct kids = sharebar + thread(2 msgs) + form.composer.
  // Purane code mein tag filter form ko hata deta tha aur sharebar+thread "rows"
  // ban jaate the; deriveRowSelector phir '#root > div' jaisi garbage deta tha.
  // Ab composer branch row-counting se pehle exclude hoti hai -> sirf 2 kids
  // bachte hain -> minRows se reject -> fail-closed (galat list nahi).
  const w = makeWorld(
    '<div id="root"><div id="sidebar"></div><main class="center" id="mainc">' +
    '<div class="sharebar"><button>Share this chat</button><button>Copy chat</button></div>' +
    '<div class="thread">' +
    '<div class="msg user"><div class="bubble">hi</div></div>' +
    '<div class="msg assistant"><div class="answer">Namaste, main Orbix hoon - kaise madad karun</div></div>' +
    '</div>' +
    '<form class="composer"><button>Send</button><textarea id="composer"></textarea></form>' +
    '</main></div>', t);
  const $ = (s) => w.document.querySelector(s);
  const rects = new Map([
    [$('#composer'), { left: 380, width: 700, top: 640, height: 44 }],
    [$('form.composer'), { left: 360, width: 920, top: 630, height: 60 }],
    [$('.thread'), { left: 370, width: 900, top: 120, height: 300 }],
    [$('.sharebar'), { left: 370, width: 900, top: 70, height: 40 }],
    [$('#mainc'), { left: 360, width: 920, top: 60, height: 640 }],
    [$('#root'), { left: 0, width: 1280, top: 0, height: 720 }],
    [w.document.body, { left: 0, width: 1280, top: 0, height: 720 }],
  ]);
  const list = w.ChatAuto.findMessageList(w.document, $('#composer'), measurer(rects));
  assert.equal(list, null, '2-message thread + sharebar galat list nahi banti (fail-closed)');
});

test('findMessageList: composer sibling branch exclude hone par bhi 3+ message wali thread milti hai', (t) => {
  const w = makeWorld(
    '<main class="center" id="mainc">' +
    '<div class="sharebar"><button>Share</button><button>Copy</button></div>' +
    '<div class="thread">' +
    '<div class="msg user"><div class="bubble">pehla message kaafi lamba text yahan</div></div>' +
    '<div class="msg assistant"><div class="answer">doosra message ka jawab yahan aata hai</div></div>' +
    '<div class="msg user"><div class="bubble">teesra message bhi present hai ab</div></div>' +
    '</div>' +
    '<form class="composer"><button>Send</button><textarea id="composer"></textarea></form>' +
    '</main>', t);
  const $ = (s) => w.document.querySelector(s);
  const rects = new Map([
    [$('#composer'), { left: 380, width: 700, top: 640, height: 44 }],
    [$('form.composer'), { left: 360, width: 920, top: 630, height: 60 }],
    [$('.thread'), { left: 370, width: 900, top: 120, height: 480 }],
    [$('.sharebar'), { left: 370, width: 900, top: 70, height: 40 }],
    [$('#mainc'), { left: 360, width: 920, top: 60, height: 640 }],
    [w.document.body, { left: 0, width: 1280, top: 0, height: 720 }],
  ]);
  const list = w.ChatAuto.findMessageList(w.document, $('#composer'), measurer(rects));
  assert.ok(list, 'list mili');
  assert.equal(list.container.className, 'thread');
  assert.equal(list.rows.length, 3);
});
