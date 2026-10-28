// auto.js - AUTO MODE: koi manual picker NAHI. Toolbar click (ya registered
// site par page load) par extension khud chat layout detect karti hai:
// typing box -> uske upar ka message list -> direction (attributes/labels/
// class tokens, warna left-right alignment) -> engine start.
//
// FAIL-CLOSED har jagah: layout ya direction confident na mile to kuch nahi
// chalta, saaf reason ke saath. Galat direction = apne messages par reply ka
// risk, isliye guess kabhi nahi. Direction abhi decide na ho (sirf ek side ke
// messages) to profile "pending" rehti hai aur DOM badalte hi dobara try hota
// hai - tab tak AI poori tarah band hai.
//
// STATUS: EXPERIMENTAL. Har site alag hoti hai; kisi site par kaam karne ka
// promise nahi. Consent gate, stop, manual-default saare engine guarantees same.

(function () {
  'use strict';
  if (!window.ChatEngine || !window.ChatCustom || !window.ChatAuto) return;
  const U = window.ChatCustom;
  const A = window.ChatAuto;
  const PROFILE_KEY = 'siteProfiles';
  const origin = location.origin;

  // ---------- storage (sirf is device par) ----------
  function getProfiles() {
    return new Promise((resolve) => {
      chrome.storage.local.get(PROFILE_KEY, (r) => resolve((r && r[PROFILE_KEY]) || {}));
    });
  }
  async function getProfile() {
    const map = await getProfiles();
    return map[origin] || null;
  }
  async function saveProfile(profile) {
    const map = await getProfiles();
    map[origin] = profile;
    return new Promise((resolve) => chrome.storage.local.set({ [PROFILE_KEY]: map }, resolve));
  }
  async function clearProfile() {
    const map = await getProfiles();
    delete map[origin];
    return new Promise((resolve) => chrome.storage.local.set({ [PROFILE_KEY]: map }, resolve));
  }

  // ---------- floating panel (engine ke buttons/banners ka ghar) ----------
  function ensurePanel() {
    let panel = document.getElementById('cc-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'cc-panel';
    panel.setAttribute('style', [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
      'background:#1f2c33', 'color:#fff', 'border-radius:10px', 'padding:8px',
      'font:13px sans-serif', 'box-shadow:0 2px 10px rgba(0,0,0,.4)', 'max-width:320px',
    ].join(';'));
    const head = document.createElement('div');
    head.className = 'cc-panel-header';
    head.setAttribute('style', 'display:flex;gap:6px;flex-wrap:wrap;');
    const foot = document.createElement('div');
    foot.className = 'cc-panel-footer';
    panel.appendChild(head);
    panel.appendChild(foot);
    document.body.appendChild(panel);
    return panel;
  }
  function panelNote(text) {
    ensurePanel();
    const foot = document.querySelector('#cc-panel .cc-panel-footer');
    if (foot) foot.textContent = text;
  }

  // ---------- chat title (identity) ----------
  // Sirf page ke LIVE header/heading se title. document.title fallback JAAN-BOOJH
  // kar nahi: wo static hota hai, chat switch par nahi badalta - aur runtime
  // re-query (makeGetChatKey) use dhoondh nahi paati (mismatch = fail-closed boot).
  // Live header na mile to null -> single-chat page ki URL hi identity hai.
  function findChatTitle(listContainer) {
    let node = listContainer;
    for (let d = 0; d <= 6 && node && node !== document.body; d++, node = node.parentElement) {
      const head = node.querySelector && node.querySelector('header, h1, h2, h3, h4, [role="heading"]');
      if (head) {
        const t = A.textOf(head).split('\n').map((s) => s.trim()).find(Boolean) || '';
        if (t && t.length <= 80) return t;
      }
    }
    return null;
  }

  // ---------- send button (composer ke aas-paas) ----------
  const SEND_HINT = /send|bhejo|भेज/i;
  function findSendButton(composer) {
    const scopes = [];
    const form = composer.closest && composer.closest('form');
    if (form) scopes.push(form);
    if (composer.parentElement) scopes.push(composer.parentElement);
    if (composer.parentElement && composer.parentElement.parentElement) scopes.push(composer.parentElement.parentElement);
    for (const sc of scopes) {
      const btns = Array.from(sc.querySelectorAll('button, [role="button"], input[type="submit"]'));
      const hit = btns.find((b) => {
        const label = [b.getAttribute && b.getAttribute('aria-label'), b.getAttribute && b.getAttribute('title'), A.textOf(b), b.getAttribute && b.getAttribute('data-icon')]
          .filter(Boolean).join(' ');
        return SEND_HINT.test(label);
      });
      if (hit) return hit;
    }
    return null;
  }

  // ---------- direction: marker ya alignment ----------
  function resolveDirection(rows, container) {
    const marker = A.detectDirectionMarker(rows);
    if (marker) {
      if (marker.kind === 'innerAttr') return { outgoingInnerAttr: { name: marker.name, value: marker.outgoingValue }, fragile: false };
      if (marker.kind === 'attr') return { outgoingAttr: { name: marker.name, value: marker.outgoingValue }, fragile: false };
      if (marker.kind === 'prefix') return { outgoingPrefix: marker.prefix, fragile: false };
      if (marker.kind === 'classToken') return { outgoingClass: marker.cls, fragile: U.isFragileClass(marker.cls) };
    }
    const align = A.detectDirectionByAlignment(rows, container);
    if (align) return { outgoingAlign: align.outgoing, fragile: true }; // alignment heuristic: fragile
    return null;
  }

  // ---------- profile build ----------
  function detectProfile() {
    const composer = A.findComposer(document);
    if (!composer) return { error: 'typing box nahi mila (ye page chat jaisa nahi lagta)' };
    const list = A.findMessageList(document, composer);
    if (!list || !list.rows.length) return { error: 'message list nahi mili (kam se kam 3 messages dikhni chahiye)' };
    const rowsSel = U.deriveRowSelector(list.rows[0], document);
    if (!rowsSel) return { error: 'messages ka stable pattern nahi ban paya' };
    let matched;
    try { matched = Array.from(document.querySelectorAll(rowsSel)); } catch (e) { return { error: 'messages ka pattern invalid raha' }; }
    const inContainer = matched.filter((m) => m.parentElement === list.container);
    if (inContainer.length < Math.min(2, list.rows.length)) {
      const cname = (list.container.tagName || '') + '.' + String(list.container.className || '').trim().split(/\s+/).join('.');
      return { error: 'message pattern list ke bahar fail ho gaya (fail-closed): sel=' + rowsSel + ' matched=' + matched.length + ' inContainer=' + inContainer.length + ' rows=' + list.rows.length + ' container=' + cname };
    }
    const compSel = U.deriveElementSelector(composer, document);
    if (!compSel) return { error: 'typing box ka reliable selector nahi ban paya' };
    const sendBtn = findSendButton(composer);
    const title = findChatTitle(list.container);
    const dir = resolveDirection(inContainer, list.container);
    const profile = {
      enabled: true,
      mode: 'auto',
      rows: rowsSel,
      textSel: null,
      composer: compSel,
      send: sendBtn ? U.deriveElementSelector(sendBtn, document) : null,
      titleText: title || null,
      fragile: U.isFragileSelector(rowsSel) || (dir ? !!dir.fragile : false),
      createdAt: new Date().toISOString(),
    };
    if (dir) Object.assign(profile, dir);
    else profile.directionPending = true; // abhi ek hi side dikhi - baad mein lock hoga
    return { profile, matchedCount: inContainer.length };
  }

  // ---------- VISION GATE (optional: sirf jab visionConfig set ho) ----------
  // Visible chat-list area ka screenshot (crop) -> vision transcript -> DOM ke
  // last incoming se match. Direction vision se KABHI decide nahi hoti (model ke
  // left/right labels unreliable nikle) - sirf "ye sach mein last message hai" check.
  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('screenshot decode fail'));
      img.src = dataUrl;
    });
  }
  function sendMsg(msg) {
    return new Promise((resolve) => {
      try { chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'no response' })); }
      catch (e) { resolve({ ok: false, error: String(e) }); }
    });
  }
  function makeVisionVerify(profile) {
    return async function visionVerify(domLastText) {
      const cfg = await new Promise((r) => chrome.storage.local.get('visionConfig', (x) => r(x && x.visionConfig)));
      console.log('CC_VISION gate start, cfg=' + (cfg ? cfg.provider : 'none'));
      if (!cfg) return { ok: true, skipped: true };
      let rows;
      try { rows = Array.from(document.querySelectorAll(profile.rows)); } catch (e) { return { ok: false, reason: 'rows selector invalid' }; }
      if (!rows.length) return { ok: false, reason: 'chat rows nahi mili' };
      try { rows[rows.length - 1].scrollIntoView({ block: 'nearest' }); } catch (e) {}
      await new Promise((r) => setTimeout(r, 400));
      const vw = window.innerWidth, vh = window.innerHeight;
      let L = vw, T = vh, R = 0, B = 0;
      for (const row of rows) {
        const b = row.getBoundingClientRect();
        if (b.width < 2 || b.height < 2 || b.bottom < 0 || b.top > vh) continue;
        L = Math.min(L, Math.max(0, b.left)); T = Math.min(T, Math.max(0, b.top));
        R = Math.max(R, Math.min(vw, b.right)); B = Math.max(B, Math.min(vh, b.bottom));
      }
      if (R - L < 20 || B - T < 20) return { ok: false, reason: 'chat area screen par visible nahi' };
      const pad = 8; L = Math.max(0, L - pad); T = Math.max(0, T - pad); R = Math.min(vw, R + pad); B = Math.min(vh, B + pad);
      const cap = await sendMsg({ type: 'CC_CAPTURE_TAB' });
      if (!cap || !cap.ok) return { ok: false, reason: 'screenshot nahi ban paya: ' + ((cap && cap.error) || 'unknown') };
      const img = await loadImage(cap.data.dataUrl);
      const sx = img.naturalWidth / vw, sy = img.naturalHeight / vh;
      const cw = Math.round((R - L) * sx), ch = Math.round((B - T) * sy);
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(cw, 1400); canvas.height = Math.round(ch * canvas.width / cw);
      canvas.getContext('2d').drawImage(img, Math.round(L * sx), Math.round(T * sy), cw, ch, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      const res = await sendMsg({ type: 'INTERPRET_CHAT_IMAGE', payload: { imageBase64: base64, mimeType: 'image/jpeg', mode: 'transcript', domLastText } });
      if (!res || !res.ok) return { ok: false, reason: 'vision: ' + ((res && res.error) || 'unknown') };
      console.log('CC_VISION verify=' + JSON.stringify(res.data.verify));
      return res.data.verify || { ok: false, reason: 'verify result missing' };
    };
  }

  // ---------- engine wiring ----------
  function makeGetChatKey(profile) {
    return function getChatKey() {
      if (profile.titleText) {
        // Title text ko live dhoondo: SPA mein chat switch par naya title = nayi chat.
        const heads = document.querySelectorAll('header, h1, h2, h3, h4, [role="heading"]');
        for (const h of heads) {
          const t = A.textOf(h).split('\n').map((s) => s.trim()).find(Boolean) || '';
          if (t && t.length <= 80) return 'web:' + origin + ':' + t.slice(0, 80);
        }
        return null; // title tha par ab nahi mila -> fail closed
      }
      return 'web:' + origin + location.pathname;
    };
  }

  function makeIsIncoming(profile) {
    return function isIncoming(row) {
      if (profile.directionPending) return false; // direction lock hone tak koi incoming nahi
      if (profile.outgoingAlign) {
        const container = row.parentElement;
        if (!container) return false;
        return A.isIncomingByAlign(row, container, profile.outgoingAlign);
      }
      // marker-based: outgoing nahi = incoming (engine ke purane semantics)
      return !U.isOutgoingRow(row, profile);
    };
  }

  function startEngine(profile) {
    if (window.__CC_AUTO_ENGINE__) return;
    window.__CC_AUTO_ENGINE__ = true;
    ensurePanel();
    window.ChatEngine.createChatAssistant({
      getChatKey: makeGetChatKey(profile),
      rowsSelector: profile.rows,
      isIncoming: makeIsIncoming(profile),
      getText: (row) => U.rowText(row, profile),
      composerSelector: profile.composer,
      sendSelector: profile.send || null,
      headerSelector: '#cc-panel .cc-panel-header',
      footerSelector: '#cc-panel .cc-panel-footer',
      rootSelector: 'body',
      consentMessage:
        'Is chat ke messages AI provider ko process karne hain?\n\n' +
        'Pehle saamne wale se EXPLICIT permission lo. Uske haan ke bina AI is chat mein kuch nahi karega. ' +
        'Woh kabhi bhi "stop" kahe to chat turant aur permanently band ho jayegi (fresh consent ke bina wapas nahi).',
      consentRequestText:
        'Heads up: main is chat mein AI-drafted replies use kar raha/rahi hoon - tumhare messages ek AI provider ko process honge. ' +
        'Theek hai? Kabhi bhi "stop" likhoge to turant band.',
      aiMarker: '',
      visionVerify: makeVisionVerify(profile),
    });
  }

  // Direction pending: DOM mutation par dobara lock try karo; lock hote hi engine.
  let dirWatcher = null;
  function watchDirection(profile) {
    if (dirWatcher) return;
    panelNote('Auto setup: direction (kaun si message tumhari hai) abhi clear nahi - chat mein dono sides ke messages dikhne par khud set ho jayega.');
    dirWatcher = new MutationObserver(async () => {
      const latest = await getProfile();
      if (!latest || !latest.directionPending) { if (dirWatcher) { dirWatcher.disconnect(); dirWatcher = null; } return; }
      let rows;
      try { rows = Array.from(document.querySelectorAll(latest.rows)); } catch (e) { return; }
      if (rows.length < 2) return;
      const container = rows[0].parentElement;
      if (!container) return;
      const dir = resolveDirection(rows, container);
      if (!dir) return;
      dirWatcher.disconnect(); dirWatcher = null;
      const updated = Object.assign({}, latest, dir);
      delete updated.directionPending;
      await saveProfile(updated);
      panelNote('Auto setup complete. AI panel se chat on karo.');
      startEngine(updated);
    });
    dirWatcher.observe(document.body, { childList: true, subtree: true, attributes: true });
  }

  // ---------- boot ----------
  async function bootFromProfile() {
    if (window.__CC_AUTO_BOOTED__) return;
    const profile = await getProfile();
    if (!profile || !profile.enabled || profile.mode !== 'auto') return;
    window.__CC_AUTO_BOOTED__ = true;
    if (profile.directionPending) { ensurePanel(); watchDirection(profile); return; }
    startEngine(profile);
  }

  async function runAutoDetect(opts) {
    const res = detectProfile();
    if (res.error) {
      if (opts && opts.loud) window.alert('Auto setup fail: ' + res.error + '.\n\nAI band rakha gaya (fail-closed).');
      else panelNote('Auto setup abhi possible nahi: ' + res.error);
      return res;
    }
    await saveProfile(res.profile);
    try { chrome.runtime.sendMessage({ type: 'CC_REGISTER_SITE', origin }); } catch (e) {}
    if (res.profile.directionPending) {
      ensurePanel();
      watchDirection(res.profile);
      if (opts && opts.loud) {
        window.alert('Auto setup: chat mil gayi, par abhi sirf ek side ke messages dikh rahe hain. Dono sides dikhte hi setup khud complete ho jayega - kuch select karne ki zaroorat nahi.');
      }
      return res;
    }
    startEngine(res.profile);
    if (opts && opts.loud) {
      window.alert(
        'Auto setup complete ho gaya is site ke liye' +
        (res.profile.fragile ? ' (NOTE: selectors fragile lagte hain - site update par dobara toolbar click karna pad sakta hai)' : '') +
        '.\n\nAb niche-right AI panel se chat on karo (consent ke 2 steps), phir naye incoming par draft/auto-reply chalega.'
      );
    }
    return res;
  }

  // ---------- messages ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;
    if (msg.type === 'CC_AUTO_START') { void runAutoDetect({ loud: true }); sendResponse({ ok: true }); }
    else if (msg.type === 'CC_DISABLE_SITE') {
      void clearProfile().then(() => sendResponse({ ok: true }));
      return true;
    }
    else if (msg.type === 'CC_SITE_STATUS') {
      void getProfile().then((p) => sendResponse({ ok: true, profile: p ? { enabled: p.enabled, mode: p.mode, fragile: p.fragile, rows: p.rows } : null }));
      return true;
    }
    return false;
  });

  void bootFromProfile();
})();
