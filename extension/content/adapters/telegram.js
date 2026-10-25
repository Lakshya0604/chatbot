// telegram.js - Telegram Web adapter (engine ko selectors/identity deta hai).
//
// STATUS: LIVE TELEGRAM PAR VERIFY NAHI HUA. Selectors public DOM structure ke
// best-known description par hain; Telegram kabhi bhi inhe badal sakta hai.
// Fail-closed design: selector/identity na mile to feature us chat mein chalti
// hi nahi (galat jagah likhna/send karna possible nahi). Dummy mock page par
// end-to-end tested (extension/test/e2e/) - ye mock DOM ka proof hai, live
// Telegram compatibility ka nahi.
//
// Do versions: "K" (web.telegram.org/k/) aur "A" (web.telegram.org/a/).
// Dono ke selectors alag; jo version khula ho usi ka config lagta hai.
//
// READ-RECEIPT CAVEAT: screen par na khuli consent-active chat ka naya message
// padhne ke liye adapter woh chat automatically kholta hai. Telegram isse
// "read" mark kar sakta hai (saamne wale ko blue ticks dikh sakte hain).
// Ye sirf CONSENT-ACTIVE chats par hota hai, kisi aur chat par kabhi nahi.

(function () {
  'use strict';
  if (!window.ChatEngine) return; // engine pehle load hona chahiye

  // ---------- version detect ----------
  const path = location.pathname;
  const VERSION = path.startsWith('/a') ? 'A' : 'K'; // default K (root / bhi K hota hai)

  // ---------- selectors (BEST-KNOWN, live unverified) ----------
  const SELECTORS = {
    K: {
      rows: '.bubble',
      outgoingClass: 'is-out',
      textSel: '.message',
      composer: '.input-message-input[contenteditable="true"]',
      send: '.btn-send',
      header: '.topbar .chat-info',
      footer: '.middle-column-footer',
      root: '#page-chats',
      listRoot: '.chatlist',
      listRow: 'a.chatlist-chat',
      unreadBadge: '.unread',
    },
    A: {
      rows: '.Message',
      outgoingClass: 'own',
      textSel: '.text-content',
      composer: '#editable-message-text[contenteditable="true"]',
      send: 'button[aria-label="Send Message"]',
      header: '.ChatInfo',
      footer: '.middle-column-footer',
      root: '#root',
      listRoot: '.chat-list',
      listRow: '.ListItem.chat-item',
      unreadBadge: '.unread',
    },
  }[VERSION];

  // ---------- chat identity ----------
  // Telegram Web dono versions mein open chat ka peer id URL hash mein hota hai
  // (e.g. #123456789). Hash na mile to fail closed (null).
  function currentChatId() {
    const m = location.hash.match(/^#(-?\d+)/);
    return m ? 'tg:' + m[1] : null;
  }

  function getChatKey() {
    return currentChatId();
  }

  // ---------- consent-active chats (local storage, device par hi) ----------
  async function getActiveChats() {
    return new Promise((resolve) => {
      chrome.storage.local.get('chatConsent', (r) => {
        const map = (r && r.chatConsent) || {};
        resolve(new Set(Object.keys(map).filter((k) => map[k] && map[k].state === 'active')));
      });
    });
  }
  async function isGlobalStopped() {
    return new Promise((resolve) => {
      chrome.storage.local.get('globalStop', (r) => resolve(Boolean(r && r.globalStop)));
    });
  }

  // ---------- chat-list watcher: non-open consent-active chat ka unread aaye
  // to woh chat khol do (engine phir open chat ka kaam karta hai). ----------
  const AUTOOPEN_MIN_INTERVAL_MS = 4000; // rapid chat-hopping rokna
  let lastAutoOpen = 0;

  function rowChatId(row) {
    const href = row.getAttribute('href') || '';
    const m = href.match(/#(-?\d+)/) || (row.dataset && row.dataset.peerId ? [null, row.dataset.peerId] : null);
    return m ? 'tg:' + m[1] : null;
  }

  async function maybeAutoOpen() {
    if (await isGlobalStopped()) return;
    const now = Date.now();
    if (now - lastAutoOpen < AUTOOPEN_MIN_INTERVAL_MS) return;
    const active = await getActiveChats();
    if (!active.size) return;
    const rows = document.querySelectorAll(SELECTORS.listRow);
    for (const row of rows) {
      const key = rowChatId(row);
      if (!key || !active.has(key) || key === currentChatId()) continue;
      const badge = row.querySelector(SELECTORS.unreadBadge);
      if (!badge || !badge.textContent.trim()) continue;
      lastAutoOpen = now;
      row.click(); // sirf consent-active chat kholta hai; read-receipt caveat upar
      return;
    }
  }

  // ---------- engine start ----------
  const engineConfig = {
    getChatKey: () => getChatKey(),
    rowsSelector: SELECTORS.rows,
    isIncoming: (row) => !row.classList.contains(SELECTORS.outgoingClass),
    getText: (row) => {
      const el = row.querySelector(SELECTORS.textSel);
      return el ? el.innerText : '';
    },
    composerSelector: SELECTORS.composer,
    sendSelector: SELECTORS.send,
    headerSelector: SELECTORS.header,
    footerSelector: SELECTORS.footer,
    rootSelector: SELECTORS.root,
    consentMessage:
      'Is chat ke messages AI provider ko process karne hain?\n\n' +
      'Pehle saamne wale se EXPLICIT permission lo. Uske haan ke bina AI is chat mein kuch nahi karega. ' +
      'Woh kabhi bhi "stop" kahe to chat turant aur permanently band ho jayegi (fresh consent ke bina wapas nahi).',
    consentRequestText:
      'Heads up: main is chat mein AI-drafted replies use kar raha/rahi hoon - tumhare messages ek AI provider ko process honge. ' +
      'Theek hai? Kabhi bhi "stop" likhoge to turant band.',
    aiMarker: '',
  };

  const assistant = window.ChatEngine.createChatAssistant(engineConfig);

  // Chat list observe karo (non-open selected chats ke unread badges ke liye).
  function watchList() {
    const list = document.querySelector(SELECTORS.listRoot);
    if (!list) {
      setTimeout(watchList, 1500);
      return;
    }
    new MutationObserver(() => void maybeAutoOpen()).observe(list, { childList: true, subtree: true, characterData: true });
    void maybeAutoOpen(); // boot par bhi check
  }
  watchList();
})();
