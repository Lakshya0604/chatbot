// orbix-render-parity.test.mjs - mdToPlain ko handwritten grammar maan-ne ke bajaye
// ACTUAL parser/renderer ke against ground karta hai: Orbix ka real renderer
// react-markdown 9.1.0 + remark-gfm 4.0.1 (orbix-site/package.json ke exact versions)
// se raw markdown RENDER karke, rendered text se adapter ke mdToPlain(raw) tak.
// Components mapping Rich.jsx (client/src/Rich.jsx:60-77) ka verbatim JS mirror hai
// (JSX ke bina) - parser/remark/hast REAL hain, sirf 4 chhote component functions
// source se copy kiye gaye hain (CopyBtn/Mermaid/Chart ka static-markup behavior).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

// Adapter source se hi mdToPlain/normMsgText lo (copy nahi - drift impossible).
const SRC = fs.readFileSync(new URL('../content/adapters/orbix.js', import.meta.url), 'utf8');
const sliceStart = SRC.indexOf('  function normMsgText');
const sliceEnd = SRC.indexOf('  function msgCompareText');
assert.ok(sliceStart > 0 && sliceEnd > sliceStart, 'adapter source slice mila');
const { normMsgText, mdToPlain } = new Function(
  SRC.slice(sliceStart, sliceEnd) + '; return { normMsgText, mdToPlain };'
)();

// ---- Rich.jsx mirror (sirf static-render behavior) ----
function CopyBtn() { return h('button', { className: 'copy' }, 'Copy'); }
function Mermaid() {
  // Initial paint: skeleton text; mermaid render ke baad SVG (innerText mein SVG nahi aata).
  return h('div', { className: 'rich-card diagram' }, h('div', { className: 'skel' }, 'Drawing diagram…'));
}
function Chart({ raw }) {
  // Valid chart JSON -> SVG (innerText nahi); invalid -> raw source dikhata hai.
  try { JSON.parse(raw); } catch { return h('pre', null, h('code', null, raw)); }
  return h('div', { className: 'rich-card' }, h('svg', { viewBox: '0 0 1 1' }));
}
const components = {
  a: ({ href, children }) => h('a', { href, target: '_blank', rel: 'noreferrer noopener' }, children),
  table: ({ children }) => h('div', { className: 'tbl' }, h('table', null, children)),
  pre: ({ children }) => h(React.Fragment, null, children),
  code: ({ className, children }) => {
    const src = String(children).replace(/\n$/, '');
    const lang = /language-(\w+)/.exec(className || '')?.[1];
    if (lang === 'mermaid') return h(Mermaid, { code: src });
    if (lang === 'chart') return h(Chart, { raw: src });
    if (!lang && !src.includes('\n')) return h('code', { className: 'inl' }, children);
    return h('div', { className: 'codeblk' },
      h('div', { className: 'codebar' }, h('span', null, lang || 'text'), h(CopyBtn, { text: src })),
      h('pre', null, h('code', null, src)));
  },
};
function renderRichToText(raw) {
  const html = renderToStaticMarkup(
    h('div', { className: 'md' }, h(ReactMarkdown, { remarkPlugins: [remarkGfm], components }, raw)));
  const dom = new JSDOM('<!DOCTYPE html><body>' + html + '</body>');
  return normMsgText(innerTextApprox(dom.window.document.querySelector('.md')));
}

// Chrome innerText ka block-aware approximation (jsdom innerText nahi deta).
// SVG subtree skip (innerText SVG text collect nahi karta), IMG skip (koi text nahi),
// block elements par '\n', TD/TH ke beech '\t'.
const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI',
  'BLOCKQUOTE', 'PRE', 'TABLE', 'TR', 'HR', 'BR', 'THEAD', 'TBODY', 'SECTION', 'ARTICLE']);
function innerTextApprox(el) {
  let out = '';
  const walk = (node) => {
    if (node.nodeType === 3) { out += node.nodeValue; return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'SVG' || tag === 'IMG') return;
    if (tag === 'TD' || tag === 'TH') {
      if (out && !out.endsWith('\n') && !out.endsWith('\t')) out += '\t';
    } else if (BLOCKS.has(tag) && out && !out.endsWith('\n')) out += '\n';
    node.childNodes.forEach(walk);
    if (BLOCKS.has(tag) && out && !out.endsWith('\n')) out += '\n';
  };
  walk(el);
  return out;
}

// ---- Corpus ----
// Live-observed (Nov 4 diag, /tmp/diag2.log): dono replies poore bold-wrap mein thi;
// telemetry 80 chars par truncate karti hai - fragment dono side observed.
const LIVE_1_RAW = '**समुद्र की सतह पर हर साल लगभग 3 ट्रिलियन टन पानी वाष्पीकरण से वायुमंडल में मिल जा**';
const LIVE_2_RAW = '**Samundar ki sabse gehri jagah Mariana Trench hai, jo lagbhag 11 km tak nichli ha**';

const MUST_MATCH = [
  ['live reply 1 (bold-wrapped Hindi)', LIVE_1_RAW],
  ['live reply 2 (bold-wrapped Hinglish)', LIVE_2_RAW],
  ['plain single line', 'Yeh ek seedha jawab hai bina kisi formatting ke.'],
  ['mixed emphasis', 'Yeh **zaroori** hai aur *dhyan* dena ~~galat~~ sahi tareeka.'],
  ['underscore emphasis', 'yeh _bhi_ italic aur __bhi__ bold hai'],
  ['inline code', 'pehle `npm test` chalao phir commit karo'],
  ['link', 'detail [is page](https://example.com/docs) par hai'],
  ['autolink', 'source https://example.com/live se aaya'],
  ['image removed', 'pehle ![screenshot](https://x.test/a.png) baad mein text'],
  ['heading + paras', '## Pehla point\n\nDoosra paragraph yahan hai.\n\nTeesra bhi hai.'],
  ['unordered list', 'Ingredients:\n- doodh\n- cheeni\n- **elaichi** (zaroori)'],
  ['ordered list', 'Steps:\n1. Pehle kholo\n2. Phir likho\n3. Send mat karo'],
  ['nested list', 'Level ek:\n- bahar\n  - andar wala\n  - doosra andar'],
  ['blockquote', 'Jaisa kaha gaya:\n> yeh quote hai\n> doosri line'],
  ['task list', '- [x] ho gaya\n- [ ] baaki hai'],
  ['GFM table', '| Naam | Score |\n| --- | ---: |\n| Ram | 4.5 |\n| Sita | 5 |'],
  ['emoji + devanagari mix', 'Sahi hai! 🌊 गहराई 11km है।'],
  ['inline HTML literal rehta hai (react-markdown 9: escaped text, verified)', 'yeh <b>bold</b> hai'],
  ['fenced single-line no-lang renders INLINE (Rich.jsx: no lang + no \n)', 'ise dekho:\n```\nsome output line\n```'],
  ['multi-para bold mid', 'Shuru mein plain.\n\nBeech mein **highlight** ke saath line.\n\nAakhiri plain.'],
];

// Render se TEXT mismatch = correlate nahi hoga = fail-closed (koi galat bind nahi,
// par us reply wali chat mein feature silently inactive). Ye DOCUMENTED residuals hain.
const KNOWN_DIVERGENT = [
  ['fenced code (lang)', 'try this:\n```js\nconsole.log(1)\n```', 'codebar "js Copy" label rendered text mein aata hai'],
  ['fenced code (no lang, multi-line)', '```\nline one\nline two\n```', 'codebar "text Copy" label'],
  ['mermaid fence', '```mermaid\ngraph TD; A-->B\n```', 'Mermaid -> SVG/skeleton, source text nahi'],
  ['chart fence (valid JSON)', '```chart\n{"labels":["a"],"values":[1]}\n```', 'Chart -> SVG'],
  ['HTML entity', '5 &amp; 6 mila ke 11', 'renderer entity decode karta hai, mdToPlain nahi'],
  ['setext heading', 'Mera Title\n===', '=== underline mdToPlain mein literal rehti hai'],
];

test('PARITY: renderer text == mdToPlain (must-match corpus)', () => {
  for (const [name, raw] of MUST_MATCH) {
    const rendered = renderRichToText(raw);
    const plain = normMsgText(mdToPlain(raw));
    assert.equal(rendered, plain, `mismatch: ${name}\nrendered=[${rendered}]\nplain=[${plain}]`);
  }
});

test('PARITY: documented divergences fail-closed rehte hain (no correlation, no wrong bind)', () => {
  for (const [name, raw, why] of KNOWN_DIVERGENT) {
    const rendered = renderRichToText(raw);
    const plain = normMsgText(mdToPlain(raw));
    assert.notEqual(rendered, plain, `${name}: ab match karne laga (${why}) - residuals doc update karo`);
  }
});

test('PARITY: chart invalid JSON fallback mdToPlain se match karta hai (raw source render)', () => {
  const raw = '```chart\n{not valid json\n```';
  assert.equal(renderRichToText(raw), normMsgText(mdToPlain(raw)));
});
