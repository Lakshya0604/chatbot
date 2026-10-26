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
    const BATCH_DELAY_MS = TEST.BATCH_DELAY_MS || 0; // 0 = pacing khud decide kare
    // Reply pacing (user spec): zyada tar 2-3s, kabhi kabhi (~20%) 8-10s. Ye sirf
    // pacing hai - ban-risk kam karne ka claim NAHI. Delay ke DORAAN bhi saare
    // guards (stop/consent/identity/typing) laagu rehte hain: timer fire hone par
    // generateSuggestion sab dobara check karta hai.
    function replyDelayMs() {
      if (TEST.BATCH_DELAY_MS) return TEST.BATCH_DELAY_MS;
      const r = Math.random();
      if (r < 0.2) return 8000 + Math.floor(Math.random() * 2000);
      return 2000 + Math.floor(Math.random() * 1000);
    }
    // Proactive follow-up (user spec, SETTLED hissa): saamne wala (incoming side)
    // 1 MIN chup rahe aur last message hamari taraf se ho, to character KHUD SE
    // ek follow-up kare (AUTO: send, SUGGEST: draft). Doosre follow-up ka
    // interval/count abhi user ne settle NAHI kiya - isliye session mein MAX 1;
    // naya incoming aane par counter reset. Cancel: Stop all, consent off/stop,
    // chat switch, naya incoming. Kabhi unlimited/self-triggered nahi.
    const FOLLOWUP_DELAY_MS = TEST.FOLLOWUP_DELAY_MS || 60000;
    const CONTEXT_MESSAGE_LIMIT = 20;
    const TOGGLE_ID = 'cc-toggle-btn';
    const BANNER_ID = 'cc-banner';
    const stopPattern = config.stopPattern || DEFAULT_STOP;
    const aiMarker = config.aiMarker || '';

    let batchTimer = null;
    let followUpTimer = null;
    let engineInserting = false; // engine ka apna insertText owner-typing se alag
    let followUpsSent = 0; // session scope; naya incoming par reset (2nd ka spec pending)
    let bootLastOutgoing = undefined; // boot ke waqt jo outgoing already tha - US par follow-up NAHI
    let primedChatKey = null; // jis chat ka visible history baseline ho chuka
    let lastArmedOutgoing = undefined; // jis outgoing content par follow-up already arm ho chuka

    function clearFollowUp() {
      if (followUpTimer) { clearTimeout(followUpTimer); followUpTimer = null; }
    }
    function scheduleFollowUp() {
      clearFollowUp();
      followUpTimer = setTimeout(() => void maybeFollowUp(), FOLLOWUP_DELAY_MS);
    }
    async function maybeFollowUp() {
      followUpTimer = null;
      if (await isGlobalStopped()) return;
      if (followUpsSent >= 1) return; // doosra follow-up: spec pending, unlimited NAHI
      const chatKey = getChatKey();
      if (!chatKey) return;
      const st = await getChatState(chatKey);
      if (!st || st.state !== 'active') return; // consent band -> kuch nahi
      const msgs = readMessages();
      const last = msgs[msgs.length - 1];
      if (!last || last.role === 'user') return; // beech mein incoming aa gaya
      followUpsSent++;
      showBanner('Saamne wala 1 min se chup hai - character khud follow-up kar raha hai (roknna ho to AI off / Stop all).', null);
      await generateSuggestion({ followUp: true });
    }
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
        clearFollowUp();
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
        clearFollowUp();
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
        if (draft) await insertSuggestion(draft, chatKey); // OWNER khud review karke send karega
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
    // lastHandled PERSIST hota hai (chatConsent record ke andar) - warna reload/
    // reopen par PURANA incoming "naya" lag ke dobara reply chala jata (duplicate/
    // unsolicited send risk). Boot par persisted value se shuru; sirf is session
    // mein OBSERVE hua naya incoming hi trigger hota hai.
    async function persistLastHandled(chatKey, content) {
      if (!chatKey) return;
      const map = (await storageGet('local', 'chatConsent')) || {};
      const rec = map[chatKey];
      if (!rec) return; // consent record hi nahi (inactive chat) - kuch mat likho
      if (rec.lastHandled === content) return;
      map[chatKey] = Object.assign({}, rec, { lastHandled: content });
      await storageSet('local', { chatConsent: map });
    }
    function snapshotIncoming() {
      const msgs = readMessages();
      const last = msgs[msgs.length - 1];
      lastSeenIncoming = last && last.role === 'user' ? last.content : '';
      const chatKey = getChatKey();
      // Activation/stop ke waqt ka snapshot = first-bind priming ka bhi baseline.
      // Warna low-churn DOMs par activation ke TURANT baad aaya pehla incoming
      // "history" samajh ke prime ho kar swallow ho jata hai (whatsapp mock mein
      // mila). Saath hi historical outgoing ka follow-up arm bhi rokna hai.
      if (chatKey && msgs.length) {
        // GUARD: sirf tab prime karo jab koi message ACTUALLY render ho chuka ho.
        // Empty home/list screen par priming consume karne se (Orbix hash-router:
        // ek hi chatKey sab screens ka) baad mein khuli asli chat ki history
        // "naya" lag ke trigger/send ho jati hai (2j regression). lastSeenIncoming
        // ka snapshot upar hi set ho chuka hai; yahan sirf priming consume hai.
        primedChatKey = chatKey;
        bootLastOutgoing = last && last.role !== 'user' ? last.content : null;
        void persistLastHandled(chatKey, lastSeenIncoming);
      }
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
        clearFollowUp();
        return; // GLOBAL STOP ALL
      }
      const enabled = document.getElementById(TOGGLE_ID);
      if (!enabled || enabled.dataset.enabled !== 'true') return;
      const chatKey = getChatKey();
      if (!chatKey) return;
      const messages = readMessages();
      const last = messages[messages.length - 1];
      if (primedChatKey !== chatKey && last) {
        // FIRST BIND (boot/reload/reopen/chat-switch): jo history abhi dikh rahi
        // hai use BASELINE karo - bina generate/send. Historical incoming par
        // kabhi unsolicited reply NAHI; sirf iske BAAD aaya naya incoming trigger
        // hoga (owner chahe to khud consent toggle/refresh karke current par
        // reply kara sakta hai - wo uska explicit action hai).
        // NOTE: sirf tab prime karo jab koi message render ho chuka ho - empty
        // home/list screen par priming consume karne se asli history-render
        // trigger ban jata hai (Orbix hash-router: ek hi chatKey sab chats ka).
        primedChatKey = chatKey;
        if (last.role === 'user') {
          lastSeenIncoming = last.content;
          void persistLastHandled(chatKey, last.content);
        }
        bootLastOutgoing = last.role !== 'user' ? last.content : null;
        return;
      }
      if (!last || last.role !== 'user') {
        // Sirf IS SESSION mein aaya NAYA outgoing follow-up arm kare; reload ke
        // baad purani history dekh ke timer mat chalao (stale-context send risk).
        // lastArmedOutgoing dedup: wahi outgoing ke har DOM mutation par timer
        // dobara arm/reset NAHI (warna owner-typing cancel turant re-arm ho jata).
        if (last && last.content !== bootLastOutgoing && last.content !== lastArmedOutgoing) {
          lastArmedOutgoing = last.content;
          scheduleFollowUp();
        }
        return;
      }
      clearFollowUp();
      followUpsSent = 0; // naya incoming = doosri side active; follow-up counter reset
      bootLastOutgoing = null; // ab aage ke outgoing "naye" hain
      lastArmedOutgoing = undefined; // naya episode: agla outgoing phir arm karega
      if (last.content === lastSeenIncoming) return;
      lastSeenIncoming = last.content;
      void persistLastHandled(chatKey, last.content);

      // STOP GATE: pehle stop check - ye message AI provider ko KABHI nahi jaata.
      if (stopPattern.test(last.content)) {
        epoch++;
        if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
        clearFollowUp();
        await setChatState(chatKey, 'stopped', 'recipient ne stop kaha: ' + last.content.slice(0, 80));
        showBanner('AI band kar diya - saamne wale ne stop kaha. Fresh consent ke bina wapas on nahi hoga.', null);
        refreshToggle();
        return;
      }

      if (batchTimer) clearTimeout(batchTimer);
      batchTimer = setTimeout(() => void generateSuggestion(), replyDelayMs());
    }

    // Owner composer mein TYPE kare to pending follow-up CANCEL (owner khud
    // likh raha hai = silence khatam). Engine ka apna insertText ignore hota hai.
    document.addEventListener('input', (e) => {
      if (engineInserting || !followUpTimer) return;
      const c = getComposer();
      if (c && (e.target === c || c.contains(e.target))) clearFollowUp();
    }, true);
    const observer = new MutationObserver(() => void onPossibleNewMessage());

    function attachObserver() {
      const root = document.querySelector(config.rootSelector);
      if (root) observer.observe(root, { childList: true, subtree: true });
    }

    const appObserver = new MutationObserver(() => {
      refreshToggle();
      attachObserver();
    });

    let booted = false;
    function boot() {
      const root = document.querySelector(config.rootSelector);
      if (!root) {
        setTimeout(boot, 1000);
        return;
      }
      appObserver.observe(root, { childList: true, subtree: true });
      refreshToggle();
      attachObserver();
      if (!booted) { booted = true; }
    }

    // ---------- reply generation ----------
    async function generateSuggestion(opts) {
      if (busy) return;
      if (await isGlobalStopped()) return;
      const chatKey = getChatKey();
      if (!chatKey) return;
      const state = await getChatState(chatKey);
      if (!state || state.state !== 'active') return; // consent gate: pending/stopped = kuch nahi
      const myEpoch = epoch;

      const messages = readMessages();
      if (!messages.length) return;
      const lastMsg = messages[messages.length - 1];
      // Normal trigger: last incoming par jawab. FOLLOW-UP: last OUTGOING par bhi
      // generate karna hi feature hai (saamne wala chup, character aage badhata hai).
      if (lastMsg.role !== 'user' && !(opts && opts.followUp)) return;
      // Stop gate SIRF incoming par - follow-up mein last message owner ka apna
      // hota hai, us par recipient-stop check ka matlab nahi.
      if (lastMsg.role === 'user' && stopPattern.test(lastMsg.content)) {
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
          payload: { character, messages, backendUrl, followUp: !!(opts && opts.followUp) },
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

    // Composer ka text: TEXTAREA/INPUT mein .value hota hai (innerText hamesha
    // khaali deta hai!), contenteditable mein innerText. Ye guard owner-typing
    // safety ka base hai - galat read ka matlab owner ka text AI ke saath send.
    function composerText(composer) {
      if (!composer) return '';
      const isField = composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT';
      return (isField ? (composer.value || '') : (composer.innerText || '')).trim();
    }
    function composerHasText(composer) {
      return composerText(composer) !== '';
    }

    // RACE SAFETY: reply sirf wahi chat paaye jahan se request gayi thi.
    // Auto mode mein wahi reply apne aap send bhi ho sakti hai (guards ke saath).
    async function deliverSuggestion(chatKey, text) {
      // Stop all generation ke BAAD aaya ho to response DISCARD - na send, na
      // draft insert (late-response safety: rukne ke baad kuch nahi aana chahiye).
      if (await isGlobalStopped()) return;
      if (getChatKey() !== chatKey) {
        pendingSuggestions[chatKey] = text;
        return;
      }
      if ((await getChatMode(chatKey)) === 'auto') {
        await autoSend(chatKey, text);
        return;
      }
      await insertSuggestion(text, chatKey);
    }

    // AUTO SEND: sirf consent-active chat, sirf khaali composer, sirf jab
    // adapter ka send button mile. Kisi bhi doubt mein manual draft par fallback -
    // user ka likha text kabhi overwrite ya send nahi hota.
    async function autoSend(chatKey, text) {
      if (await isGlobalStopped()) return; // beech mein Stop all -> send nahi
      const st = await getChatState(chatKey);
      if (!st || st.state !== 'active') return; // consent wapas/off -> send nahi
      const composer = getComposer();
      if (!composer || composerHasText(composer)) {
        await insertSuggestion(text, chatKey); // user type kar raha hai - draft only
        return;
      }
      const sendBtn = findSendButton(composer);
      if (!sendBtn) {
        showBanner('Auto-send ka button nahi mila - draft yahan hai, khud bhejo:', text);
        return;
      }
      composer.focus();
      engineInserting = true;
      try { document.execCommand('insertText', false, text); } finally { setTimeout(() => { engineInserting = false; }, 0); }
      // Controlled frameworks (React) apna state async update karte hain, isliye
      // send button insert ke turant baad disabled reh sakta hai. Thoda ruk kar
      // button dobara dhoondo; enabled na mile to draft composer mein hi chhodo.
      await new Promise((r) => setTimeout(r, 150));
      // CLICK SE PEHLE full re-check: is chhoti window mein Stop all / consent off /
      // chat switch / owner typing ho sakta hai - kuch bhi badla to send NAHI.
      const stillOk = !(await isGlobalStopped())
        && getChatKey() === chatKey
        && (await getChatState(chatKey))?.state === 'active'
        && composerText(composer) === text.trim(); // composer mein SIRF wahi AI text ho (owner ne beech mein type nahi kiya)
      const btn = stillOk ? findSendButton(composer) : null;
      if (btn && !btn.disabled) {
        btn.click();
        showBanner('Auto-reply bhej di gayi (consent-active chat). Rokna ho to AI off ya Stop all.', null);
      } else {
        showBanner('Auto-send ab safe nahi (ruk gayi/state badli/button inactive) - draft composer mein hai, padho aur KHUD bhejo.', null);
      }
    }

    function getComposer() {
      return document.querySelector(config.composerSelector);
    }

    function findSendButton(composer) {
      if (!config.sendSelector) return null;
      // Send button composer ke container ke ANDAR dhoondo. Page par same classes
      // wale doosre buttons (Download/Connect/Load...) ho sakte hain - poori
      // document-wide query un par galat click kar sakti hai (Orbix live bug).
      const scopes = [];
      if (composer) {
        const form = composer.closest('form');
        if (form) scopes.push(form);
        if (composer.parentElement) scopes.push(composer.parentElement);
      }
      if (config.footerSelector) {
        const f = document.querySelector(config.footerSelector);
        if (f) scopes.push(f);
      }
      for (const sc of scopes) {
        const b = sc.querySelector(config.sendSelector);
        if (b) return b;
      }
      return document.querySelector(config.sendSelector);
    }

    async function insertSuggestion(text, chatKey) {
      if (await isGlobalStopped()) return; // rukne ke baad draft bhi nahi
      if (chatKey && getChatKey() !== chatKey) {
        pendingSuggestions[chatKey] = text;
        return;
      }
      const composer = getComposer();
      if (composer && !composerHasText(composer)) {
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
