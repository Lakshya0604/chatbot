# Character Chatbot - local AI reply engine

> **Status (26 Oct 2026): Telegram Web adapter EXPERIMENTAL; WhatsApp Web
> adapter NAYA - EXPERIMENTAL, mock-tested, live unverified, ban-risk ke saath
> (neeche "WhatsApp Web self-test" padho). CUSTOM mode + form auto-fill
> unit-tested. Kisi bhi site par bina test ke "working" claim nahi.**
> Engine + settings + backend + consent-gated suggestions AUR per-chat
> auto-replies ban chuke hain, dummy mock Telegram page par end-to-end tested
> (real Chromium, `extension/test/e2e/`). Adapter **live Telegram par verify
> NAHI** hai - selectors toot sakte hain; fail-closed design (identity/selector
> na mile to feature band). Ise "live Telegram par working" mat samjho -
> neeche "Platform status" padho.

Personal chatting apps mein ek AI character jo tumhari chosen chats mein replies
draft karega: naam, gender, role, tone, humour, reply length, topics, boundaries,
style examples - sab tum configure karte ho. Language/script match karta hai,
mood ke hisaab se serious/playful hota hai, "ruk jao" sunte hi rukta hai, aur
reply default **suggestion** ke roop mein aati hai (send tum khud dabate ho); consent-active
chat mein per-chat **Auto mode** on karne par naye incoming ka reply apne aap send hota
hai - user type kar raha ho, stop signal aaye, ya identity/state doubt ho to send NAHI.
Recipient consent gate hamesha mandatory hai; "ruk jao"/"stop" sunte hi chat permanently
band (fresh consent ke bina wapas nahi). Koi perfect-human claim nahi.

## Quick start (copy-ready) - 26 Oct 2026

**Zaroori cheezein:** ek laptop/PC (backend sirf 127.0.0.1 par, tumhari machine par
chalta hai - phone par nahi), Node.js 18+ (https://nodejs.org), Chrome.

```bash
# 1) Is File page se chatbot-package.zip download karo aur unzip karo
# 2) Backend setup + start (ek terminal mein chalta rahega)
cd chatbot/backend
npm install
cp .env.example .env
nano .env          # ya koi editor - neeche kya bharna hai likha hai
npm start          # "backend chal raha hai: http://127.0.0.1:8787" dikhna chahiye
```

`.env` mein yahi 4 cheezein matter karti hain:
- `AI_API_KEY=` - **ye credential tumhe khud bharna hai** (repo koi key bundle
  nahi karta): free key https://console.groq.com/keys se banao. Tumhari project
  key Instinct vault mein bhi saved hai - chaaho to wahi use karo, lekin use
  chat/PDF mein paste mat karo; khud copy karke .env mein daalo. Key ke bina
  asli AI replies nahi chalengi (flow test ke liye `AI_MOCK=true` kaafi hai).
- `AI_MOCK=false` - asli AI ke liye (fake test replies ke liye true rakho).
- `AUTH_TOKEN=<lambi random string>` - banao:
  `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
- `AI_MODEL=openai/gpt-oss-120b` - Groq par verified; default theek hai.

```bash
# 3) Extension load (Chrome mein)
#    chrome://extensions kholo -> Developer mode ON (top-right) ->
#    "Load unpacked" -> unzip kiye folder mein se chatbot/extension SELECT karo
# 4) Extension Options (puzzle icon -> Character Chatbot -> Options):
#    Backend URL: http://127.0.0.1:8787
#    Auth token: <.env ka AUTH_TOKEN wahi string>
#    Character settings bharo -> Save -> "Preview" se dummy reply test karo
```

Ab Telegram ke liye neeche "Live self-check" ya WhatsApp ke liye "WhatsApp Web
self-test" section follow karo. Backend band = extension kuch nahi karegi.

## Architecture (jo bana hai)

```
chat website  <--(adapter: telegram.js / whatsapp.js, dono EXPERIMENTAL)-->  extension
                                                             |
                                                background.js (bridge, token yahin rehta hai)
                                                             |
                                                   backend (Express, 127.0.0.1 only)
                                    prompt.js -> provider.js -> tumhara AI API (BYOK)
                                    memory.js -> MongoDB Atlas (OPTIONAL, per-contact memory)
```

- `extension/content/engine.js` - platform-agnostic engine: per-chat opt-in + recipient
  consent gate, burst batching (debounce), activation snapshot (purane messages trigger
  nahi hote), race-safe delivery, STOP ALL + in-flight cancel, per-chat AUTO mode
  (default suggest; auto sirf consent-active chat + khaali composer + last-moment
  state checks ke saath), AI marker har suggestion par.
- `extension/background.js` - content script aur backend ka bridge; authToken storage.local mein rehta hai, sirf yahin aur options page ke dummy preview mein use hota hai (engine/content script ise kabhi nahi padhta; website ke scripts extension storage tak pahunch nahi sakte).
- `extension/options/` - character settings + backend config + **live Preview** (dummy
  message par real API call) + **Stop all** button.
- `extension/content/adapters/telegram.js` - Telegram Web adapter (K/A versions ke
  best-known selectors, LIVE UNVERIFIED) + consent-active non-open chats ka chat-list
  watcher + auto-open (READ-RECEIPT caveat: auto-open Telegram ko read mark kara
  sakta hai).
- `extension/content/adapters/custom.js` + `custom-utils.js` - **CUSTOM mode
  (EXPERIMENTAL)**: extension toolbar button dabao -> picker se page par khud
  message bubble, apni outgoing message, typing box, (optional) send button aur
  (optional) chat title select karo -> profile sirf is device par save hoti hai
  (us origin ke liye) -> us site ki selected chat mein wahi consent-gated engine
  chalta hai. Toggle/banners ke liye floating panel. v1 sirf OPEN conversation
  dekhta hai (chat-list auto-open site-specific adapters tak hi). Hashed-class
  sites par selectors toot sakte hain (picker warning deta hai; dobara select
  karo). Canvas/cross-origin iframe/shadow-DOM chats par kaam nahi karega.
  Kisi site par kaam karne ka promise nahi - jo site test pass kare wahi "working".
- `extension/content/formfill.js` - **form auto-fill (review-first)**: right-click
  context menu -> "Form auto-fill". Sirf settings mein tumne jo `formProfile`
  details di hain wahi bharta hai (naam, email, phone, address, links, CTC,
  notice period...); kuch invent nahi karta. Password/OTP/card/PAN/Aadhaar jaise
  sensitive fields SKIP. Fill ke baad green highlight + review banner;
  **Submit KABHI nahi dabata** - review karke tum khud submit karte ho.
- `extension/test/` - engine ke jsdom fixture tests + custom-utils + formfill
  tests: **32/32 pass** (generic fake DOM; kisi platform ke selectors ka proof
  NAHI) + `e2e/` mein mock Telegram page par Playwright E2E (consent flow,
  suggestion, auto-send, non-open auto-open, stop gates - mock DOM ka proof,
  live Telegram ka NAHI).
- `backend/src/server.js` - POST /reply; token auth (401), origin guard (403),
  rate limit (429), loop guard, memory wiring (MONGODB_URI set ho tabhi).
- `backend/src/prompt.js` - character se system prompt: boundaries, language+script
  mirror (Roman Hinglish = Latin only), gender-grammar consistency, mood matching,
  consent-stop, injection guard.
- `backend/src/provider.js` - OpenAI-compatible call; max_completion_tokens 1024
  (reasoning models par low budget = empty/truncated reply, isliye), empty+length
  par explicit error, optional AI_REASONING_EFFORT, 30s timeout, test mock.
- `backend/src/memory.js` - per-contact memory MongoDB mein. ownerId SIRF token se
  derive hota hai (client claim par bharosa nahi) - doosre owner ka data koi caller
  nahi chhu sakta.
- `backend/test/` - **17/17 unit tests pass** + `integration.manual.mjs`: real
  mongod (mongodb-memory-server) ke saath /reply->store->isolation wiring test
  (dummy data; Atlas end-to-end ka substitute nahi).

## BYOK setup (apni AI key - free ya paid, tumhari choice)

Engine kisi bhi OpenAI-compatible provider se kaam karta hai. Free option ke liye
Groq test kiya gaya hai:

1. Key banao: https://console.groq.com/keys (Google/GitHub sign-in, free plan
   available - current limits console par check kar lena, badal sakte hain).
2. `backend/.env` mein:
   ```
   AI_BASE_URL=https://api.groq.com/openai/v1
   AI_API_KEY=tumhari_key
   AI_MODEL=openai/gpt-oss-120b     # is key par verified available
   AI_MOCK=false
   AUTH_TOKEN=<lambi random string>  # node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   # AI_REASONING_EFFORT=low        # optional: gpt-oss par fast/cheap
   ```
3. Doosra provider/model chahiye to AI_BASE_URL/AI_MODEL badal do - koi lock-in
   nahi. Key ka kharcha (free ya paid) end-user apna decide karta hai; repo koi
   key bundle nahi karta.

## Optional: per-contact memory (MongoDB Atlas)

- APNA dedicated free cluster banao (M0) - kisi doosre project ka cluster reuse
  mat karo. DB user ko sirf `readWrite` sirf `chatbot` DB par do (Atlas Admin
  mat do). Network access sirf apne IP tak limited rakho; 0.0.0.0/0 mat kholo.
- `.env`: `MONGODB_URI=mongodb+srv://...` aur `OWNER_TOKENS={"tumhara_AUTH_TOKEN":"tumhara_owner_id"}`.
- MONGODB_URI khaali rahe to memory poori tarah OFF rehti hai, reply feature
  unaffected.

## Chalane ka tareeqa

```bash
cd backend
npm install
cp .env.example .env   # upar wale values bharo
npm test               # 17/17
npm start              # http://127.0.0.1:8787 (sirf tumhara laptop)
```

Extension: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
Options mein character bharo, backend URL + Auth token set karo, **Preview** se
dummy message par real reply dekho.

### Live self-check (sabse safe Telegram validation - sirf tum, koi third party nahi)

Live Telegram par pehli baar verify karna ho to **Saved Messages** (apni khud ki
chat - koi aur person involved nahi) sabse safe jagah hai:

1. Backend mock mode mein chalao: `AI_MOCK=true npm start` (koi AI call nahi,
   fixed dummy reply).
2. `web.telegram.org` kholo, **Saved Messages** kholo.
3. Check karo: header mein `AI off` / `Stop all` / `Auto: off` buttons dikhne
   chahiye. Na dikhein to selectors live Telegram se match nahi kar rahe -
   adapter ko live DOM ke hisaab se update karna hoga (expected ho sakta hai,
   ye adapter live-unverified hai).
4. Dhyan do: Saved Messages mein tum jo bhi bhejte ho wo 'outgoing' hota hai,
   aur engine by design sirf INCOMING messages par react karta hai (apne
   messages par kabhi reply nahi). Isliye yahan sirf selectors/buttons validate
   honge - reply trigger NAHI hogi. Ye expected hai, bug nahi.
5. Poori pipeline (incoming -> suggestion/auto-send) live test karne ke liye
   incoming message chahiye. Bina kisi third party ke: BotFather se apna test
   bot banao (free, official Telegram feature) - bot ke chat mein bot ke replies
   incoming hote hain, wahan mock mode mein pipeline verify ho sakti hai.
6. Sab theek ho to `AI_MOCK` hata kar real backend par switch karo.

Is self-check mein koi third-party read/send nahi hota. Kisi real contact par
kabhi bhi on karne se pehle uski explicit consent lena mandatory hai.

## Platform status (honest)

| Platform | Status | Kyun |
|---|---|---|
| Telegram Web | **Adapter shipped - EXPERIMENTAL** | Mock page par E2E tested; live Telegram par selectors/behavior unverified. Consent gate mandatory: recipient ke explicit haan ke bina kuch process/send nahi. Auto-open read-receipt bhej sakta hai. Terms review: telegram.org/tos/content-licensing, core.telegram.org/api/terms. |
| WhatsApp Web | **Adapter shipped - EXPERIMENTAL (26 Oct)** | Mock WhatsApp page par E2E tested (consent, draft, AUTO send, STOP ALL pass); live WhatsApp Web par selectors/behavior UNVERIFIED. Meta/WhatsApp ToS unauthorized automation restrict karte hain - **account ban/mute ka real risk hai**, koi undetectability ya safety guarantee NAHI. Sirf open chat scope; kisi chat mein bina 2-click consent ke kuch nahi hota. Pehle apne aap/dummy se test karo. |
| Instagram DMs | **Researched - koi build nahi, user decision pending** | Do routes: (A) Official Instagram Send API - sirf professional (Business/Creator) account, `instagram_business_manage_messages` permission, recipient ka pehle message aana zaroori (Meta ka official Postman doc: postman.com/meta/instagram). Personal account par ye API nahi chalti. (B) telegram.js jaisa browser adapter - technically possible, lekin Meta ToS automated access restrict karta hai (logged-in bhi) aur enforcement risk hai; ye user ka explicit decision hoga. |
| Facebook Messenger | **Researched - koi build nahi, user decision pending** | (A) Official Messenger Platform API - Facebook Page + `pages_messaging` permission chahiye (Meta official Postman doc: postman.com/meta/messenger-platform-api); personal Messenger ke liye nahi. (B) Browser adapter - same ToS/enforcement exposure as Instagram. |
| Threads | **Researched - abhi koi API route exist nahi karta** | Meta ke official Threads API mein koi DM endpoint/permission nahi - sirf posts/replies/insights (postman.com/meta/threads). Web DMs abhi rollout mein hain (Threads boss Connor Hayes ka official post, threads.com/@conno_r/post/DX9yHGTDu7h). Sirf browser route bachta hai - undocumented DOM + same ToS exposure. |

## WhatsApp Web self-test (EXPERIMENTAL - apne risk par)

User ke explicit request par WhatsApp adapter banaya gaya hai. Ye live WhatsApp
par UNVERIFIED hai aur Meta/WhatsApp unauthorized automation par account
ban/mute kar sakte hain. Agar test karna hai:

1. Backend chalu rakho (neeche "Chalane ka tareeqa") - bina backend ke kuch nahi hoga.
2. chrome://extensions -> Load unpacked -> `extension/` (is build mein
   web.whatsapp.com content script pehle se shaamil hai).
3. web.whatsapp.com kholo aur EK chat kholo (pehle koi low-stakes chat ya apna
   doosra number). Adapter sirf KHULI chat par kaam karta hai.
4. Header mein AI toggle dabao -> 2-step consent: pehle saamne wale se explicit
   haan lo, tabhi confirm karo. Bina consent ke extension kuch process/send
   nahi karti.
5. Default SUGGEST mode: naye incoming ka draft composer mein aayega - padho,
   edit karo, KHUD send dabao. AUTO mode sirf tab on karo jab suggest flow
   stable lage; AUTO mein bhi composer mein text ho, stop-word aaye, ya state
   doubt ho to send nahi hota.
6. STOP ALL = emergency brake (har chat ke liye ek click mein sab ruk jata hai).
7. Agar selectors toote (draft na aaye / banner error) ya WhatsApp koi warning
   dikhaye, turant AI off karo. Ban/warning ki zimmedari user ki hai - ye
   tool koi guarantee nahi deta.

## Verified kya hai (aur kya nahi) - 26 Oct 2026

- Backend 17/17, extension 38/38 tests pass (26 Oct, WhatsApp build ke saath).
- Mock WhatsApp E2E (real Chromium + extension + backend mock mode): 2-step
  consent, incoming par draft suggestion (auto-send NAHI), AUTO mode par 1
  auto-send, thread update, composer clear, STOP ALL block - sab pass
  (`extension/test/e2e/e2e-whatsapp.cjs`). Mock DOM ka proof hai, live
  WhatsApp Web ka NAHI.
- Orbix (dummy chat site, dummy account) live proofs 26 Oct re-verified:
  picker/profile (2a), active-AUTO first-bind par ZERO unsolicited draft/send,
  naye incoming par EXACTLY 1 auto-send, reload+reopen par ZERO replay (2j) -
  server-side message counts se audit ke saath. Dummy site ka proof hai.
- Engine bugfix (26 Oct): activation/stop snapshot ab first-bind priming ka
  baseline banata hai, LEKIN sirf jab messages actually render ho chuke hon -
  warna hash-router sites (ek chatKey sab screens ka) par home-screen snapshot
  priming kha jaata aur khuli chat ki history trigger ban jaati (2j regression
  se pakda gaya, fix ke baad poori matrix green).
- Mock Telegram E2E (real Chromium + extension + backend mock mode): consent flow,
  suggestion insert, AUTO send, non-open chat auto-open + suggestion, stop-word
  gate, STOP ALL - sab pass. Mock DOM ka proof hai, live Telegram ka NAHI.
- Memory: real mongod par /reply->store->isolation integration test pass (dummy);
  Atlas cluster par real driver CRUD Oct 24 verify (dummy); /reply->Atlas live
  run laptop setup par hoga (IP allowlist + creds user-side).
- Backend/API dummy E2E: real Groq key se ek live /reply call verify (serious
  dummy chat par sahi Roman Hinglish empathetic reply). Ye live chat-product
  E2E NAHI hai - koi platform adapter nahi.
- MongoDB: real Node driver se dedicated free cluster par CRUD + least-privilege
  negative controls verify (sirf chatbot DB, admin/drop/dusri DB blocked).
- AI quality (dummy Hinglish chats, free models): persona settings behavior
  badalti hain (dry vs playful alag), stop-signal de-escalation kaam karti hai;
  LEKIN script-match kabhi-kabhi miss (Devanagari aa jaata hai), kuch benign
  requests par over-refusal, kabhi-kabhi gender slip. Ye known limitations hain.
- **NOT verified:** kisi bhi platform par LIVE behavior. Koi real chat/message
  kabhi test ke liye use nahi hua. Auto-send mock par verified hai; live Telegram
  par pehli baar chalane se pehle selectors verify karne honge, aur har chat ke
  recipient ki explicit consent user khud lega - ye live-use decision hai.

## Security & privacy

- Backend sirf `127.0.0.1` par sunta hai. Token auth + origin guard + rate limit.
- authToken kabhi page/content script ko nahi milta.
- Chat text sirf tumhare chosen AI provider ko jaata hai, woh bhi sirf jab tum
  us chat mein AI on karte ho AUR recipient consent confirm hota hai.
- Memory on ho to messages MongoDB mein ownerId+chatId ke saath store hote hain;
  off ho to kuch store nahi hota.
- `.env` gitignored; keys kabhi repo/chat/PDF mein mat likho.
