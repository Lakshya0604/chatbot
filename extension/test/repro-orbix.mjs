import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const autoUtils = fs.readFileSync('../content/adapters/auto-utils.js','utf8');
const customUtils = fs.readFileSync('../content/adapters/custom-utils.js','utf8');
const FULL = `<div id="app">
<nav><button role="tab">Servers</button><button role="tab">Catalog</button><button role="tab">Chats</button><button role="tab">Docs</button><button role="tab">Videos</button><button role="tab">Playground</button><button role="tab">Memory</button></nav>
<main class="center" id="mainc"><div class="sharebar"><button class="chip">Share this chat</button><button class="chip">Copy chat</button></div><div class="thread" id="thread">
<div class="msg user"><div class="bubble">hi orbix, ek line mein bata tu kya kar sakta hai</div></div>
<div class="msg assistant"><div class="steps"><div class="prov">Orbix AI (gpt-oss-120b) - answered directly - no tools used</div></div><div class="answer">Main text ke jawab de sakta hoon, images bana sakta hoon, videos bhi</div></div>
<div class="msg user"><div class="bubble">accha ek fact sunao</div></div>
<div class="msg assistant"><div class="steps"><div class="prov">Orbix AI (gpt-oss-120b) - answered directly - no tools used</div></div><div class="answer">Billiyon ki whiskers unhe navigate karne mein madad karti hain</div></div>
</div>
<form class="composer"><button class="btn primary">Send</button><textarea id="ta"></textarea></form></main></div>`;
const html = FULL;
const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
const w = dom.window;
w.eval(customUtils); w.eval(autoUtils);
// rects: sab kuch visible; thread upar, composer neeche; msg rows left/right
const rects = new Map();
const set = (sel, r) => { const el = w.document.querySelector(sel); if (el) rects.set(el, r); };
set('#ta', { left: 380, width: 700, top: 640, height: 44 });
set('.thread', { left: 370, width: 900, top: 120, height: 500 });
set('nav', { left: 0, width: 1280, top: 60, height: 50 });
set('#mainc', { left: 360, width: 920, top: 60, height: 640 });
set('#chatwrap', { left: 360, width: 920, top: 110, height: 580 });
set('#app', { left: 0, width: 1280, top: 0, height: 720 });
set('form.composer', { left: 360, width: 920, top: 630, height: 60 });
rects.set(w.document.body, { left: 0, width: 1280, top: 0, height: 720 });
w.document.querySelectorAll('.msg.user').forEach(el => rects.set(el, { left: 900, width: 300, top: 150, height: 40 }));
w.document.querySelectorAll('.msg.assistant').forEach(el => rects.set(el, { left: 406, width: 500, top: 200, height: 80 }));
const measure = (el) => rects.get(el) || { left: 0, width: 100, top: 0, height: 20 };
const composer = w.ChatAuto.findComposer(w.document, measure);
console.log('composer:', composer && (composer.id || composer.tagName));
const list = w.ChatAuto.findMessageList(w.document, composer, measure);
console.log('list container:', list && list.container.className, 'rows:', list && list.rows.length, list && list.rows.map(r=>r.className));
if (list) {
  const sel = w.ChatCustom.deriveRowSelector(list.rows[0], w.document);
  console.log('derived rows selector:', sel);
  const matched = Array.from(w.document.querySelectorAll(sel));
  const inC = matched.filter(m => m.parentElement === list.container);
  console.log('matched:', matched.length, 'in-container:', inC.length, 'need:', Math.min(2, list.rows.length));
  console.log('match parents:', matched.map(m => (m.parentElement.className||m.parentElement.tagName)).slice(0,8));
}

// Case 1: only 2 messages visible -> .thread invalid (<3), MAIN.center must NOT win
const TWO = FULL.replace('<div class="msg user"><div class="bubble">accha ek fact sunao</div></div>','').replace(/<div class="msg assistant">(?:(?!<\/div>).)*whiskers[^]*?<\/div><\/div>/,'');
