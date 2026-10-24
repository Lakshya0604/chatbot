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

  // ---------- tunable constants ----------
  const BATCH_DELAY_MS = 2500;      // itni der tak naya message na aaye to batch complete
  const CONTEXT_MESSAGE_LIMIT = 20; // backend ko bheje jaane wale max messages
  const TOGGLE_ID = 'cc-toggle-btn';
  const BANNER_ID = 'cc-banner';

  // ---------- state (memory only, page reload par reset) ----------
  let batchTimer = null;     // batching ka pending timer
  let busy = false;          // ek reply generate ho rahi hai to nayi request mat bhejo
  let lastSeenIncoming = ''; // duplicate trigger rokne ke liye last incoming text

  // ---------- storage helpers ----------
  // Per-chat on/off state chrome.storage.local mein, character settings sync mein.
  function storageGet(area, key) {
    return new Promise((resolve) => {
      chrome.storage[area].get(key, (result) => resolve(result[key]));
    });
  }
  function storageSet(area, obj) {
    return new Promise((resolve) => chrome.storage[area].set(obj, resolve));
  }

  // Abhi khuli chat ka naam header se nikaalte hain; yahi per-chat key hai.
  function getChatKey() {
    const header = document.querySelector('#main header span[title]');
    return header ? header.getAttribute('title') : null;
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
    btn.textContent = enabled ? 'AI on' : 'AI off';
    btn.dataset.enabled = String(enabled);
  }

  async function onToggleClick() {
    const chatKey = getChatKey();
    if (!chatKey) return;
    const enabled = await isChatEnabled(chatKey);
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
        insertSuggestion(response.data.reply);
      } else {
        const reason = (response && (response.error || (response.data && response.data.error))) || 'unknown error';
        showBanner(`Reply nahi ban payi: ${reason}`, null);
      }
    } catch (err) {
      showBanner(`Backend se baat nahi ho payi: ${String(err)}`, null);
    } finally {
      busy = false;
    }
  }

  // ---------- suggestion injection (auto-send OFF) ----------
  // Reply composer mein daalte hain, SEND NAHI karte. Send button tumhare haath mein hai.
  function getComposer() {
    return document.querySelector('#main footer div[contenteditable="true"][role="textbox"]');
  }

  function insertSuggestion(text) {
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
