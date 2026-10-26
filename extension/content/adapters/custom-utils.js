// custom-utils.js - CUSTOM (user-selected) chat mode ke pure helper functions.
// Kisi specific website ka knowledge NAHI - user khud picker se message row,
// composer, send button select karta hai; ye utilities us selection se stable
// CSS selectors banati hain aur unki quality check karti hain.
//
// IMAANADAARI: har website alag hoti hai. Ye utilities best-effort hain -
// kai sites (hashed/generated CSS classes wali, jaise WhatsApp Web) par derived
// selectors site ke agle deploy par TUT sakte hain. isFragileSelector() iska
// andaza deta hai; guarantee nahi. Kuch sites par custom mode kaam hi nahi
// karega (canvas-based chat, cross-origin iframe, shadow DOM) - fail-closed.

(function (global) {
  'use strict';

  // esc har jagah available nahi (purane browsers/test DOMs). Simple fallback.
  const esc = (typeof CSS !== 'undefined' && CSS.escape)
    ? CSS.escape
    : (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);

  // Hashed/generated class ka pattern: lambi random-looking token (WhatsApp Web
  // jaisi sites inhe har deploy par badal deti hain). Exact detection impossible;
  // ye sirf heuristic warning hai.
  function isFragileClass(cls) {
    if (!cls) return false;
    if (cls.length <= 2) return false;
    if (/^[a-z]{1,2}[0-9_-]/.test(cls)) return true; // x1y2z3 / e5r6...
    if (/^_[A-Za-z0-9_-]{3,}$/.test(cls)) return true; // _ahlk
    const vowels = (cls.match(/[aeiou]/gi) || []).length;
    if (cls.length >= 6 && vowels / cls.length < 0.2) return true; // bina vowels ke lambi
    return false;
  }

  function isFragileSelector(sel) {
    if (!sel) return true;
    return String(sel).split(/[\s>+~.#[\]:]+/).some(isFragileClass);
  }

  function stableClasses(el) {
    return Array.from(el.classList || []).filter((c) => c && !isFragileClass(c));
  }

  // Ek element ke liye selector jo USI LEVEL ke saare siblings match kare
  // (message rows ke liye: ek row se selector jo saari rows pakde).
  function deriveRowSelector(el, doc) {
    if (!el) return null;
    if (el.id) return '#' + esc(el.id);
    // Stable classes ka combination: 1..3 classes ke candidates mein se woh
    // selector lo jo SABSE ZYADA elements match kare - row selector ka maqsad
    // saari rows (incoming+outgoing) pakadna hai, sirf clicked wali nahi.
    // NESTED MARKUP FIX: user aksar row ke ANDAR ke element (bubble/text wrapper)
    // par click karta hai; sirf clicked element ke classes dekhne se aadhi rows
    // match hoti hain (jaise sirf outgoing bubbles). Isliye clicked element +
    // uske 5 ancestors tak sab candidates try karo (chat rows aksar deep nested hote hain).
    // Scoring: count / distinct-parents. Chat rows SIBLINGS hote hain (ek hi
    // thread container ke andar), jabki repeated inner content (markdown blocks,
    // bubbles) alag-alag rows mein phaila hota hai. Single-parent max-count
    // candidate = row pattern ka sabse strong signal.
    let best = null;
    let bestKey = null; // [parents ASC, count DESC, depth DESC(outer)]
    let node = el;
    for (let depth = 0; depth <= 5 && node && node !== doc.body && node.nodeType === 1; depth++) {
      const classes = stableClasses(node);
      for (let n = 1; n <= Math.min(classes.length, 3); n++) {
        const sel = node.tagName.toLowerCase() + '.' + classes.slice(0, n).map(esc).join('.');
        let els;
        try { els = doc.querySelectorAll(sel); } catch (e) { continue; }
        if (!els.length) continue;
        const parents = new Set();
        els.forEach((m) => parents.add(m.parentElement));
        // Row pattern ka signal: EK container ke kitne siblings (parents kam,
        // count zyada). Barabar ho to OUTER (gehri) row prefer - inner repeated
        // content (markdown blocks) rows nahi hota.
        const key = [-parents.size, els.length, depth];
        if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
          best = sel; bestKey = key;
        }
      }
      node = node.parentElement;
    }
    if (best) return best;
    // Koi stable class nahi: fragile classes use karo (warn karte hue)
    const fragile = Array.from(el.classList || []);
    if (fragile.length) {
      return el.tagName.toLowerCase() + '.' + esc(fragile[0]);
    }
    // Last resort: tag + nth-of-type (bahut fragile, sirf dummy/simple sites par)
    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    const idx = Array.prototype.indexOf.call(parent.children, el) + 1;
    return el.tagName.toLowerCase() + ':nth-of-type(' + idx + ')';
  }

  // Composer/send/header jaisi single-element cheezon ke liye: jitna ho sake
  // specific, lekin short selector.
  function deriveElementSelector(el, doc) {
    if (!el) return null;
    if (el.id && doc.querySelectorAll('#' + esc(el.id)).length === 1) {
      return '#' + esc(el.id);
    }
    // Useful attributes pehle try karo (contenteditable, role, data-*)
    const attrs = ['contenteditable', 'role', 'aria-label', 'data-tab', 'data-testid', 'data-icon'];
    for (const a of attrs) {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v) continue;
      const sel = el.tagName.toLowerCase() + '[' + a + '="' + v.replace(/"/g, '\\"') + '"]';
      try { if (doc.querySelectorAll(sel).length === 1) return sel; } catch (e) { /* invalid */ }
    }
    const classes = stableClasses(el);
    if (classes.length) {
      const sel = el.tagName.toLowerCase() + '.' + classes.slice(0, 2).map(esc).join('.');
      if (doc.querySelectorAll(sel).length === 1) return sel;
    }
    // Parent ke saath thoda context
    const p = el.parentElement;
    if (p) {
      const pSel = deriveElementSelector(p, doc);
      if (pSel) {
        const idx = Array.prototype.indexOf.call(p.children, el) + 1;
        const sel = pSel + ' > ' + el.tagName.toLowerCase() + ':nth-child(' + idx + ')';
        if (doc.querySelectorAll(sel).length === 1) return sel;
      }
    }
    return null; // fail-closed: reliable selector nahi bana
  }

  // Incoming/outgoing row ka class difference nikaalo: user ne ek incoming aur
  // ek outgoing row di; outgoing wali ka extra class hi outgoingClass hai.
  function deriveOutgoingClass(inRow, outRow) {
    if (!inRow || !outRow) return null;
    const inClasses = new Set(Array.from(inRow.classList || []));
    const diff = Array.from(outRow.classList || []).filter((c) => !inClasses.has(c));
    return diff[0] || null; // na mile to null -> adapter isIncoming mein fallback
  }

  global.ChatCustom = {
    isFragileClass,
    isFragileSelector,
    deriveRowSelector,
    deriveElementSelector,
    deriveOutgoingClass,
  };
})(typeof window !== 'undefined' ? window : globalThis);
