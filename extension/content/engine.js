// engine.js - platform-agnostic chat assistant engine (content script library).
// Ye file kisi specific website ko nahi jaanti. Ek platform adapter isse
// `window.ChatEngine.createChatAssistant(config)` ke saath call karta hai,
// jisme us website ke selectors aur identity functions hote hain.
//
// Engine jo guarantee karta hai (adapter ke sahi selectors par):
//   - Per-chat opt-in + CONSENT GATE: AI tabhi process karta hai jab owner ne
//     confirm kiya ho ki saamne wala explicit agree karta hai (1:1 only design).
//   - Consent request ka draft composer mein deta hai - bhejna OWNER ka manual
//     kaam hai; consent-request engine kabhi apne aap nahi bhejta.
//   - AUTO mode (per-chat, owner ka explicit choice, sirf consent-active chat):
//     naya incoming aane par AI reply apne aap send ho sakti hai. User apna text
//     type kar raha ho, state/identity doubt ho, ya stop aaya ho to send NAHI.
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
    //   sendSelector           -> AUTO mode ka send button (optional; na mile to
    //                             auto-reply draft ban jati hai, send nahi hoti)
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
    // epoch: har stop/off/state-change par badhta hai. In-flight AI request ka
    // late reply tab discard hota hai jab epoch badal chuka ho.
    let epoch = 0;
    const GLOBAL_STOP_KEY = 'globalStop';
    const STOPALL_ID = 'cc-stopall-btn';
    const AUTO_BTN_ID = 'cc-auto-btn';
    const MODE_KEY = 'chatMode';
    // Page load ke baad jin active chats ka "ab tak ka last incoming" snapshot
    // ho chuka hai. Bina snapshot ke enable karte hi PURANE incoming message par
    // reply ban jaati - activation ke baad AAYE messages par hi react karna hai.
    const bootSynced = new Set();
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
    async function isGlobalStopped() {
      return Boolean(await storageGet('local', GLOBAL_STOP_KEY));
    }
    async function setGlobalStopped(on) {
      epoch++;
      if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
      await storageSet('local', { [GLOBAL_STOP_KEY]: on ? { ts: new Date().toISOString() } : null });
    }

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

    // Per-chat reply mode: 'suggest' (default - draft, owner khud send kare) ya
    // 'auto' (consent-active chat mein AI reply apne aap send). Sirf device par.
    async function getChatMode(chatKey) {
      if (!chatKey) return 'suggest';
      const map = (await storageGet('local', MODE_KEY)) || {};
      return map[chatKey] === 'auto' ? 'auto' : 'suggest';
    }
    async function setChatMode(chatKey, mode) {
      const map = (await storageGet('local', MODE_KEY)) || {};
      if (mode === 'auto') map[chatKey] = 'auto'; else delete map[chatKey];
      await storageSet('local', { [MODE_KEY]: map });
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

      // GLOBAL STOP ALL button: sab chats ek saath band/resume.
      const header = document.querySelector(config.headerSelector);
      let stopAll = document.getElementById(STOPALL_ID);
      if (header && !stopAll) {
        stopAll = document.createElement('button');
        stopAll.id = STOPALL_ID;
        stopAll.type = 'button';
        stopAll.addEventListener('click', onStopAllClick);
        header.appendChild(stopAll);
      }
      if (stopAll) {
        const stopped = await isGlobalStopped();
        const sl = stopped ? 'Resume all' : 'Stop all';
        if (stopAll.textContent !== sl) stopAll.textContent = sl;
        stopAll.dataset.stopped = stopped ? 'true' : 'false';
      }
      // AUTO mode button: label sirf tab badlo jab sach mein badla (observer loop).
      let autoBtn = document.getElementById(AUTO_BTN_ID);
      if (header && !autoBtn) {
        autoBtn = document.createElement('button');
        autoBtn.id = AUTO_BTN_ID;
        autoBtn.type = 'button';
        autoBtn.addEventListener('click', onAutoClick);
        header.appendChild(autoBtn);
      }
      if (autoBtn) {
        const mode = await getChatMode(chatKey);
        const al = mode === 'auto' ? 'Auto: on' : 'Auto: off';
        if (autoBtn.textContent !== al) autoBtn.textContent = al;
        autoBtn.dataset.mode = mode;
      }
      const enabled = state && state.state === 'active' ? 'true' : 'false';
      if (btn.dataset.enabled !== enabled) btn.dataset.enabled = enabled;
      if (state && state.state === 'active' && !bootSynced.has(chatKey)) {
        bootSynced.add(chatKey);
        snapshotIncoming();
      }

      // Chat switch ke dauraan aayi pending suggestion ab deliver karo (sahi chat mein).
      if (pendingSuggestions[chatKey]) {
        const text = pendingSuggestions[chatKey];
        delete pendingSuggestions[chatKey];
        void deliverSuggestion(chatKey, text);
      }
    }

    async function onStopAllClick() {
      const stopped = await isGlobalStopped();
      if (!stopped) {
        // STOP ALL: queued batch cancel, in-flight discard (epoch), sab chats dormant.
        await setGlobalStopped(true);
        showBanner('STOP ALL: sabhi chats par AI band. Resume all se hi wapas chalega.', null);
      } else {
        await setGlobalStopped(false);
        showBanner('Resume ho gaya. Sirf enabled (consent-active) chats hi chalengi.', null);
      }
      refreshToggle();
    }

    // AUTO toggle: sirf consent-active chat mein. Ye owner ka per-chat explicit
    // choice hai - default hamesha 'suggest' (manual send) hota hai.
    async function onAutoClick() {
      const chatKey = getChatKey();
      if (!chatKey) return;
      const state = await getChatState(chatKey);
      if (!state || state.state !== 'active') {
        showBanner('Auto-reply sirf consent-active chat mein on hoti hai. Pehle AI on karo.', null);
        return;
      }
      const mode = await getChatMode(chatKey);
      const next = mode === 'auto' ? 'suggest' : 'auto';
      await setChatMode(chatKey, next);
      showBanner(next === 'auto'
        ? 'Auto-reply ON: naye incoming par AI reply apne aap send hogi. Saamne wala stop kahe ya tum off karo to turant band.'
        : 'Auto-reply OFF: AI sirf draft banayegi, send tum khud karoge.', null);
      refreshToggle();
    }

    async function onToggleClick() {
      const chatKey = getChatKey();
      if (!chatKey) return;
      const state = await getChatState(chatKey);

      if (state && state.state === 'active') {
        epoch++; // in-flight reply discard hogi
        if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
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
        snapshotIncoming(); // sirf activation ke BAAD aaye messages par react karo
        refreshToggle();
      }
    }

    // ---------- message reading ----------
    function snapshotIncoming() {
      const msgs = readMessages();
      const last = msgs[msgs.length - 1];
      lastSeenIncoming = last && last.role === 'user' ? last.content : '';
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

    // ---------- batching + trigger + STOP GATE ----------
    async function onPossibleNewMessage() {
      if (await isGlobalStopped()) {
        // Stop ke DORAAN aaye messages "seen" mark karo - resume par unka purana
        // backlog reply na bane (sirf resume ke BAAD ke messages trigger honge).
        snapshotIncoming();
        return; // GLOBAL STOP ALL
      }
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
        epoch++;
        if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
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
      if (await isGlobalStopped()) return;
      const chatKey = getChatKey();
      if (!chatKey) return;
      const state = await getChatState(chatKey);
      if (!state || state.state !== 'active') return; // consent gate: pending/stopped = kuch nahi
      const myEpoch = epoch;

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
      const discardIfStale = async () => {
        // Owner ne stop/off kiya ya global stop aaya beech mein -> reply discard.
        if (epoch !== myEpoch) return true;
        if (await isGlobalStopped()) return true;
        const st = await getChatState(chatKey);
        return !st || st.state !== 'active';
      };
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GENERATE_REPLY',
          payload: { character, messages, backendUrl },
        });
        if (await discardIfStale()) return; // STOP: late reply discard, kuch insert nahi
        if (response && response.ok && response.data && response.data.reply) {
          await deliverSuggestion(chatKey, response.data.reply + aiMarker);
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
    // Auto mode mein wahi reply apne aap send bhi ho sakti hai (guards ke saath).
    async function deliverSuggestion(chatKey, text) {
      if (getChatKey() !== chatKey) {
        pendingSuggestions[chatKey] = text;
        return;
      }
      if ((await getChatMode(chatKey)) === 'auto') {
        await autoSend(chatKey, text);
        return;
      }
      insertSuggestion(text, chatKey);
    }

    // AUTO SEND: sirf consent-active chat, sirf khaali composer, sirf jab
    // adapter ka send button mile. Kisi bhi doubt mein manual draft par fallback -
    // user ka likha text kabhi overwrite ya send nahi hota.
    async function autoSend(chatKey, text) {
      if (await isGlobalStopped()) return; // beech mein Stop all -> send nahi
      const st = await getChatState(chatKey);
      if (!st || st.state !== 'active') return; // consent wapas/off -> send nahi
      const composer = getComposer();
      if (!composer || (composer.innerText || '').trim() !== '') {
        insertSuggestion(text, chatKey); // user type kar raha hai - draft only
        return;
      }
      const sendBtn = config.sendSelector ? document.querySelector(config.sendSelector) : null;
      if (!sendBtn) {
        showBanner('Auto-send ka button nahi mila - draft yahan hai, khud bhejo:', text);
        return;
      }
      composer.focus();
      document.execCommand('insertText', false, text);
      sendBtn.click();
      showBanner('Auto-reply bhej di gayi (consent-active chat). Rokna ho to AI off ya Stop all.', null);
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
