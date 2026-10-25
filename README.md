# Character Chatbot - local AI reply engine

> **Status (25 Oct 2026): Telegram Web adapter EXPERIMENTAL.**
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

## Architecture (jo bana hai)

```
chat website  <--(adapter: telegram.js EXPERIMENTAL)-->  extension
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
- `extension/test/` - engine ke jsdom fixture tests: **21/21 pass** (generic fake DOM;
  kisi platform ke selectors ka proof NAHI) + `e2e/` mein mock Telegram page par
  Playwright E2E (consent flow, suggestion, auto-send, non-open auto-open, stop
  gates - mock DOM ka proof, live Telegram ka NAHI).
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
| WhatsApp | **Removed** | Personal-account auto-messaging ban-risk; user ke request par hata diya. |
| Instagram DMs | **Researched - koi build nahi, user decision pending** | Do routes: (A) Official Instagram Send API - sirf professional (Business/Creator) account, `instagram_business_manage_messages` permission, recipient ka pehle message aana zaroori (Meta ka official Postman doc: postman.com/meta/instagram). Personal account par ye API nahi chalti. (B) telegram.js jaisa browser adapter - technically possible, lekin Meta ToS automated access restrict karta hai (logged-in bhi) aur enforcement risk hai; ye user ka explicit decision hoga. |
| Facebook Messenger | **Researched - koi build nahi, user decision pending** | (A) Official Messenger Platform API - Facebook Page + `pages_messaging` permission chahiye (Meta official Postman doc: postman.com/meta/messenger-platform-api); personal Messenger ke liye nahi. (B) Browser adapter - same ToS/enforcement exposure as Instagram. |
| Threads | **Researched - abhi koi API route exist nahi karta** | Meta ke official Threads API mein koi DM endpoint/permission nahi - sirf posts/replies/insights (postman.com/meta/threads). Web DMs abhi rollout mein hain (Threads boss Connor Hayes ka official post, threads.com/@conno_r/post/DX9yHGTDu7h). Sirf browser route bachta hai - undocumented DOM + same ToS exposure. |

## Verified kya hai (aur kya nahi) - 25 Oct 2026

- Backend 17/17, extension 21/21 fixture tests pass.
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
