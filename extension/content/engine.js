// engine.js - platform-agnostic chat assistant engine (content script library).
// Ye file kisi specific website ko nahi jaanti. Ek platform adapter isse
// `window.ChatEngine.createChatAssistant(config)` ke saath call karta hai,
// jisme us website ke selectors aur identity functions hote hain.
//
// Engine jo guarantee karta hai (adapter ke sahi selectors par):
//   - Per-chat opt-in + CONSENT GATE: AI tabhi process karta hai jab owner ne
//     confirm kiya ho ki saamne wala explicit agree karta hai (1:1 only design).
//   - Consent request ka draft composer mein deta hai - bhejna OWNER ka manual
//     kaam hai, engine kabhi kuch apne aap send nahi karta.
//   - STOP GATE: saamne wala kabhi bhi stop kahe to chat turant band, us message
//     ko AI ko bheja bhi nahi jaata. Re-enable = fresh consent.
//   - Race safety: reply SIRF usi chat mein dikhegi jahan se request gayi thi.
//   - Fail-closed identity: stable chat id na mile to feature us chat mein band.
//   - authToken kabhi is script tak nahi aata (background.js ka kaam).
//   - Local consent log: kab consent diya/roop, sirf device par.
//
// NOTE: ye guarantees sirf technical hain. Kisi platform par use allowed hai ya
// nahi, us platform ke terms alag se check karne hote hain (README: Platform status).

(function (global) {
  'use strict';

  // Default stop signals: saamne wala inme se kuch bhi likhe -> chat turant band.
  const DEFAULT_STOP = /\b(stop|ruk jao|band karo|mat bhejo|don't message|do not message|chhod do|leave me alone)\b/i;

  function createChatAssistant(config) {
    // config = {
    //   getChatKey(doc)        -> stable per-chat id ya null (null = fail closed)
    //   rowsSelector           -> message bubbles ka selector
    //   isIncoming(row)        -> true agar row doosre person ka message hai
    //   getText(row)           -> message text
    //   composerSelector       -> typing box
    //   headerSelector         -> toggle button kahan lagana hai
    //   footerSelector         -> banner kahan dikhana hai
    //   rootSelector           -> poore app ka root (observer ke liye)
    //   consentMessage         -> owner ka pehla consent dialog text
    //   consentRequestText     -> saamne wale ko bhejne ka consent request draft (owner khud send karega)
    //   aiMarker               -> har AI suggestion ke end mein marker (default '')
    //   stopPattern            -> RegExp (default DEFAULT_STOP)
    // }
    const TEST = (typeof global !== 'undefined' && global.__CC_TEST__) || {};
    const BATCH_DELAY_MS = TEST.BATCH_DELAY_MS || 2500;
    const CONTEXT_MESSAGE_LIMIT = 20;
    const TOGGLE_ID = 'cc-toggle-btn';
    const BANNER_ID = 'cc-banner';
    const stopPattern = config.stopPattern || DEFAULT_STOP;
    const aiMarker = config.aiMarker || '';

    let batchTimer = null;
    let busy = false;
    let lastSeenIncoming = '';
    const pendingSuggestions = {};

    // ---------- storage ----------
    function storageGet(area, key) {
      return new Promise((resolve) => {
        chrome.storage[area].get(key, (result) => resolve(result[key]));
      });
    }
    function storageSet(area, obj) {
      return new Promise((resolve) => chrome.storage[area].set(obj, resolve));
    }

    // ---------- consent state machine ----------
    // states: (none) -> pending -> active -> stopped (stopped se wapas none = fresh consent)
    async function getChatState(chatKey) {
      if (!chatKey) return null;
      const map = (await storageGet('local', 'chatConsent')) || {};
      return map[chatKey] || null; // {state, ts, note}
    }
    async function setChatState(chatKey, state, note) {
      const map = (await storageGet('local', 'chatConsent')) || {};
      if (state === null) delete map[chatKey];
      else map[chatKey] = { state, ts: new Date().toISOString(), note: note || '' };
      await storageSet('local', { chatConsent: map });
      // Local consent log (device par hi rehta hai, kahin nahi bheja jaata).
      const log = (await storageGet('local', 'consentLog')) || [];
      log.push({ chatKey, state, ts: new Date().toISOString(), note: note || '' });
      await storageSet('local', { consentLog: log.slice(-200) });
    }

    // Fail-closed identity: adapter ka getChatKey null de to feature band.
    function getChatKey() {
      try {
        return config.getChatKey(document) || null;
      } catch (e) {
        return null;
      }
    }

    // ---------- toggle button ----------
    function toggleLabel(state) {
      if (!state) return 'AI off';
      if (state.state === 'active') return 'AI on';
      if (state.state === 'pending') return 'Consent pending';
      return 'Stopped';
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
      const state = await getChatState(chatKey);
      // Sirf tab DOM badlo jab state sach mein badli ho - warna apni hi mutation
      // observer ko dobara trigger karti (infinite loop).
      const label = toggleLabel(state);
      if (btn.textContent !== label) btn.textContent = label;
      const enabled = state && state.state === 'active' ? 'true' : 'false';
      if (btn.dataset.enabled !== enabled) btn.dataset.enabled = enabled;

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
      const state = await getChatState(chatKey);

      if (state && state.state === 'active') {
        await setChatState(chatKey, null, 'owner ne band kiya');
        removeBanner();
        refreshToggle();
        return;
      }

      if (!state || state.state === 'stopped') {
        // Step 1: owner ka consent + saamne wale ke liye consent-request draft.
        const ok = window.confirm(config.consentMessage);
        if (!ok) return;
        await setChatState(chatKey, 'pending', 'consent request draft diya gaya');
        const draft = typeof config.consentRequestText === 'function'
          ? config.consentRequestText() : config.consentRequestText;
        if (draft) insertSuggestion(draft, chatKey); // OWNER khud review karke send karega
        refreshToggle();
        return;
      }

      if (state.state === 'pending') {
        // Step 2: owner confirm karta hai ki saamne wale ne explicit haan kaha.
        const confirmed = window.confirm(
          'Kya saamne wale person ne AI replies ke liye EXPLICIT haan kaha hai?\n\n' +
          'Unki haan ke bina AI is chat ke messages process nahi karega.'
        );
        if (!confirmed) return;
        await setChatState(chatKey, 'active', 'owner ne recipient consent confirm ki');
        refreshToggle();
      }
    }

    // ---------- message reading ----------
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

    // ---------- batching + trigger + STOP GATE ----------
    async function onPossibleNewMessage() {
      const enabled = document.getElementById(TOGGLE_ID);
      if (!enabled || enabled.dataset.enabled !== 'true') return;
      const chatKey = getChatKey();
      if (!chatKey) return;
      const messages = readMessages();
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'user') return;
      if (last.content === lastSeenIncoming) return;
      lastSeenIncoming = last.content;

      // STOP GATE: pehle stop check - ye message AI provider ko KABHI nahi jaata.
      if (stopPattern.test(last.content)) {
        await setChatState(chatKey, 'stopped', 'recipient ne stop kaha: ' + last.content.slice(0, 80));
        showBanner('AI band kar diya - saamne wale ne stop kaha. Fresh consent ke bina wapas on nahi hoga.', null);
        refreshToggle();
        return;
      }

      if (batchTimer) clearTimeout(batchTimer);
      batchTimer = setTimeout(() => void generateSuggestion(), BATCH_DELAY_MS);
    }

    const observer = new MutationObserver(() => void onPossibleNewMessage());

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

    // ---------- reply generation ----------
    async function generateSuggestion() {
      if (busy) return;
      const chatKey = getChatKey();
      if (!chatKey) return;
      const state = await getChatState(chatKey);
      if (!state || state.state !== 'active') return; // consent gate: pending/stopped = kuch nahi

      const messages = readMessages();
      if (!messages.length || messages[messages.length - 1].role !== 'user') return;
      // Dobara stop check (batch window mein naya stop message aa sakta hai).
      if (stopPattern.test(messages[messages.length - 1].content)) {
        await setChatState(chatKey, 'stopped', 'recipient ne stop kaha');
        refreshToggle();
        return;
      }

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
          deliverSuggestion(chatKey, response.data.reply + aiMarker);
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
      if (chatKey && getChatKey() !== chatKey) {
        pendingSuggestions[chatKey] = text;
        return;
      }
      const composer = getComposer();
      if (composer && (composer.innerText || '').trim() === '') {
        composer.focus();
        document.execCommand('insertText', false, text);
        showBanner('Draft ready. Padho, edit karo, phir KHUD send dabao.', text);
      } else {
        showBanner('Draft ready. Box mein tumhara text hai, isliye yahan rakha:', text);
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
    return { refreshToggle };
  }

  global.ChatEngine = { createChatAssistant };
})(typeof window !== 'undefined' ? window : globalThis);
