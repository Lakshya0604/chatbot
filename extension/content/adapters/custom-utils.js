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

  // Attribute selector; value mein per-chat id (uuid / digits wala token) ho to sirf stable PREFIX
  // par ^= use karo (ChatGPT: aria-label="Conversation chat-<uuid>"). Prefix na bane to null.
  function attrSel(tag, a, v) {
    const toks = String(v).split(/\s+/);
    const idLike = (t) => /[0-9a-f]{8}-[0-9a-f]{4}/i.test(t) || (t.match(/[0-9]/g) || []).length >= 4;
    const i = toks.findIndex(idLike);
    const q = (s) => s.replace(/"/g, '\\"');
    if (i < 0) return a === 'aria-label' && String(v).length >= 8 ? tag + '[' + a + '^="' + q(v) + '"]' : tag + '[' + a + '="' + q(v) + '"]'; // aria-label prefix: site baad mein id jod sakti hai
    const prefix = toks.slice(0, i).join(' ');
    if (prefix.length < 4) return null;
    return tag + '[' + a + '^="' + q(prefix) + '"]';
  }

  const ROW_ATTRS = ['data-message-author-role', 'data-testid', 'aria-label', 'role', 'data-type', 'data-direction'];

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
    for (let depth = 0; depth <= 14 && node && node !== doc.body && node.nodeType === 1; depth++) {
      const classes = stableClasses(node);
      const cands = [];
      for (let n = 1; n <= Math.min(classes.length, 3); n++) {
        cands.push(node.tagName.toLowerCase() + '.' + classes.slice(0, n).map(esc).join('.'));
      }
      // Stable attribute hooks (aria-label / data-testid / role ...) - hashed-class sites par
      // yahi bachte hain. Value ko hi stable maante hain agar fragile-looking na ho.
      ROW_ATTRS.forEach((a) => {
        const v = node.getAttribute && node.getAttribute(a);
        if (v && v.length <= 80) { const s = attrSel(node.tagName.toLowerCase(), a, v); if (s) cands.push(s); }
      });
      // Parent ke stable hook ke andar ke direct children: 'ol[aria-label="Conversation"] > li'
      const par = node.parentElement;
      if (par && par !== doc.body) {
        const pSel = deriveElementSelector(par, doc);
        if (pSel && !isFragileSelector(pSel) && !/:nth-child/.test(pSel)) cands.push(pSel + ' > ' + node.tagName.toLowerCase());
      }
      for (const sel of cands) {
        const tier = /^[a-z0-9]+\./.test(sel) ? 0 : 1; // attribute/parent hook > class
        let els;
        try { els = doc.querySelectorAll(sel); } catch (e) { continue; }
        if (!els.length) continue;
        if (isFragileSelector(sel.replace(/\^?="[^"]*"\]/g, ']'))) continue;
        const parents = new Set();
        els.forEach((m) => parents.add(m.parentElement));
        // Row pattern ka signal: EK container ke kitne siblings (parents kam,
        // count zyada). Barabar ho to OUTER (gehri) row prefer - inner repeated
        // content (markdown blocks) rows nahi hota.
        const key = [-parents.size, els.length, tier, depth];
        let better = !bestKey;
        if (bestKey) for (let i = 0; i < 4; i++) { if (key[i] !== bestKey[i]) { better = key[i] > bestKey[i]; break; } }
        if (better) { best = sel; bestKey = key; }
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
    const attrs = ['contenteditable', 'role', 'aria-label', 'name', 'data-tab', 'data-testid', 'data-icon'];
    for (const a of attrs) {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v) continue;
      const sel = attrSel(el.tagName.toLowerCase(), a, v);
      if (!sel) continue;
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

  // Direction marker: class diff (existing) ya attribute diff ya "You said:"-type pehli line.
  // Kuch na mile to null -> caller fail-closed (profile save nahi hota).
  const DIR_ATTR = /role|author|direction|from|sender|type|side|owner|mine|out|incoming|outgoing/i;
  const SKIP_ATTR = new Set(['class', 'style', 'id', 'tabindex', 'aria-posinset', 'data-index', 'data-id', 'key']);
  function firstLine(row) {
    return String((row && row.innerText) || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  }
  function deriveDirection(inRow, outRow) {
    if (!inRow || !outRow || inRow === outRow) return null;
    const cls = deriveOutgoingClass(inRow, outRow);
    const stableCls = cls && !isFragileClass(cls) ? cls : null;
    if (stableCls) return { outgoingClass: stableCls };
    // attribute difference
    const names = new Set([...(inRow.getAttributeNames ? inRow.getAttributeNames() : []), ...(outRow.getAttributeNames ? outRow.getAttributeNames() : [])]);
    for (const n of names) {
      if (SKIP_ATTR.has(n) || !DIR_ATTR.test(n)) continue;
      const a = inRow.getAttribute(n), b = outRow.getAttribute(n);
      if (b && a !== b) return { outgoingAttr: { name: n, value: b } };
    }
    // role marker on a descendant (data-message-author-role on inner div)
    const innerIn = inRow.querySelector && inRow.querySelector('[data-message-author-role]');
    const innerOut = outRow.querySelector && outRow.querySelector('[data-message-author-role]');
    if (innerIn && innerOut) {
      const a = innerIn.getAttribute('data-message-author-role'), b = innerOut.getAttribute('data-message-author-role');
      if (a !== b) return { outgoingInnerAttr: { name: 'data-message-author-role', value: b } };
    }
    // "You said:" / "ChatGPT said:" style labels (must look like a label ending with ':')
    const fi = firstLine(inRow), fo = firstLine(outRow);
    const looksLabel = (s) => s.length > 0 && s.length <= 30 && /:$/.test(s);
    if (looksLabel(fo) && looksLabel(fi) && fo !== fi) return { outgoingPrefix: fo };
    // hashed class diff is better than nothing only when user chose it explicitly; still fragile
    if (cls) return { outgoingClass: cls, fragileDirection: true };
    return null;
  }
  function isOutgoingRow(row, profile) {
    if (!row || !profile) return false;
    if (profile.outgoingClass && row.classList.contains(profile.outgoingClass)) return true;
    if (profile.outgoingAttr && row.getAttribute(profile.outgoingAttr.name) === profile.outgoingAttr.value) return true;
    if (profile.outgoingInnerAttr) {
      const el = row.querySelector('[' + profile.outgoingInnerAttr.name + ']');
      if (el && el.getAttribute(profile.outgoingInnerAttr.name) === profile.outgoingInnerAttr.value) return true;
    }
    if (profile.outgoingPrefix && firstLine(row) === profile.outgoingPrefix) return true;
    return false;
  }
  function rowText(row, profile) {
    let t = String((row && row.innerText) || '');
    const fl = firstLine(row);
    if (profile && fl && (fl === profile.outgoingPrefix || /(said|says|wrote):$/i.test(fl))) {
      t = t.replace(fl, '').trim();
    }
    return t;
  }

  global.ChatCustom = {
    deriveDirection,
    isOutgoingRow,
    rowText,
    isFragileClass,
    isFragileSelector,
    deriveRowSelector,
    deriveElementSelector,
    deriveOutgoingClass,
  };
})(typeof window !== 'undefined' ? window : globalThis);
