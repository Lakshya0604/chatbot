// background.js - service worker
// Kaam: content script aur backend server ke beech ka bridge.
// Content script seedha fetch nahi karti, kyunki https page se http://localhost
// par request mixed-content/CORS mein phas sakti hai. Extension ke service
// worker ko host_permissions mili hain, isliye yahan se localhost call safe hai.
//
// SECURITY: authToken storage.local mein rehta hai aur sirf do jagah use hota
// hai - yahan (engine replies ke liye) aur options page ka dummy preview.
// Content script (engine) ka code ise kabhi nahi padhta, aur website ke apne
// scripts extension storage tak pahunch hi nahi sakte.

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8787';
const REQUEST_TIMEOUT_MS = 120000; // hosted free server so ke jaagne mein der laga sakta hai // AI reply der se aaye to hamesha ke liye hang na ho

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || request.type !== 'GENERATE_REPLY') return false;

  const payload = request.payload || {};
  const backendUrl = payload.backendUrl || DEFAULT_BACKEND_URL;

  // Token khud storage se padho - content script se aaye payload par bharosa nahi.
  // authToken secret hai: storage.local (isi device). Purane versions sync mein
  // rakhte the - sync copy mile to migrate karke delete karo.
  chrome.storage.local.get('authToken', (localRes) => {
    chrome.storage.sync.get('authToken', (syncRes) => {
      let token = localRes.authToken;
      if (!token && syncRes.authToken) {
        token = syncRes.authToken;
        chrome.storage.local.set({ authToken: token });
      }
      if (syncRes.authToken) chrome.storage.sync.remove('authToken');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Chatbot-Token'] = token;

    // Timeout: 45s mein jawab na aaye to request abort, error wapas content script ko.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // Sirf character + messages backend ko bhejo - backendUrl jaisi local cheezein nahi.
    const body = JSON.stringify({ character: payload.character, messages: payload.messages, followUp: payload.followUp === true });

    fetch(`${backendUrl}/reply`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(timer);
        const data = await res.json().catch(() => ({}));
        sendResponse({ ok: res.ok, status: res.status, data });
      })
      .catch((err) => {
        clearTimeout(timer);
        const msg = err && err.name === 'AbortError'
          ? `backend timeout (${REQUEST_TIMEOUT_MS / 1000}s mein jawab nahi aaya)`
          : String(err);
        sendResponse({ ok: false, error: msg });
      });
    });
  });

  return true; // sendResponse async chalega
});

// ---------- CUSTOM mode + form-fill entry points (user-controlled, per-site) ----------
// activeTab: sirf USI tab par access milti hai jahan user ne khud button/click
// kiya. Kisi site par permanent access tabhi jab user ne wahan chat select ki ho
// (CC_REGISTER_SITE -> registerContentScripts sirf us origin ke liye).

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id || !/^https?:/.test(tab.url || '')) return;
  try {
    // Picker ke liye engine+utils+custom inject karo (engine inert hai jab tak
    // koi adapter createChatAssistant na bulaye; custom.js picker chalayega).
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/engine.js', 'content/adapters/custom-utils.js', 'content/adapters/custom.js'],
    });
    chrome.tabs.sendMessage(tab.id, { type: 'CC_START_PICKER' }, () => void chrome.runtime.lastError);
  } catch (e) {
    // chrome:// , Web Store, restricted pages par injection fail hoti hai - normal.
  }
});

// Picker finish hone par: us origin ke liye persistent content-script registration,
// taaki agle visit par selected-chat engine apne aap chale.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || request.type !== 'CC_REGISTER_SITE' || !request.origin) return false;
  const id = 'cc-custom-' + request.origin.replace(/[^a-z0-9]/gi, '_');
  chrome.scripting.registerContentScripts([{
    id,
    matches: [request.origin + '/*'],
    js: ['content/engine.js', 'content/adapters/custom-utils.js', 'content/adapters/custom.js'],
    runAt: 'document_idle',
    persistAcrossSessions: true,
  }])
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});

// Form auto-fill: right-click context menu se, sirf user ke click par.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'cc-fill-form',
    title: 'Character Chatbot: form auto-fill (review ke baad Submit KHUD karo)',
    contexts: ['page', 'editable'],
  });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'cc-fill-form' || !tab || !tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/formfill.js'] });
    chrome.tabs.sendMessage(tab.id, { type: 'CC_FILL_FORM' }, () => void chrome.runtime.lastError);
  } catch (e) { /* restricted page */ }
});

