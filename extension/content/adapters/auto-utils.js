// auto-utils.js - AUTO mode ke pure detection helpers. KOI MANUAL PICKER NAHI.
// Kisi specific website ka knowledge nahi - generic chat-layout signals se
// message list, typing box, send button aur direction (kaun si message meri hai)
// ka pata lagate hain. Har step FAIL-CLOSED: confident signal na mile to null,
// kabhi guess nahi (galat direction = apne hi messages par reply/loop).
//
// Layout-dependent logic (alignment) ko measure() inject kiya ja sakta hai,
// taaki jsdom tests (jahan layout nahi hota) bhi deterministic chalein.
(function (global) {
  'use strict';

  const COMPOSER_SEL = 'textarea, input[type="text"], [contenteditable="true"], [contenteditable=""], [role="textbox"]';

  function textOf(el) {
    if (!el) return '';
    const t = el.innerText;
    return String(t !== undefined ? t : (el.textContent || ''));
  }

  function defaultMeasure(el) {
    if (!el || !el.getBoundingClientRect) return { left: 0, width: 0, top: 0, height: 0 };
    const r = el.getBoundingClientRect();
    return { left: r.left, width: r.width, top: r.top, height: r.height };
  }

  function isVisible(el, measure) {
    if (!el) return false;
    const r = measure(el);
    if (r.width <= 0 || r.height <= 0) return false;
    let n = el;
    while (n && n.nodeType === 1) {
      const s = n.style || {};
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      n = n.parentElement;
    }
    return true;
  }

  // Typing box: visible editable elements; sabse neeche wala (chat composer
  // page ke bottom ke sabse kareeb hota hai). Kuch na mile to null.
  function findComposer(doc, measure) {
    measure = measure || defaultMeasure;
    const els = Array.from(doc.querySelectorAll(COMPOSER_SEL))
      .filter((el) => isVisible(el, measure));
    if (!els.length) return null;
    els.sort((a, b) => {
      const ra = measure(a), rb = measure(b);
      return (rb.top + rb.height) - (ra.top + ra.height); // sabse neeche pehle
    });
    return els[0];
  }

  // Message rows kabhi interactive controls nahi hote. Nav tabs / buttons /
  // links bhi "uniform siblings" hote hain (Orbix bug: navbar ke 7 tab buttons
  // message list ban gaye the) - unhe row set se hard-reject karo.
  const NON_MESSAGE_TAGS = new Set(['BUTTON', 'A', 'SELECT', 'OPTION', 'INPUT', 'LABEL']);
  const NON_MESSAGE_ROLES = new Set(['tab', 'button', 'link', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'switch', 'checkbox', 'radio']);
  function isControlRow(el) {
    if (NON_MESSAGE_TAGS.has(el.tagName)) return true;
    const role = (el.getAttribute && el.getAttribute('role')) || '';
    return NON_MESSAGE_ROLES.has(role);
  }
  function inNavLike(container) {
    return !!(container.closest && container.closest('nav, [role="navigation"], [role="tablist"], [role="menubar"], [role="toolbar"], header, [role="banner"]'));
  }

  // Ek container ke "row-like" bachche: text wale direct children jinki count
  // kam se kam minRows ho aur aadhe se zyada ka tag same ho.
  function rowLikeChildren(container, minRows) {
    const kids = Array.from(container.children || []).filter((c) =>
      textOf(c).trim().length > 0);
    if (kids.length < minRows) return null;
    // Aadhe se zyada bachche controls hain to ye message list nahi (nav/toolbar hai).
    const controlCount = kids.filter(isControlRow).length;
    if (controlCount * 2 > kids.length) return null;
    const tags = {};
    kids.forEach((c) => { tags[c.tagName] = (tags[c.tagName] || 0) + 1; });
    const top = Object.keys(tags).sort((a, b) => tags[b] - tags[a])[0];
    if (tags[top] < Math.ceil(kids.length / 2)) return null;
    if (NON_MESSAGE_TAGS.has(top)) return null;
    return kids.filter((c) => c.tagName === top);
  }

  // Message list ka container: composer ke aas-paas ke ancestors ke ANDAR aisa
  // element jiske kam se kam 3 row-like bachche hon. Composer se door (sidebar
  // conversation list) wale containers ko score kam milta hai - chat list aur
  // message list mein confusion ka sabse bada risk yahi hai.
  // Return: { container, rows } ya null.
  function findMessageList(doc, composer, measure, opts) {
    measure = measure || defaultMeasure;
    const minRows = (opts && opts.minRows) || 3;
    if (!composer) return null;
    const compRect = measure(composer);
    let best = null;
    let bestScore = -1;
    let node = composer.parentElement;
    for (let depth = 0; depth <= 8 && node && node !== doc.body; depth++, node = node.parentElement) {
      const cands = [node].concat(Array.from(node.querySelectorAll('div, ol, ul, section, main') || []));
      for (const c of cands) {
        const rows = rowLikeChildren(c, minRows);
        if (!rows) continue;
        // Composer khud list ke andar na ho (composer message row nahi hai).
        if (c.contains(composer)) {
          // container composer ka ancestor hai - theek hai, par rows mein composer wali branch na aaye
          if (rows.some((r) => r.contains(composer))) continue;
        }
        if (inNavLike(c)) continue; // nav/tablist/toolbar/header kabhi message list nahi
        const rc = measure(c);
        if (rc.width <= 0 || rc.height <= 0) continue;
        // Vertical distance: list composer ke UPAR honi chahiye (ya usi area mein).
        const gap = compRect.top - (rc.top + rc.height);
        if (gap < -compRect.height * 2) continue; // list poori tarah composer ke neeche - chat list nahi
        const scrollable = /(auto|scroll)/.test((c.style && c.style.overflowY) || '') ? 1 : 0;
        // Message-like rows lambi text rakhti hain; chhote labels (tabs/menu) nahi.
        const avgLen = rows.reduce((a, r) => a + textOf(r).trim().length, 0) / rows.length;
        const texty = avgLen >= 20 ? 6 : (avgLen >= 8 ? 2 : 0);
        const score = rows.length * 2 + scrollable * 4 + texty - Math.max(0, gap) / 200 - depth * 0.5;
        if (score > bestScore) { bestScore = score; best = { container: c, rows }; }
      }
    }
    return best;
  }

  // Row ka "bubble": row ke andar ka sabse bada text block jo row se kaafi
  // patla ho (alignment usi se dikhti hai); na mile to row khud.
  function bubbleOf(row, measure) {
    measure = measure || defaultMeasure;
    const rr = measure(row);
    let best = row;
    let bestLen = textOf(row).trim().length;
    const stack = Array.from(row.children || []);
    while (stack.length) {
      const el = stack.shift();
      const len = textOf(el).trim().length;
      if (!len) continue;
      const r = measure(el);
      if (r.width > 0 && r.width <= rr.width * 0.92 && len >= bestLen * 0.5) {
        best = el; bestLen = len;
      }
      stack.push.apply(stack, Array.from(el.children || []));
    }
    return best;
  }

  const OUT_TOKEN = /(^|[-_])(out|outgoing|sent|mine|from-me|fromme|own|self|right)([-_]|$)/i;
  const IN_TOKEN = /(^|[-_])(in|incoming|received|from-them|fromthem|left)([-_]|$)/i;
  const DIR_ATTR = /role|author|direction|from|sender|type|side|owner|mine|out|incoming|outgoing/i;
  const SKIP_ATTR = new Set(['class', 'style', 'id', 'tabindex', 'aria-posinset', 'data-index', 'data-id', 'key']);

  function firstLine(el) {
    return textOf(el).split('\n').map((s) => s.trim()).find(Boolean) || '';
  }

  // Signal 1: attributes / labels / class tokens se direction.
  // Return: { kind: 'innerAttr'|'attr'|'prefix'|'classToken', name?, value?, prefix?, cls? } ya null.
  function detectDirectionMarker(rows) {
    if (!rows || rows.length < 2) return null;
    // (a) inner descendant attribute (ChatGPT: data-message-author-role inner div par)
    const withRole = rows
      .map((r) => r.querySelector && r.querySelector('[data-message-author-role]'))
      .filter(Boolean);
    if (withRole.length >= 2) {
      const vals = new Set(withRole.map((el) => el.getAttribute('data-message-author-role')));
      if (vals.size >= 2 && (vals.has('user') || vals.has('assistant'))) {
        return { kind: 'innerAttr', name: 'data-message-author-role', outgoingValue: 'user' };
      }
    }
    // (b) row-level attribute diff (do alag rows par same attr ke alag values)
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        const names = new Set([...(a.getAttributeNames ? a.getAttributeNames() : []), ...(b.getAttributeNames ? b.getAttributeNames() : [])]);
        for (const n of names) {
          if (SKIP_ATTR.has(n) || !DIR_ATTR.test(n)) continue;
          const va = a.getAttribute(n), vb = b.getAttribute(n);
          if (va && vb && va !== vb) {
            if (OUT_TOKEN.test(va)) return { kind: 'attr', name: n, outgoingValue: va };
            if (OUT_TOKEN.test(vb)) return { kind: 'attr', name: n, outgoingValue: vb };
          }
        }
      }
    }
    // (c) "You said:" style pehli-line labels
    const labels = rows.map(firstLine).filter((s) => s.length > 0 && s.length <= 30 && /:$/.test(s));
    const uniq = new Set(labels);
    if (uniq.size >= 2) {
      for (const l of uniq) {
        if (/^(you|tum|aap|main|me)\b.*:$/i.test(l)) return { kind: 'prefix', prefix: l };
      }
      // Koi bhi do alag labels ho to pehla wala outgoing maan na = guess. NAHI karenge.
    }
    // (d) class tokens: kisi subset par out-token, baaki par nahi/in-token
    const hasOut = [], hasIn = [];
    rows.forEach((r) => {
      const cls = Array.from(r.classList || []).join(' ');
      if (OUT_TOKEN.test(cls)) hasOut.push(r);
      else if (IN_TOKEN.test(cls)) hasIn.push(r);
    });
    if (hasOut.length && (hasIn.length || hasOut.length < rows.length)) {
      const outRow = hasOut[0];
      const outCls = Array.from(outRow.classList || []).find((c) => OUT_TOKEN.test(c));
      if (outCls) return { kind: 'classToken', cls: outCls };
    }
    return null;
  }

  // Signal 2: alignment clustering (LTR chats mein apni messages RIGHT side).
  // rows ko LEFT/RIGHT/ambiguous mein baanto; dono sides mein kam se kam
  // minEach hon aur confusable rows zyada na hon.
  // Return: { outgoing: 'right'|'left', counts } ya null.
  function detectDirectionByAlignment(rows, listContainer, measure, opts) {
    measure = measure || defaultMeasure;
    const minEach = (opts && opts.minEach) || 1;
    const lr = measure(listContainer);
    if (lr.width <= 0) return null;
    const center = lr.left + lr.width / 2;
    let right = 0, left = 0, ambi = 0;
    rows.forEach((row) => {
      const b = bubbleOf(row, measure);
      const rb = measure(b);
      if (rb.width <= 0) { ambi++; return; }
      const off = (rb.left + rb.width / 2 - center) / lr.width;
      if (off > 0.08) right++;
      else if (off < -0.08) left++;
      else ambi++;
    });
    if (right >= minEach && left >= minEach && right + left >= (opts && opts.minTotal || 2)) {
      // Convention heuristic (WhatsApp/Telegram/iMessage/Messenger/ChatGPT sab
      // LTR mein apni messages RIGHT dikhate hain). Majority se direction decide
      // KABHI nahi - kisi bhi side ke zyada messages ho sakte hain. Ye heuristic
      // galat nikli to runtime self-echo guard pehli reply par chat band kar
      // deta hai (fail-closed net).
      return { outgoing: 'right', counts: { right, left, ambi } };
    }
    return null;
  }

  // Live runtime direction check: alignment profile ke hisaab se ye row outgoing hai?
  // Ambiguous (center) rows ke liye FALSE (fail-closed: unknown = incoming nahi).
  function isOutgoingByAlign(row, listContainer, outgoingSide, measure) {
    measure = measure || defaultMeasure;
    const lr = measure(listContainer);
    if (lr.width <= 0) return false;
    const b = bubbleOf(row, measure);
    const rb = measure(b);
    if (rb.width <= 0) return false;
    const off = (rb.left + rb.width / 2 - (lr.left + lr.width / 2)) / lr.width;
    if (outgoingSide === 'right') return off > 0.08;
    return off < -0.08;
  }


  // Live runtime: alignment profile ke hisaab se ye row CLEARLY incoming hai?
  // Measurement invalid/ambiguous -> FALSE (fail-closed: trigger kabhi guess par nahi).
  function isIncomingByAlign(row, listContainer, outgoingSide, measure) {
    measure = measure || defaultMeasure;
    const lr = measure(listContainer);
    if (lr.width <= 0) return false;
    const b = bubbleOf(row, measure);
    const rb = measure(b);
    if (rb.width <= 0) return false;
    const off = (rb.left + rb.width / 2 - (lr.left + lr.width / 2)) / lr.width;
    if (outgoingSide === 'right') return off < -0.08;
    return off > 0.08;
  }

  global.ChatAuto = {
    findComposer,
    findMessageList,
    rowLikeChildren,
    bubbleOf,
    detectDirectionMarker,
    detectDirectionByAlignment,
    isOutgoingByAlign,
    isIncomingByAlign,
    isVisible,
    defaultMeasure,
    textOf,
    OUT_TOKEN,
    IN_TOKEN,
  };
})(typeof window !== 'undefined' ? window : globalThis);
