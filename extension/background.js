// background.js - service worker
// Kaam: content script aur backend server ke beech ka bridge.
// Content script seedha fetch nahi karti, kyunki https page se http://localhost
// par request mixed-content/CORS mein phas sakti hai. Extension ke service
// worker ko host_permissions mili hain, isliye yahan se localhost call safe hai.

const DEFAULT_BACKEND_URL = 'http://localhost:8787';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || request.type !== 'GENERATE_REPLY') return false;

  const backendUrl = (request.payload && request.payload.backendUrl) || DEFAULT_BACKEND_URL;

  const headers = { 'Content-Type': 'application/json' };
  if (request.payload && request.payload.authToken) {
    headers['X-Chatbot-Token'] = request.payload.authToken;
  }

  fetch(`${backendUrl}/reply`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request.payload),
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      sendResponse({ ok: res.ok, status: res.status, data });
    })
    .catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });

  return true; // sendResponse async chalega
});
