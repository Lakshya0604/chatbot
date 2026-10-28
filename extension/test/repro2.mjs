import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const autoUtils = fs.readFileSync('../content/adapters/auto-utils.js','utf8');
const customUtils = fs.readFileSync('../content/adapters/custom-utils.js','utf8');
// Real Orbix shape: main.center > sharebar + thread(2 msgs) + form.composer
const html = `<div id="root"><div id="sidebar"></div><main class="center">
<div class="sharebar"><button class="chip">Share this chat</button><button class="chip">Copy chat</button></div>
<div class="thread"><div class="msg user"><div class="bubble">hi</div></div>
<div class="msg assistant"><div class="steps"><div class="prov">Orbix AI</div></div><div class="answer">Namaste, main Orbix hoon</div></div></div>
<form class="composer"><button class="btn primary">Send</button><textarea id="ta"></textarea></form>
</main></div>`;
const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://orbix-video-ly.web.app/', runScripts: 'dangerously' });
const w = dom.window;
w.eval(customUtils); w.eval(autoUtils);
const rects = new Map();
const set = (sel, r) => { const el = w.document.querySelector(sel); if (el) rects.set(el, r); };
set('#ta', { left: 380, width: 700, top: 640, height: 44 });
set('form.composer', { left: 360, width: 920, top: 630, height: 60 });
set('.thread', { left: 370, width: 900, top: 120, height: 300 });
set('.sharebar', { left: 370, width: 900, top: 70, height: 40 });
set('main.center', { left: 360, width: 920, top: 60, height: 640 });
set('#root', { left: 0, width: 1280, top: 0, height: 720 });
set('#sidebar', { left: 0, width: 340, top: 60, height: 660 });
rects.set(w.document.body, { left: 0, width: 1280, top: 0, height: 720 });
const measure = (el) => rects.get(el) || { left: 0, width: 100, top: 0, height: 20 };
const composer = w.ChatAuto.findComposer(w.document, measure);
const list = w.ChatAuto.findMessageList(w.document, composer, measure);
if (!list) { console.log('RESULT: no list (fail-closed, correct for 2-message case)'); process.exit(0); }
console.log('container:', list.container.tagName + '.' + list.container.className, 'rows:', list.rows.length);
const sel = w.ChatCustom.deriveRowSelector(list.rows[0], w.document);
console.log('derived:', sel, 'matchesSourceRow:', sel ? Array.from(w.document.querySelectorAll(sel)).includes(list.rows[0]) : null);
