// engine.js - platform-agnostic chat assistant engine (content script library).
// Ye file kisi specific website ko nahi jaanti. Ek platform adapter isse
// `window.ChatEngine.createChatAssistant(config)` ke saath call karta hai,
// jisme us website ke selectors aur identity functions hote hain.
//
// Engine jo guarantee karta hai (adapter ke sahi selectors par):
//   - Per-chat opt-in (pehli baar on karte waqt explicit consent dialog).
//   - Naye incoming messages ka batching (2-3 back-to-back ko ek input mein).
//   - Race safety: reply SIRF usi chat mein dikhegi jahan se request gayi thi.
//     Chat switch ho jaye to suggestion memory mein rukti hai, wapas aane par milti hai.
//   - Fail-closed identity: stable chat id na mile to feature us chat mein band.
//   - Kabhi auto-send nahi: suggestion composer ya banner mein aati hai.
//   - authToken kabhi is script tak nahi aata (background.js ka kaam).
//
// NOTE: in guarantees ka matlab ye nahi ki kisi platform par use allowed hai -
// us platform ke terms alag se check karne hote hain (README: Platform status).

(function (global) {
  'use strict';

  function createChatAssistant(config) {
    // config = {
    //   getChatKey(doc)        -> stable per-chat id ya null (null = fail closed)
    //   rowsSelector           -> message bubbles ka selector (incoming/outgoing dono)
    //   isIncoming(row)        -> true agar row doosre person ka message hai
    //   getText(row)           -> message text
    //   composerSelector       -> typing box
    //   headerSelector         -> toggle button kahan lagana hai
    //   footerSelector         -> banner kahan dikhana hai
    //   rootSelector           -> poore app ka root (observer ke liye)
    //   consentMessage         -> pehli baar enable par dikhne wala consent text
    // }
    const TEST = (typeof global !== 'undefined' && global.__CC_TEST__) || {};
    const BATCH_DELAY_MS = TEST.BATCH_DELAY_MS || 2500;
    const CONTEXT_MESSAGE_LIMIT = 20;
    const TOGGLE_ID = 'cc-toggle-btn';
    const BANNER_ID = 'cc-banner';

    let batchTimer = null;
    let busy = false;
    let lastSeenIncoming = '';
    const pendingSuggestions = {};

    function storageGet(area, key) {
      return new Promise((resolve) => {
        chrome.storage[area].get(key, (result) => resolve(result[key]));
      });
    }
    function storageSet(area, obj) {
      return new Promise((resolve) => chrome.storage[area].set(obj, resolve));
    }

    // Fail-closed identity: adapter ka getChatKey null de to feature band.
    function getChatKey() {
      try {
        return config.getChatKey(document) || null;
      } catch (e) {
        return null; // selector toot jaye to bhi fail closed
      }
    }

    async function isChatEnabled(chatKey) {
      if (!chatKey) return false;
      const map = (await storageGet('local', 'enabledChats')) || {};
      return Boolean(map[chatKey]);
    }

    async function setChatEnabled(chatKey, enabled) {
      const map = (await storageGet('local', 'enabledChats')) || {};
      map[chatKey] = enabled;
      await storageSet('local', { enabledChats: map });
    }

    async function refreshToggle() {
      const chatKey = getChatKey();
      let btn = document.getElementById(TOGGLE_ID);
      if (!chatKey) {
        if (btn) btn.remove();
        return;
      }
      if (!btn) {
        btn = document.createElement('button');
        btn.id = TOGGLE_ID;
        btn.type = 'button';
        btn.addEventListener('click', onToggleClick);
        const header = document.querySelector(config.headerSelector);
        if (header) header.appendChild(btn);
      }
      const enabled = await isChatEnabled(chatKey);
      // Sirf tab DOM badlo jab state sach mein badli ho - warna apni hi mutation
      // observer ko dobara trigger karti (infinite loop).
      const label = enabled ? 'AI on' : 'AI off';
      if (btn.textContent !== label) btn.textContent = label;
      if (btn.dataset.enabled !== String(enabled)) btn.dataset.enabled = String(enabled);

      // Chat switch ke dauraan aayi pending suggestion ab deliver karo (sahi chat mein).
      if (pendingSuggestions[chatKey]) {
        const text = pendingSuggestions[chatKey];
        delete pendingSuggestions[chatKey];
        insertSuggestion(text, chatKey);
      }
    }

    async function onToggleClick() {
      const chatKey = getChatKey();
      if (!chatKey) return;
      const enabled = await isChatEnabled(chatKey);
      if (!enabled) {
        const ok = window.confirm(config.consentMessage);
        if (!ok) return;
      }
      await setChatEnabled(chatKey, !enabled);
      if (enabled) removeBanner();
      refreshToggle();
    }

    function readMessages() {
      const rows = document.querySelectorAll(config.rowsSelector);
      const messages = [];
      rows.forEach((row) => {
        const text = (config.getText(row) || '').trim();
        if (!text) return;
        messages.push({
          role: config.isIncoming(row) ? 'user' : 'assistant',
          content: text,
        });
      });
      return messages.slice(-CONTEXT_MESSAGE_LIMIT);
    }

    function onPossibleNewMessage() {
      const enabled = document.getElementById(TOGGLE_ID);
      if (!enabled || enabled.dataset.enabled !== 'true') return;
      const messages = readMessages();
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'user') return;
      if (last.content === lastSeenIncoming) return;
      lastSeenIncoming = last.content;

      if (batchTimer) clearTimeout(batchTimer);
      batchTimer = setTimeout(() => void generateSuggestion(), BATCH_DELAY_MS);
    }

    const observer = new MutationObserver(() => onPossibleNewMessage());

    function attachObserver() {
      const root = document.querySelector(config.rootSelector);
      if (root) observer.observe(root, { childList: true, subtree: true });
    }

    const appObserver = new MutationObserver(() => {
      refreshToggle();
      attachObserver();
    });

    function boot() {
      const root = document.querySelector(config.rootSelector);
      if (!root) {
        setTimeout(boot, 1000);
        return;
      }
      appObserver.observe(root, { childList: true, subtree: true });
      refreshToggle();
      attachObserver();
    }

    async function generateSuggestion() {
      if (busy) return;
      const chatKey = getChatKey();
      if (!chatKey || !(await isChatEnabled(chatKey))) return;

      const messages = readMessages();
      if (!messages.length || messages[messages.length - 1].role !== 'user') return;

      const character = (await storageGet('sync', 'character')) || {};
      const backendUrl = (await storageGet('sync', 'backendUrl')) || undefined;

      busy = true;
      showBanner('AI soch raha hai...', null);
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GENERATE_REPLY',
          payload: { character, messages, backendUrl },
        });
        if (response && response.ok && response.data && response.data.reply) {
          deliverSuggestion(chatKey, response.data.reply);
        } else {
          const reason = (response && (response.error || (response.data && response.data.error))) || 'unknown error';
          if (getChatKey() === chatKey) showBanner(`Reply nahi ban payi: ${reason}`, null);
        }
      } catch (err) {
        if (getChatKey() === chatKey) showBanner(`Backend se baat nahi ho payi: ${String(err)}`, null);
      } finally {
        busy = false;
      }
    }

    // RACE SAFETY: reply sirf wahi chat paaye jahan se request gayi thi.
    function deliverSuggestion(chatKey, text) {
      if (getChatKey() === chatKey) {
        insertSuggestion(text, chatKey);
      } else {
        pendingSuggestions[chatKey] = text;
      }
    }

    function getComposer() {
      return document.querySelector(config.composerSelector);
    }

    function insertSuggestion(text, chatKey) {
      // Double-check: insert se pehle bhi wahi chat khuli honi chahiye.
      if (chatKey && getChatKey() !== chatKey) {
        pendingSuggestions[chatKey] = text;
        return;
      }
      const composer = getComposer();
      if (composer && (composer.innerText || '').trim() === '') {
        composer.focus();
        document.execCommand('insertText', false, text);
        showBanner('AI suggestion ready. Padho, edit karo, phir khud send dabao.', text);
      } else {
        showBanner('AI suggestion ready. Box mein tumhara text hai, isliye yahan rakha:', text);
      }
    }

    function showBanner(note, suggestionText) {
      removeBanner();
      const footer = document.querySelector(config.footerSelector);
      if (!footer) return;
      const banner = document.createElement('div');
      banner.id = BANNER_ID;

      const noteEl = document.createElement('div');
      noteEl.className = 'cc-note';
      noteEl.textContent = note;
      banner.appendChild(noteEl);

      if (suggestionText) {
        const textEl = document.createElement('div');
        textEl.className = 'cc-suggestion';
        textEl.textContent = suggestionText;
        banner.appendChild(textEl);
      }

      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'cc-dismiss';
      dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', removeBanner);
      banner.appendChild(dismiss);

      footer.prepend(banner);
    }

    function removeBanner() {
      const banner = document.getElementById(BANNER_ID);
      if (banner) banner.remove();
    }

    boot();
    return { refreshToggle }; // adapter ke liye minimal handle
  }

  global.ChatEngine = { createChatAssistant };
})(typeof window !== 'undefined' ? window : globalThis);
