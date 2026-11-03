// orbix.js - Orbix-specific adapter (SITE-GROUNDED contract; generic detection NAHI).
// Structure Nov 2 ko live read-only verify hua. Sirf expected
// structure par chalta hai; koi bhi mismatch/conflict BIND-TIME ya RUNTIME par = FAIL
// CLOSED (koi generic fallback nahi).
//
// Contract (grounded): host orbix-video-ly.web.app; thread = main.center .thread;
// rows = .thread > .msg, har row par EXACTLY ek of classes user|assistant; user row =
// single DIV.bubble, assistant row = DIV.steps + DIV.answer (+BUTTON.chip); composer =
// form.composer textarea; send = form.composer button.btn.primary; open chat marker =
// .chat-row.on (koi header/title element ya per-chat URL NAHI - verified).
//
// CHAT IDENTITY (v21, HOOK-CAPTURED response-body correlation - ZERO adapter reads):
// Site ka frontend har chat open par GET /api/chats/<24-hex chatId> fetch karta hai
// (Nov 2 live probe: click -> fresh fetch; back-switch -> REFETCH yani client cache
// nahi; hover prefetch nahi; polling nahi). v19 (adapter khud candidate fetch karta
// tha) aur v20 (FULL-LIST enumeration - HAR private chat ka read) dono main dwara
// reject ho chuke hain: unapproved scope/performance expansion. v21 mein adapter
// KHUD KOI API REQUEST NAHI KARTA. content/orbix-hook.js (MAIN world, document_start)
// site ke apne fetch/XHR responses passively capture karta hai aur body postMessage
// se adapter tak pahunchata hai.
//
// Identity = CONTENT correlation (order se nahi): jo captured response body CURRENT
// rendered thread se prefix-consistent (append-only dono direction) hai, wahi chat ka
// best evidence hai. YE PROOF NAHI HAI: hook ka capture sirf ye dikhata hai ki response
// PAGE KO mila - ye NAHI ki page ne usi response ko COMMIT kiya (discarded/aborted
// overlapping response, cache/bootstrap render, identical-content replacement sab
// possible hain). Jo prove hota hai: (a) 0 consistent capture = render ka koi observed
// network source nahi = BIND NAHI; (b) >1 = kaunsa source tha undecidable = FAIL-CLOSED;
// (c) exactly-1 = saari observed evidence is id ki taraf - baaqi uncertainty (neeche
// RESIDUALS) documented rehti hai. Correlation SYNCHRONOUS hai (koi async flight nahi) -
// "DOM verification ke beech badla" window exist nahi karti; har verdict (current DOM,
// current captures) ka atomic function hai.
// - exactly-1 consistent capture -> VERIFIED bind (log: CC_ORBIX bound verified chat)
// - >1 (identical/prefix-twin chats SESSION MEIN fetch ho chuki) -> AMBIGUOUS ->
//   fail-closed: engine stop, koi capture/provider/draft nahi (jab tak content
//   diverge na ho - divergence par automatic recovery)
// - 0 -> UNVERIFIED (fetch pending / fetch fail / site ne cache se render kiya -
//   future caching = fail-closed stuck, SAFE degradation) -> bind NAHI
// - getChatKey/preSendCheck HAR call par poora correlation dobara karte hain:
//   late-arriving identical twin ke baad verdict ambiguous = capture/provider/draft
//   turant BLOCK (sirf sends nahi - SAB kuch).
// Key = orbix:<docNonce>:<bootSeq>:<verifiedChatId> (nonce/seq = persisted consent
// kabhi inherit nahi hoti).
//
// RESIDUALS (documented, claimed-fixed NAHI - "cacheless aaj verified" koi INVARIANT
// nahi, sirf time-stamped observation hai):
// (1) Render ka source hook ke BINA aaye (cache/bootstrap payload - aaj absent, future
//     possible): koi consistent capture nahi = BIND NAHI (safe). PAR agar session mein
//     pehle fetch hua identical-content twin captured ho, stale twin render se match
//     kar sakta hai - pehli divergence/refetch par fail-closed.
// (2) Page ne response DISCARD karke doosre source se render kiya (overlapping
//     response abort/discard): discarded body render se match nahi karti = candidate
//     nahi; match karti hai to content-equivalent hi hai.
// (3) Identical-content replacement bina fetch ke (render text same, chat alag): DOM
//     mutation bhi same-text ho to detect hi nahi hota - ye fundamental hai. Mitigation:
//     consent EPHEMERAL hai (har bind nayi key; persisted consent KABHI apply nahi
//     hoti), content identical hone tak koi content leak nahi; pehli divergence par
//     correlation tut kar fail-closed.
// (4) MAIN world + postMessage bridge PAGE-CONTROLLED realm hai: page JS captures
//     forge/flood kar sakti hai. Forge ko RENDER se match karna zaroori hai (mismatch
//     = ignore); flood = sirf ambiguity badhati hai = fail-closed (DoS, safe direction).
//     Forged identity se consent KISI AUR chat ko transfer NAHI hoti: key mein chatId
//     + per-bind nonce/seq hote hain aur is adapter mein consent kabhi persist/restore
//     nahi hoti - har bind fresh prompt. Bridge pe koi token/credential NAHI jaata
//     (sirf response message bodies - page-visible data; in-memory document session
//     only; logs mein sirf chat id + seq).
// (5) Backend galat chat same id par serve kare = undetectable.
// (6) Identical-content chats JO session mein dono fetch ho chuke = fundamental
//     ambiguous (koi client logic unhe distinguish nahi kar sakta) = permanent
//     fail-closed jab tak diverge na hon.
//
// SEND-COMMIT SAFETY: switch/violation detect hone par SYNCHRONOUS invalidation
// (MutationObserver microtask = kisi bhi send timer se pehle): purana engine instance
// stop (epoch++ = in-flight discard) + adapter flag. Dobara, engine har AUTO send click
// se THEEK pehle config.preSendCheck() karta hai. Re-boot debounced hai, invalidation NAHI.
(function () {
  'use strict';
  if (!window.ChatEngine) return;

  const SEL = {
    thread: 'main.center .thread',
    rows: '.msg',
    composer: 'form.composer textarea',
    send: 'form.composer button.btn.primary',
    activeChatRow: '.chat-row.on',
    chatRow: '.chat-row',
  };
  const REBOOT_DEBOUNCE_MS = window.__CC_ORBIX_DEBOUNCE_MS || 400;

  function normTitle(s) {
    return String(s || '').replace(/[·×]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  function rowContractOk(thread) {
    const rows = Array.from(thread.querySelectorAll(':scope > .msg'));
    for (const r of rows) {
      const u = r.classList.contains('user'), a = r.classList.contains('assistant');
      if (u === a) return { ok: false, reason: 'row par user/assistant class conflict ya missing' };
      if (r.querySelector('[data-message-author-role], blockquote, [class*="quote"], [class*="reply"]')) {
        return { ok: false, reason: 'unexpected nested structure in row' };
      }
    }
    return { ok: true, rowCount: rows.length };
  }

  function validate() {
    if (location.hostname !== 'orbix-video-ly.web.app') return { ok: false, reason: 'host mismatch' };
    const thread = document.querySelector(SEL.thread);
    if (!thread) return { ok: false, reason: 'thread nahi mila', wait: true };
    const rc = rowContractOk(thread);
    if (!rc.ok) return { ok: false, reason: rc.reason + ' (fail-closed)' };
    if (rc.rowCount === 0) return { ok: false, reason: 'koi message row nahi (khaali/home view)', wait: true };
    if (document.querySelectorAll(SEL.composer).length !== 1) return { ok: false, reason: 'composer missing/ambiguous (fail-closed)' };
    if (document.querySelectorAll(SEL.send).length !== 1) return { ok: false, reason: 'send button missing/ambiguous (fail-closed)' };
    // Identity observability: sidebar list + active row DOM mein hone chahiye (naye home
    // view par ye Chats tab ke peeche hain). Bin inke consent isolate nahi ki ja sakti.
    if (!document.querySelector(SEL.chatRow)) return { ok: false, reason: 'sidebar list DOM mein nahi (identity observable nahi)', wait: true };
    if (!document.querySelector(SEL.activeChatRow)) return { ok: false, reason: 'koi active chat row nahi', wait: true };
    if (!idTracker.isAvailable()) return { ok: false, reason: 'page-world hook unavailable (response-body identity impossible - fail-closed)' };
    if (idTracker.isAmbiguous()) return { ok: false, reason: 'identity ambiguous (identical-content candidates) - fail-closed' };
    if (!idTracker.verifiedId()) return { ok: false, reason: 'chat id hook-captured response se verified nahi hui abhi', wait: true };
    return { ok: true };
  }

  // Pehla user message = thread-side identity anchor. Nov 2 PM drift: naye home view par
  // .chat-row DOM mein NAHI hota (Chats tab ke peeche), isliye sirf sidebar signals par
  // switch detection depend nahi kar sakta - anchor change bhi switch treat hota hai.
  function firstUserAnchor() {
    const el = document.querySelector('.thread > .msg.user .bubble');
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  }

  function activeIdentity() {
    const on = document.querySelector(SEL.activeChatRow);
    if (!on) return null;
    const title = normTitle(on.textContent);
    const same = Array.from(document.querySelectorAll(SEL.chatRow))
      .filter((r) => normTitle(r.textContent) === title);
    return { title, ordinal: Math.max(0, same.indexOf(on)) };
  }
  function identitySig(id) { return id ? id.title + '#' + id.ordinal : null; }

  // Per-document UNPREDICTABLE nonce: page reload par bhi purani key kabhi recur nahi
  // hoti (ek counter reload par reset ho jata hai - isliye counter akela kaafi nahi).
  // Iske bina reload ke baad same title/ordinal/anchor wali chat purani persisted
  // consent inherit kar sakti thi.
  const DOC_NONCE = (window.crypto && typeof window.crypto.randomUUID === 'function')
    ? window.crypto.randomUUID()
    : String(Date.now()) + '-' + String(Math.random()).slice(2);

  // ---------- hook-captured response-body identity (v21 - ZERO adapter reads) ----------
  // v19/v20 ke active authenticated API reads (candidate verify / full-list enumeration)
  // POORE hataye gaye. Captures content/orbix-hook.js (MAIN world) se aate hain.
  // Correlation synchronous + pure: verdict = f(current rendered DOM, session captures).
  // KOI timer/polling/epoch-cap/throttle ki zaroorat hi nahi - koi network cost nahi.
  const CHAT_ID_RE = /\/api\/chats\/([0-9a-f]{24})(?:[/?#]|$)/;
  const MAX_CANDIDATES = 200;

  function normMsgText(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function renderedMessages() {
    const thread = document.querySelector(SEL.thread);
    if (!thread) return null;
    return Array.from(thread.querySelectorAll(':scope > .msg')).map((r) => {
      const el = r.querySelector('.answer, .bubble');
      return {
        role: r.classList.contains('user') ? 'user' : (r.classList.contains('assistant') ? 'assistant' : '?'),
        text: normMsgText(el ? (el.innerText != null ? el.innerText : el.textContent) : ''),
      };
    });
  }

  // Append-only consistency (dono direction): common prefix equal = same conversation
  // ke alag snapshots. Prefix-TWIN (ek chat doosri ka strict prefix) bhi "consistent"
  // gina jayega = ambiguity (conservative - API-ahead ya render-ahead dono drift cover).
  function chatsConsistent(a, b) {
    if (!a || !b) return false;
    const n = Math.min(a.length, b.length);
    if (n === 0) return false;
    for (let i = 0; i < n; i++) {
      if (a[i].role !== b[i].role || a[i].text !== b[i].text) return false;
    }
    return true;
  }

  function sigOf(rendered) {
    if (!rendered || !rendered.length) return '';
    return rendered.length + '|' + (rendered[0] ? rendered[0].text : '') + '|' + (rendered[rendered.length - 1] ? rendered[rendered.length - 1].text : '');
  }

  const idTracker = (function () {
    // candidates: is DOCUMENT session mein hook ne capture kiye response bodies.
    // Switch/invalidate par CLEAR NAHI hote - pehle fetch hua identical-twin baad ke
    // render ki ambiguity ka EVIDENCE rehta hai (ye v19 ke "observed candidate"
    // hole ko band karta hai bina enumeration ke).
    const candidates = new Map(); // id -> [{role,text}...]
    let hookReady = false;
    let verifiedId = null;   // cached verdict (recompute points: capture, verify, invalidate)
    let ambiguous = false;
    let onChange = null;
    // DOM switch signal ke BAAD ka stale-render window: sidebar/anchor bolta hai doosri
    // chat active hai par thread abhi purana content dikhata hai (delayed React commit).
    // Is window mein correlation purane content ko purani id se re-verify kar DETA (galat).
    // Condemned sig = invalidate ke waqt ka rendered sig; verdict tab tak unverified jab
    // tak render BADAL na jaye YA koi FRESH capture current render ko explain na kare.
    let condemnedSig = null;

    function correlate() {
      const rendered = renderedMessages();
      if (!rendered || rendered.length === 0) return { state: 'unverified', matches: 0 };
      if (condemnedSig !== null && sigOf(rendered) === condemnedSig) return { state: 'unverified', matches: 0 }; // stale-render window
      let matches = 0;
      let matchId = null;
      for (const kv of candidates) {
        if (chatsConsistent(kv[1], rendered)) { matches++; matchId = kv[0]; }
      }
      if (matches === 1) return { state: 'verified', id: matchId, matches };
      if (matches > 1) return { state: 'ambiguous', matches };
      return { state: 'unverified', matches: 0 };
    }

    function applyVerdict(v) {
      const wasAmbig = ambiguous;
      if (v.state === 'verified') { verifiedId = v.id; ambiguous = false; }
      else if (v.state === 'ambiguous') {
        verifiedId = null; ambiguous = true;
        if (!wasAmbig) console.warn('CC_ORBIX identity AMBIGUOUS (session ke ' + v.matches + ' captured responses rendered se consistent) - fail-closed jab tak diverge na ho');
      } else { verifiedId = null; ambiguous = false; }
    }

    function settleSoon() {
      // v20 semantics preserve: onChange async settle signal (boot/restart decisions).
      if (onChange) setTimeout(() => { if (onChange) onChange('settled'); }, 0);
    }

    function capture(id, messages) {
      const msgs = messages.map((x) => ({ role: String((x && x.role) || ''), text: normMsgText(x && x.content) }));
      if (candidates.has(id)) candidates.delete(id); // refresh FIFO order
      candidates.set(id, msgs);
      if (candidates.size > MAX_CANDIDATES) {
        // Evict oldest - PAR current render se consistent candidate KABHI evict nahi
        // (warna ambiguity evidence khona = fail-open direction).
        const rendered = renderedMessages();
        for (const kv of candidates) {
          if (candidates.size <= MAX_CANDIDATES) break;
          if (rendered && chatsConsistent(kv[1], rendered)) continue;
          candidates.delete(kv[0]);
        }
      }
      // Fresh capture jo current render ko explain karti hai = transition complete
      // (ya same-chat refetch) - stale-window condemnation hatao, PHIR judge karo.
      const renderedNow = renderedMessages();
      if (condemnedSig !== null && renderedNow && chatsConsistent(msgs, renderedNow)) condemnedSig = null;
      applyVerdict(correlate());
      settleSoon();
    }

    // Hook bridge: MAIN world ke postMessage captures. Source validation: tag + shape.
    // (Same-origin page JS ye messages forge kar sakti hai - DOM bhi forge kar sakti
    // hai; ye site ke khilaaf boundary nahi, correctness mechanism hai.)
    window.addEventListener('message', (ev) => {
      const d = ev && ev.data;
      if (!d || d.__ccOrbixHook !== true) return;
      if (d.type === 'ready') { hookReady = true; return; }
      if (d.type === 'chat-response' && typeof d.id === 'string' && /^[0-9a-f]{24}$/.test(d.id) && Array.isArray(d.messages)) {
        hookReady = true;
        capture(d.id, d.messages);
      }
    });
    // Adapter document_idle par aata hai; initial page-load fetch pehle complete ho
    // chuka ho sakta hai - hook ke buffer ka replay maango.
    try { window.postMessage({ __ccOrbixHook: true, type: 'replay-request' }, location.origin); } catch (e) {}

    return {
      // Hook inject hua ya nahi (attr document_start par lagta hai; message bhi mark karta hai)
      isAvailable: () => hookReady || !!(document.documentElement && document.documentElement.hasAttribute('data-cc-orbix-hook')),
      verifiedId: () => verifiedId,
      isAmbiguous: () => ambiguous,
      // Synchronous recompute (v20 ka async enumeration ab kuch nahi bachta).
      verify: () => { applyVerdict(correlate()); settleSoon(); },
      // getChatKey/preSendCheck ka atomic full re-check.
      correlateNow: correlate,
      setOnChange: (fn) => { onChange = fn; },
      // DOM-side switch signal: verdict reset + current render CONDEMNED (stale window).
      // Candidates JAAN-BOOJH ke retained (twin ambiguity evidence).
      invalidate: () => {
        verifiedId = null; ambiguous = false;
        condemnedSig = sigOf(renderedMessages());
      },
    };
  })();

  // ---------- runtime lifecycle ----------
  let handle = null;
  let halted = false;            // contract violation = is page-load ke liye band
  let switchInvalidated = false; // switch detect -> reboot tak har send block
  let liveSeq = 0;               // har bind ka naya number; consent kabhi restore nahi
  let currentBoundId = null;     // is bound instance ki network chat id
  let currentSig = null;
  let currentAnchor = null;
  let activeEl = null;
  let rebootTimer = null;
  let watchersOn = false;

  function stopEngine() {
    if (handle && typeof handle.stop === 'function') handle.stop();
    handle = null;
  }

  // SYNCHRONOUS invalidation - MutationObserver microtask, kisi bhi send timer se pehle.
  function onMutation() {
    if (halted) return;
    const thread = document.querySelector(SEL.thread);
    if (thread && !rowContractOk(thread).ok) {
      halted = true;
      stopEngine();
      console.warn('CC_ORBIX runtime contract violation - engine halt (fail-closed): ' + rowContractOk(thread).reason);
      return;
    }
    // Observability lost = invalidate (sidebar unmount ya thread empty). Empty->repopulate
    // window bhi switch jaisi treat hoti hai - is window mein same-anchor replacement ka
    // bypass band rehta hai.
    const rowsNow = thread.querySelectorAll(':scope > .msg').length;
    const observabilityLost = !document.querySelector(SEL.chatRow) || rowsNow === 0;
    const on = document.querySelector(SEL.activeChatRow);
    const sig = identitySig(activeIdentity());
    const anchor = firstUserAnchor();
    // Anchor '' -> text (naya chat ka pehla message) switch NAHI; sirf non-empty anchor
    // ka BADALNA switch hai. Switch signals sirf pehli BIND ke BAAD meaningful hain
    // (initial render ke mutations switch nahi hain).
    const switchSignal = liveSeq > 0 && (observabilityLost || (activeEl && on !== activeEl) || (currentSig && sig !== currentSig) || (currentAnchor && anchor && anchor !== currentAnchor));
    if (switchSignal) {
      switchInvalidated = true; // koi in-flight/naya send/draft ab block
      // (c): tracker ki VERIFIED id bound id se already alag = ye DOM change naye chat ka
      // render hai (entry+verify pehle ho chuki) - identity INVALIDATE MAT karo, sirf
      // restart. Warna (handle nahi, ya verified identity wahi/nil) = poora identity
      // state reset (ambiguity bhi clear) - nayi identity sirf nayi fetch+verify se.
      const vid = idTracker.verifiedId();
      if (!handle || !vid || vid === currentBoundId) idTracker.invalidate();
      stopEngine();
      clearTimeout(rebootTimer);
      rebootTimer = setTimeout(boot, REBOOT_DEBOUNCE_MS); // sirf re-boot debounced
      return;
    }
    if (!handle) {
      // Instance pehle se band (switch/violation ke baad): signals wapas aane par jaldi reboot.
      if (switchInvalidated && !halted) { clearTimeout(rebootTimer); rebootTimer = setTimeout(boot, REBOOT_DEBOUNCE_MS); }
      // Ambiguous/unbound mein rendered DIVERGENCE (identical-twin mein append) se
      // identity dobara provable ho sakti hai. verify() ke andar sig-gate + throttle
      // + epoch-cap bounded hai (har mutation par enumeration NAHI).
      if (!halted && !idTracker.verifiedId()) idTracker.verify();
      return;
    }
  }

  function startWatchers() {
    if (watchersOn) return;
    watchersOn = true;
    // Ek body-level observer: sidebar ke UNMOUNT hone par bhi mutation milti hai (apne
    // subtree ka root hatne par uska apna observer fire NAHI karta - isliye stable
    // ancestor zaroori hai). onMutation cheap aur idempotent hai.
    new MutationObserver(onMutation).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  idTracker.setOnChange((kind) => {
    if (halted) return;
    if (kind === 'candidate') {
      // Naya id candidate: pehle content-verify hoga. Bound instance ko turant restart
      // NAHI karte - stale/inverted loser reject hona hai, sahi bound chat todna nahi.
      // Bound state mein boot no-op hai, isliye verify seedha chalao.
      // force: identical-content switch sig same rakhta hai; hint = naya network event.
      idTracker.verify(true);
      if (!handle) { clearTimeout(rebootTimer); rebootTimer = setTimeout(boot, REBOOT_DEBOUNCE_MS); }
      return;
    }
    // 'settled': verification round poora hua.
    if (handle && idTracker.isAmbiguous()) {
      switchInvalidated = true; // ambiguous identity = is instance ka koi kaam nahi
      stopEngine();
      return;
    }
    const vid = idTracker.verifiedId();
    if (handle && vid && vid !== currentBoundId) {
      // Verified identity bound chat se alag = asli switch jo DOM signal se miss hua.
      switchInvalidated = true;
      stopEngine();
      clearTimeout(rebootTimer);
      rebootTimer = setTimeout(boot, REBOOT_DEBOUNCE_MS);
    } else if (!handle) {
      // Pehli bind (initial load) par turant; switch-reboots debounced rehte hain.
      clearTimeout(rebootTimer);
      rebootTimer = setTimeout(boot, liveSeq === 0 ? 0 : REBOOT_DEBOUNCE_MS);
    }
  });

  function boot() {
    if (halted) return;
    if (handle) return; // instance already chal raha - stray wait-retry chain se DOUBLE-BOOT nahi
    const v = validate();
    if (!v.ok) {
      if (v.wait) {
        // Identity verdict dobara nikalo (sync; koi adapter API read NAHI) - settle par boot dobara.
        if (!idTracker.verifiedId()) idTracker.verify();
        setTimeout(boot, 2000);
        return;
      }
      console.warn('CC_ORBIX adapter fail-closed: ' + v.reason); // generic auto-detection par fallback NAHI
      return;
    }
    const seq = ++liveSeq; // naya bind = nayi key family = persisted consent apply NAHI hogi
    activeEl = document.querySelector(SEL.activeChatRow);
    currentSig = identitySig(activeIdentity());
    currentAnchor = firstUserAnchor();
    switchInvalidated = false;

    const boundChatId = idTracker.verifiedId(); // validate() ne presence ensure kiya
    currentBoundId = boundChatId;
    console.info('CC_ORBIX bound verified chat: ' + boundChatId + ' (seq ' + seq + ')');
    function getChatKey() {
      // Identity = hook-captured response se correlated owning-site chat id. Har call
      // par POORA correlation dobara (sync, atomic): drift (non-append change), late
      // identical twin (ambiguous), ya verdict change = null => engine capture/provider
      // request/draft KUCH nahi karega (fail-closed, sirf sends nahi).
      const v = idTracker.correlateNow();
      if (v.state !== 'verified' || v.id !== boundChatId) return null;
      return 'orbix:' + DOC_NONCE + ':' + seq + ':' + boundChatId;
    }

    handle = window.ChatEngine.createChatAssistant({
      // AUTO is adapter par DISABLED (main boundary Nov 2, reaffirmed Nov 3): v21
      // hook-captured correlation suggest scope ke liye identity deti hai, par AUTO
      // re-enable main ka decision hai - is build mein autoEnabled false hi rahega.
      // Suggestion mode (human-reviewed drafts) alag scoped hai aur chalta rahega.
      autoEnabled: false,
      getChatKey,
      rowsSelector: SEL.rows,
      // POSITIVE incoming evidence: sirf assistant-class row (conflict pehle hi halt).
      isIncoming: (row) => row.classList.contains('assistant') && !row.classList.contains('user'),
      getText: (row) => {
        const el = row.querySelector('.answer, .bubble');
        if (!el) return '';
        const txt = el.innerText != null ? el.innerText : el.textContent; // jsdom tests mein innerText nahi hota
        return String(txt || '');
      },
      composerSelector: SEL.composer,
      sendSelector: SEL.send,
      headerSelector: '.thread',
      footerSelector: 'form.composer',
      rootSelector: 'main.center',
      // Send click se THEEK pehle engine ka sync re-check (in-flight window close).
      preSendCheck: () => {
        if (seq !== liveSeq || halted || switchInvalidated) return false; // ye instance current nahi
        if (location.hostname !== 'orbix-video-ly.web.app') return false;
        const thread = document.querySelector(SEL.thread);
        if (!thread || !rowContractOk(thread).ok) return false;
        const on = document.querySelector(SEL.activeChatRow);
        if (!on || on !== activeEl) return false;
        if (identitySig(activeIdentity()) !== currentSig) return false;
        if (firstUserAnchor() !== currentAnchor) return false;
        if (thread.querySelectorAll(':scope > .msg').length === 0) return false; // empty thread = identity observable nahi
        if (!document.querySelector(SEL.chatRow)) return false; // sidebar unmounted
        if (document.querySelectorAll(SEL.send).length !== 1) return false;
        const cidv = idTracker.correlateNow(); // atomic full re-correlation
        if (cidv.state !== 'verified' || cidv.id !== boundChatId) return false; // identity badli/unknown/ambiguous
        return true;
      },
      consentMessage:
        'Is chat ke messages AI provider ko process karne hain?\n\n' +
        'Pehle saamne wale se EXPLICIT permission lo. Uske haan ke bina AI is chat mein kuch nahi karega. ' +
        'Woh kabhi bhi "stop" kahe to chat turant aur permanently band ho jayegi (fresh consent ke bina wapas nahi).',
      consentRequestText:
        'Heads up: main is chat mein AI-drafted replies use kar raha/rahi hoon - tumhare messages ek AI provider ko process honge. ' +
        'Theek hai? Kabhi bhi "stop" likhoge to turant band.',
      aiMarker: '',
    });
    startWatchers();
  }
  boot();
})();
