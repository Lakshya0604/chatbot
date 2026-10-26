// custom.js - CUSTOM MODE: user khud kisi bhi allowed site par chat elements
// select karta hai (picker), profile device par save hoti hai, phir engine us
// selected chat mein character replies banata hai.
//
// STATUS: EXPERIMENTAL. Har site alag hoti hai - kisi site par kaam karne ka
// promise nahi. Hashed-class sites par selectors TUT sakte hain (re-pick karna
// padega). Canvas/cross-origin iframe/shadow-DOM chats par kaam nahi karega.
// Consent gate, stop, manual-default saare engine guarantees yahan bhi same.
//
// SCOPE v1: sirf CURRENTLY OPEN conversation. Chat-list auto-open (dusri chat ka
// unread dekhna) custom mode mein NAHI hai - wo site-specific adapters ka kaam hai
// (jaise telegram.js). Engine isliye sirf open chat ko dekhta hai.

(function () {
  'use strict';
  if (!window.ChatEngine || !window.ChatCustom) return; // dependencies pehle
  const U = window.ChatCustom;
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

  // ---------- floating panel (generic sites ke liye toggle/banner ka ghar) ----------
  // Kisi random site ka chat header/footer reliable nahi, isliye engine ke
  // buttons/banners ke liye ek chhota fixed panel banate hain.
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

  // ---------- chat identity (v1: open conversation ka title / page URL) ----------
  function makeGetChatKey(profile) {
    return function getChatKey() {
      if (profile.titleSel) {
        const el = document.querySelector(profile.titleSel);
        const t = el && (el.innerText || '').trim();
        if (t) return 'web:' + origin + ':' + t.slice(0, 80);
        return null; // title select kiya tha par mila nahi -> fail closed
      }
      // Single-chat pages (URL hi chat ki pehchaan hai)
      return 'web:' + origin + location.pathname;
    };
  }

  // ---------- engine bootstrap ----------
  async function bootFromProfile() {
    if (window.__CC_CUSTOM_BOOTED__) return; // dobara inject ho to dobara engine na chale
    const profile = await getProfile();
    if (!profile || !profile.enabled) return;
    window.__CC_CUSTOM_BOOTED__ = true;
    ensurePanel();
    window.ChatEngine.createChatAssistant({
      getChatKey: makeGetChatKey(profile),
      rowsSelector: profile.rows,
      isIncoming: (row) => (profile.outgoingClass ? !row.classList.contains(profile.outgoingClass) : true),
      getText: (row) => {
        if (profile.textSel) {
          const el = row.querySelector(profile.textSel);
          return el ? el.innerText : '';
        }
        return row.innerText || '';
      },
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
    });
  }

  // ---------- picker: staged element selection ----------
  const STAGES = [
    { key: 'rows', ask: 'STEP 1/5: kisi bhi EK message bubble par click karo (sab bubbles ka pattern banega).', required: true },
    { key: 'outRow', ask: 'STEP 2/5: apni BHEJI HUI ek message par click karo (taaki aage-peeche pehchan sake). SKIP allowed.', required: false },
    { key: 'composer', ask: 'STEP 3/5: typing box par click karo.', required: true },
    { key: 'send', ask: 'STEP 4/5: send button par click karo. SKIP = sirf draft mode (auto-send kabhi nahi).', required: false },
    { key: 'title', ask: 'STEP 5/5: chat ke naam/title par click karo. SKIP = is page ki URL hi chat ki pehchaan.', required: false },
  ];

  function startPicker() {
    if (document.getElementById('cc-picker-bar')) return; // already running
    // Re-pick ke waqt purana panel bottom-right mein elements (jaise Send button)
    // ko COVER kar sakta hai - picking ke dauraan chhupa do, baad mein wapas.
    const existingPanel = document.getElementById('cc-panel');
    if (existingPanel) existingPanel.style.display = 'none';
    const bar = document.createElement('div');
    bar.id = 'cc-picker-bar';
    bar.setAttribute('style', [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
      'background:#111b21', 'color:#fff', 'padding:10px 14px', 'font:14px sans-serif',
      'display:flex', 'gap:12px', 'align-items:center', 'justify-content:space-between',
      // Bar khud clicks block nahi karti (warna top ke page elements, jaise chat
      // title, pick hi nahi ho paate); sirf uske buttons clicks lete hain.
      'pointer-events:none',
    ].join(';'));
    const label = document.createElement('span');
    const skip = document.createElement('button');
    skip.textContent = 'Skip';
    skip.style.pointerEvents = 'auto';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.pointerEvents = 'auto';
    bar.appendChild(label); bar.appendChild(skip); bar.appendChild(cancel);
    document.body.appendChild(bar);

    const picked = {};
    let idx = 0;
    let highlight = null;

    function cleanup() {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('keydown', onKey, true);
      if (highlight) highlight.remove();
      bar.remove();
      const panel = document.getElementById('cc-panel');
      if (panel) panel.style.display = '';
    }
    function finishEarly() { cleanup(); }
    function onMove(e) {
      if (highlight) highlight.remove();
      highlight = document.createElement('div');
      const r = e.target.getBoundingClientRect();
      highlight.setAttribute('style', [
        'position:fixed', 'pointer-events:none', 'z-index:2147483646',
        'border:2px solid #25d366', 'border-radius:6px',
        'left:' + (r.left - 2) + 'px', 'top:' + (r.top - 2) + 'px',
        'width:' + (r.width + 4) + 'px', 'height:' + (r.height + 4) + 'px',
      ].join(';'));
      document.body.appendChild(highlight);
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); finishEarly(); } }
    async function advance() {
      idx++;
      while (idx < STAGES.length && !STAGES[idx]) idx++;
      if (idx >= STAGES.length) return finish();
      label.textContent = STAGES[idx].ask;
      skip.style.display = STAGES[idx].required ? 'none' : '';
    }
    async function finish() {
      cleanup();
      // ---- selectors derive karo ----
      const rows = U.deriveRowSelector(picked.rows, document);
      const composer = U.deriveElementSelector(picked.composer, document);
      if (!rows || !composer) {
        window.alert('Custom mode: message bubbles ya typing box ka reliable selector nahi ban paya. Ye site abhi supported nahi (fail-closed).');
        return;
      }
      // Row selector clicked element ke ANCESTOR par bhi ban sakta hai (nested
      // markup). Role derivation ke liye dono picked elements ko actual row tak
      // resolve karo - warna inner element ki class (jaise 'bubble') outgoingClass
      // ban jaati hai jo row par hoti hi nahi, aur SAB messages incoming lagte hain.
      const inRow = picked.rows && picked.rows.closest ? (picked.rows.closest(rows) || picked.rows) : picked.rows;
      const outRow = picked.outRow && picked.outRow.closest ? (picked.outRow.closest(rows) || picked.outRow) : picked.outRow;
      const profile = {
        enabled: true,
        rows,
        textSel: null, // v1: poori row ka text (simple sites par theek)
        outgoingClass: (inRow && outRow && inRow !== outRow) ? U.deriveOutgoingClass(inRow, outRow) : null,
        composer,
        send: picked.send ? U.deriveElementSelector(picked.send, document) : null,
        titleSel: picked.title ? U.deriveElementSelector(picked.title, document) : null,
        fragile: U.isFragileSelector(rows) || U.isFragileSelector(composer),
        createdAt: new Date().toISOString(),
      };
      await saveProfile(profile);
      // Background ko bolo: is origin par future visits ke liye content script
      // permanently register kare (taaki refresh/naye visit par engine khud chale).
      try { chrome.runtime.sendMessage({ type: 'CC_REGISTER_SITE', origin }); } catch (e) {}
      window.alert(
        'Custom chat profile save ho gayi is site ke liye.\n' +
        (profile.fragile ? 'WARNING: is site ke selectors generated/fragile lagte hain - site update par dobara select karna pad sakta hai.\n' : '') +
        'Ab page refresh karo: AI panel niche-right mein dikh jayega.'
      );
    }
    function onClick(e) {
      // Picker ke apne UI par click ignore
      if (bar.contains(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      const stage = STAGES[idx];
      picked[stage.key === 'outRow' ? 'outRow' : stage.key] = e.target;
      void advance();
    }
    skip.addEventListener('click', (e) => { e.stopPropagation(); void advance(); });
    cancel.addEventListener('click', (e) => { e.stopPropagation(); finishEarly(); });
    window.addEventListener('click', onClick, true);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('keydown', onKey, true);
    label.textContent = STAGES[0].ask;
    skip.style.display = STAGES[0].required ? 'none' : '';
  }

  // ---------- messages from background/options ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;
    if (msg.type === 'CC_START_PICKER') { startPicker(); sendResponse({ ok: true }); }
    else if (msg.type === 'CC_DISABLE_SITE') {
      void clearProfile().then(() => sendResponse({ ok: true }));
      return true; // async response
    }
    else if (msg.type === 'CC_SITE_STATUS') {
      void getProfile().then((p) => sendResponse({ ok: true, profile: p ? { enabled: p.enabled, fragile: p.fragile, rows: p.rows } : null }));
      return true;
    }
    return false;
  });

  void bootFromProfile();
})();
