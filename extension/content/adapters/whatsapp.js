// whatsapp.js - WhatsApp Web adapter (engine ko selectors/identity deta hai).
//
// STATUS: EXPERIMENTAL - LIVE WHATSAPP PAR VERIFY NAHI HUA. Selectors public
// DOM structure ke best-known description par hain; WhatsApp/Meta inhe kabhi
// bhi badal sakta hai (hashed classes). Fail-closed design: selector ya chat
// identity na mile to feature us chat mein chalti hi nahi (galat jagah likhna/
// send karna possible nahi). Mock page par end-to-end tested
// (extension/test/e2e/) - ye mock DOM ka proof hai, live WhatsApp compatibility
// ka nahi.
//
// BAN RISK: WhatsApp automation Meta ke Terms ke khilaf ho sakti hai - account
// BAN ho sakta hai. Owner ko ye risk test se pehle saaf bataya gaya hai.
// Engine ke saare safety guarantees yahan bhi same: consent gate (2-step),
// global Stop all, owner typing par auto-send cancel, pacing 2-10s, draft-first
// default, har send owner ke consent-active chat mein hi.
//
// SCOPE v1: sirf CURRENTLY OPEN conversation. Chat-list auto-open (dusri chat
// ka unread dekhna) jaan-boojh kar NAHI hai - WhatsApp par auto-open read
// receipts (blue ticks) aur detection risk badhata hai.

(function () {
  'use strict';
  if (!window.ChatEngine) return; // engine pehle load hona chahiye

  // ---------- selectors (BEST-KNOWN, live unverified) ----------
  // Open chat pane: #main. Message rows: message-in / message-out (ye classes
  // WA Web ke stable-ish hisse hain, hashed nahi). Text: span.selectable-text.
  // Composer: footer ka contenteditable textbox (title/aria-label localized
  // hote hain, isliye unpar rely nahi).
  const SEL = {
    main: '#main',
    rows: '#main div.message-in, #main div.message-out',
    outgoingClass: 'message-out',
    textSel: 'span.selectable-text',
    composer: '#main footer div[contenteditable="true"]',
    // Send button text aane par hi dikhta hai (mic ki jagah). data-tab="11"
    // best-known; fallback send icon span (click button tak bubble hota hai).
    send: '#main footer button[data-tab="11"], #main footer span[data-icon="send"]',
    header: '#main header',
    footer: '#main footer',
    root: '#app',
    title: '#main header span[dir="auto"]',
  };

  // ---------- chat identity ----------
  // WA Web URL mein chat id nahi deta. Open chat ke title ko key banate hain.
  // Contact/group rename hone par key badal jayegi (purana consent nayi key par
  // apply nahi hota - safe direction). Title na mile / koi chat open na ho to
  // fail closed (null) - engine idle rehta hai.
  function getChatKey() {
    const main = document.querySelector(SEL.main);
    if (!main) return null;
    const t = main.querySelector('header span[dir="auto"]');
    const name = t && t.innerText ? t.innerText.trim() : '';
    return name ? 'wa:' + name : null;
  }

  // ---------- engine start ----------
  window.ChatEngine.createChatAssistant({
    getChatKey,
    rowsSelector: SEL.rows,
    isIncoming: (row) => !row.classList.contains(SEL.outgoingClass),
    getText: (row) => {
      const el = row.querySelector(SEL.textSel);
      return el ? el.innerText : '';
    },
    composerSelector: SEL.composer,
    sendSelector: SEL.send,
    headerSelector: SEL.header,
    footerSelector: SEL.footer,
    rootSelector: SEL.root,
    consentMessage:
      'Is WhatsApp chat ke messages AI provider ko process karne hain?\n\n' +
      'Pehle saamne wale se EXPLICIT permission lo. Uske haan ke bina AI is chat mein kuch nahi karega. ' +
      'Woh kabhi bhi "stop" kahe to chat turant aur permanently band ho jayegi (fresh consent ke bina wapas nahi).\n\n' +
      'Dhyan rahe: WhatsApp automation se account BAN bhi ho sakta hai.',
    consentRequestText:
      'Heads up: main is chat mein AI-drafted replies use kar raha/rahi hoon - tumhare messages ek AI provider ko process honge. ' +
      'Theek hai? Kabhi bhi "stop" likhoge to turant band.',
    aiMarker: '',
  });
})();
