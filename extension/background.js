// background.js - service worker
// Kaam: content script aur backend server ke beech ka bridge.
// Content script seedha fetch nahi karti, kyunki https page se http://localhost
// par request mixed-content/CORS mein phas sakti hai. Extension ke service
// worker ko host_permissions mili hain, isliye yahan se localhost call safe hai.
//
// SECURITY: authToken SIRF yahan rehta hai. Content script ko kabhi nahi diya
// jaata, taaki page ke andar chalne wala koi bhi code token na dekh sake.

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8787';
const REQUEST_TIMEOUT_MS = 45000; // AI reply der se aaye to hamesha ke liye hang na ho

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
    const body = JSON.stringify({ character: payload.character, messages: payload.messages });

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
