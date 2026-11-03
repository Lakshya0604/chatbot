// orbix-hook.js - MAIN world (document_start). Orbix site ke APNI
// GET /api/chats/<24hex> responses ka PASSIVE capture - fetch AUR XHR dono wrap.
// Adapter khud KOI request NAHI karta (zero adapter-initiated reads - v19/v20 ke
// active authenticated reads + full-list enumeration ka replacement; scope/performance
// expansion khatam). Response body page-visible data hai jo site ne khud fetch kiya.
//
// Bridge: window.postMessage (tag __ccOrbixHook). Adapter (isolated world) eval hone
// par 'replay-request' bhejta hai; tab tak ke captures yahan buffer hote hain (initial
// page-load fetch adapter ke document_idle se PEHLE complete ho sakta hai).
// Ready signal: documentElement[data-cc-orbix-hook="1"] (DOM dono worlds mein shared).
(function () {
  'use strict';
  if (window.__ccOrbixHook) return; // double-install guard
  window.__ccOrbixHook = true;
  var TAG = '__ccOrbixHook';
  var CHAT_ID_RE = /\/api\/chats\/([0-9a-f]{24})(?:[/?#]|$)/;
  var CAP = 200;
  var buffer = [];
  var listenerReady = false;

  function post(msg) {
    try {
      msg[TAG] = true;
      window.postMessage(msg, location.origin);
    } catch (e) {}
  }

  function capture(id, messages) {
    var entry = { type: 'chat-response', id: id, messages: messages, at: Date.now() };
    if (!listenerReady) {
      buffer.push(entry);
      if (buffer.length > CAP) buffer.splice(0, buffer.length - CAP);
    }
    post(entry);
  }

  function handleJson(id, j) {
    if (!j || !Array.isArray(j.messages)) return;
    // Minimize: sirf chat-endpoint ke message bodies (page-visible data); koi header/
    // token kabhi capture nahi. Prefix-consistency ke liye shuruati messages kaafi
    // hain - bahut lambi history cap hoti hai (retained private data bounded).
    capture(id, j.messages.slice(0, 500).map(function (x) {
      return { role: String((x && x.role) || ''), content: String((x && x.content) || '').slice(0, 4000) };
    }));
  }

  // ---- fetch wrap: response clone hum lete hain, page ko original milta hai ----
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function () {
      var args = arguments;
      var url = String(args[0] && args[0].url ? args[0].url : args[0]);
      var m = CHAT_ID_RE.exec(url);
      var method = String((args[1] && args[1].method) || (args[0] && args[0].method) || 'GET').toUpperCase();
      return origFetch.apply(this, args).then(function (res) {
        if (m && method === 'GET' && res && res.ok) {
          try { res.clone().json().then(function (j) { handleJson(m[1], j); }, function () {}); } catch (e) {}
        }
        return res;
      });
    };
  }

  // ---- XHR wrap (site kabhi fetch ke bajaye XHR par chale to bhi capture) ----
  var X = window.XMLHttpRequest;
  if (X && X.prototype) {
    var oOpen = X.prototype.open;
    var oSend = X.prototype.send;
    X.prototype.open = function (method, url) {
      this.__ccChatM = CHAT_ID_RE.exec(String(url));
      this.__ccMethod = String(method || 'GET').toUpperCase();
      return oOpen.apply(this, arguments);
    };
    X.prototype.send = function () {
      if (this.__ccChatM && this.__ccMethod === 'GET') {
        var id = this.__ccChatM[1];
        this.addEventListener('load', function () {
          try {
            if (this.status >= 200 && this.status < 300) handleJson(id, JSON.parse(this.responseText));
          } catch (e) {}
        });
      }
      return oSend.apply(this, arguments);
    };
  }

  // Adapter ka replay handshake (isolated world se postMessage dono taraf jaata hai)
  window.addEventListener('message', function (ev) {
    var d = ev && ev.data;
    if (d && d[TAG] === true && d.type === 'replay-request') {
      listenerReady = true;
      for (var i = 0; i < buffer.length; i++) post(buffer[i]);
      buffer.length = 0;
    }
  });

  function markReady() {
    try { document.documentElement.setAttribute('data-cc-orbix-hook', '1'); } catch (e) {}
  }
  if (document.documentElement) markReady();
  else document.addEventListener('DOMContentLoaded', markReady);
  post({ type: 'ready' });
})();
