// whatsapp.js - content script, web.whatsapp.com ke andar chalti hai.
// Kaam:
//   1. Har chat ke liye ek toggle button (AI on/off).
//   2. Naye incoming messages detect karna (MutationObserver).
//   3. 2-3 back-to-back messages ko ek input mein batch karna.
//   4. Pichle messages ka context backend ko bhejna.
//   5. AI reply ko composer (typing box) mein SUGGESTION ke roop mein dalna.
//      Auto-send OFF hai - message kabhi apne aap nahi jaata. Tum khud send dabate ho.

(function () {
  'use strict';

  // Test fixture ke liye overrides (real use mein window.__CC_TEST__ exist nahi karta).
  const TEST = (typeof window !== 'undefined' && window.__CC_TEST__) || {};

  // ---------- tunable constants ----------
  const BATCH_DELAY_MS = TEST.BATCH_DELAY_MS || 2500; // itni der tak naya message na aaye to batch complete
  const CONTEXT_MESSAGE_LIMIT = 20; // backend ko bheje jaane wale max messages
  const TOGGLE_ID = 'cc-toggle-btn';
  const BANNER_ID = 'cc-banner';

  // ---------- state (memory only, page reload par reset) ----------
  let batchTimer = null;     // batching ka pending timer
  let busy = false;          // ek reply generate ho rahi hai to nayi request mat bhejo
  let lastSeenIncoming = ''; // duplicate trigger rokne ke liye last incoming text
  const pendingSuggestions = {}; // chatKey -> suggestion (chat switch ke baad wapas aane par)

  // ---------- storage helpers ----------
  // Per-chat on/off state chrome.storage.local mein, character settings sync mein.
  // NOTE: authToken yahan kabhi nahi padha jaata - woh sirf background.js ke paas rehta hai.
  function storageGet(area, key) {
    return new Promise((resolve) => {
      chrome.storage[area].get(key, (result) => resolve(result[key]));
    });
  }
  function storageSet(area, obj) {
    return new Promise((resolve) => chrome.storage[area].set(obj, resolve));
  }

  // ---------- chat identity (FAIL CLOSED) ----------
  // Per-chat key SIRF message bubble ke data-id se banti hai.
  // WhatsApp ke data-id ka format: "true_<chat-id>_<message-id>" - isme chat ka
  // asli id hota hai (phone number / group id), jo display name se zyada stable hai:
  // do contacts ka same naam ho to bhi keys alag rehti hain.
  // Display name par fallback JAANBOOJH kar nahi hai - same-name do alag chats mein
  // galat chat ki settings/reply lag sakti thi. data-id na mile to key null ->
  // is chat mein feature band rehta hai (fail closed, kuch bheja nahi jaata).
  // Natija: bilkul nayi (blank) chat mein tab tak enable nahi hoga jab tak
  // koi message na ho. Ye selectors WhatsApp update par badal sakte hain -
  // tab bhi fail closed: toggle hi nahi dikhega, galat chat mein kuch nahi jayega.
  function getChatKey() {
    const rows = document.querySelectorAll('#main div.message-in[data-id], #main div.message-out[data-id]');
    const last = rows[rows.length - 1];
    if (!last) return null;
    const parts = String(last.getAttribute('data-id')).split('_');
    if (parts.length >= 3 && parts[1]) return 'id:' + parts[1];
    return null;
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

  // ---------- toggle button (chat header mein) ----------
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
      const header = document.querySelector('#main header');
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
      // Pehli baar on karte waqt explicit consent: is chat ke messages reply banane
      // ke liye tumhare backend se hote hue AI provider ko jaayenge.
      const ok = window.confirm(
        'Is chat ke messages AI provider ko bheje jaayenge taaki character wali reply ban sake.\n\n' +
        'Sirf is chat ke liye, aur sirf jab AI on ho. OK to continue?'
      );
      if (!ok) return;
    }
    await setChatEnabled(chatKey, !enabled);
    if (enabled) removeBanner(); // off karte hi pending suggestion hata do
    refreshToggle();
  }

  // ---------- message reading ----------
  // WhatsApp Web mein incoming bubbles .message-in, outgoing .message-out hote hain.
  function readMessages() {
    const rows = document.querySelectorAll('#main div.message-in, #main div.message-out');
    const messages = [];
    rows.forEach((row) => {
      const textEl = row.querySelector('span.selectable-text, div.copyable-text');
      const text = textEl ? textEl.innerText.trim() : '';
      if (!text) return;
      messages.push({
        role: row.classList.contains('message-in') ? 'user' : 'assistant',
        content: text,
      });
    });
    return messages.slice(-CONTEXT_MESSAGE_LIMIT);
  }

  // ---------- batching + trigger ----------
  function onPossibleNewMessage() {
    const enabled = document.getElementById(TOGGLE_ID);
    if (!enabled || enabled.dataset.enabled !== 'true') return;
    const messages = readMessages();
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user') return;          // last message hamara hai, kuch mat karo
    if (last.content === lastSeenIncoming) return;      // same message dobara trigger na ho
    lastSeenIncoming = last.content;

    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(() => void generateSuggestion(), BATCH_DELAY_MS);
  }

  const observer = new MutationObserver(() => onPossibleNewMessage());

  function attachObserver() {
    const main = document.querySelector('#main');
    if (main) observer.observe(main, { childList: true, subtree: true });
  }

  // Chat switch hone par header badalta hai; poore app par halka observer.
  const appObserver = new MutationObserver(() => {
    refreshToggle();
    attachObserver();
  });

  function boot() {
    const app = document.querySelector('#app');
    if (!app) {
      setTimeout(boot, 1000); // WhatsApp Web abhi load ho raha hai
      return;
    }
    appObserver.observe(app, { childList: true, subtree: true });
    refreshToggle();
    attachObserver();
  }

  // ---------- reply generation ----------
  async function generateSuggestion() {
    if (busy) return;
    const chatKey = getChatKey(); // request jis chat se shuru hui, uski key pakad lo
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
  // Agar tab tak tum doosri chat mein ja chuke ho, suggestion memory mein rakhi
  // jaati hai aur wapas aane par dikhti hai - galat chat mein KABHI nahi jayegi.
  function deliverSuggestion(chatKey, text) {
    if (getChatKey() === chatKey) {
      insertSuggestion(text, chatKey);
    } else {
      pendingSuggestions[chatKey] = text;
    }
  }

  // ---------- suggestion injection (auto-send OFF) ----------
  // Reply composer mein daalte hain, SEND NAHI karte. Send button tumhare haath mein hai.
  function getComposer() {
    return document.querySelector('#main footer div[contenteditable="true"][role="textbox"]');
  }

  function insertSuggestion(text, chatKey) {
    // Double-check: insert se pehle bhi wahi chat khuli honi chahiye.
    if (chatKey && getChatKey() !== chatKey) {
      pendingSuggestions[chatKey] = text;
      return;
    }
    const composer = getComposer();
    if (composer && composer.innerText.trim() === '') {
      composer.focus();
      // execCommand('insertText') se React/Redux state bhi update hoti hai,
      // seedha innerText set karne se sirf DOM badalta hai.
      document.execCommand('insertText', false, text);
      showBanner('AI suggestion ready. Padho, edit karo, phir khud send dabao.', text);
    } else {
      // Composer khaali nahi hai - tumhara likha hua text overwrite nahi karenge.
      showBanner('AI suggestion ready. Box mein tumhara text hai, isliye yahan rakha:', text);
    }
  }

  function showBanner(note, suggestionText) {
    removeBanner();
    const footer = document.querySelector('#main footer');
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
})();
