# Character Chatbot - local AI reply engine

> **Status (24 Oct 2026): PLATFORM ADAPTERS ABHI AVAILABLE NAHI HAIN.**
> Ye repo abhi ek **common engine** hai: character settings, local secure backend,
> BYOK AI connection, per-contact memory (optional), aur safety rails. Kisi bhi
> chatting website par chalne wala adapter is commit mein **shamil nahi** hai.
> Ise abhi "working extension" mat samjho - neeche "Platform status" padho.

Personal chatting apps mein ek AI character jo tumhari chosen chats mein replies
draft karega: naam, gender, role, tone, humour, reply length, topics, boundaries,
style examples - sab tum configure karte ho. Language/script match karta hai,
mood ke hisaab se serious/playful hota hai, "ruk jao" sunte hi rukta hai, aur
reply hamesha **suggestion** ke roop mein aati hai - send tum khud dabate ho.
Koi perfect-human claim nahi.

## Architecture (jo bana hai)

```
chat website  <--(platform adapter - NOT IMPLEMENTED)-->  extension
                                                             |
                                                background.js (bridge, token yahin rehta hai)
                                                             |
                                                   backend (Express, 127.0.0.1 only)
                                    prompt.js -> provider.js -> tumhara AI API (BYOK)
                                    memory.js -> MongoDB Atlas (OPTIONAL, per-contact memory)
```

- `extension/content/engine.js` - platform-agnostic engine: per-chat opt-in + recipient
  consent gate, burst batching (debounce), activation snapshot (purane messages trigger
  nahi hote), race-safe delivery, STOP ALL + in-flight cancel, suggestion-only
  (auto-send code nahi), AI marker har suggestion par.
- `extension/background.js` - content script aur backend ka bridge; authToken SIRF yahan.
- `extension/options/` - character settings + backend config + **live Preview** (dummy
  message par real API call) + **Stop all** button.
- `extension/test/` - engine ke jsdom fixture tests: **16/16 pass** (generic fake DOM;
  kisi platform ke selectors ka proof NAHI).
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
- `backend/test/` - **13/13 unit tests pass**.

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
npm test               # 13/13
npm start              # http://127.0.0.1:8787 (sirf tumhara laptop)
```

Extension: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
Options mein character bharo, backend URL + Auth token set karo, **Preview** se
dummy message par real reply dekho.

## Platform status (honest)

| Platform | Status | Kyun |
|---|---|---|
| Telegram Web | **On hold / not implemented** | Consent design ka final decision pending + live selector verification baaki. Terms review: telegram.org/tos/content-licensing, core.telegram.org/api/terms. |
| WhatsApp | **Removed** | Personal-account auto-messaging ban-risk; user ke request par hata diya. |
| Instagram / Facebook / Threads | **Not planned** | Meta ToS personal automation allow nahi karta. |

## Verified kya hai (aur kya nahi) - 24 Oct 2026

- Backend 13/13, extension 16/16 fixture tests pass.
- Backend/API dummy E2E: real Groq key se ek live /reply call verify (serious
  dummy chat par sahi Roman Hinglish empathetic reply). Ye live chat-product
  E2E NAHI hai - koi platform adapter nahi.
- MongoDB: real Node driver se dedicated free cluster par CRUD + least-privilege
  negative controls verify (sirf chatbot DB, admin/drop/dusri DB blocked).
- AI quality (dummy Hinglish chats, free models): persona settings behavior
  badalti hain (dry vs playful alag), stop-signal de-escalation kaam karti hai;
  LEKIN script-match kabhi-kabhi miss (Devanagari aa jaata hai), kuch benign
  requests par over-refusal, kabhi-kabhi gender slip. Ye known limitations hain.
- **NOT verified:** kisi bhi platform par live behavior. Koi real chat/message
  kabhi test ke liye use nahi hua. Koi auto-send nahi.

## Security & privacy

- Backend sirf `127.0.0.1` par sunta hai. Token auth + origin guard + rate limit.
- authToken kabhi page/content script ko nahi milta.
- Chat text sirf tumhare chosen AI provider ko jaata hai, woh bhi sirf jab tum
  us chat mein AI on karte ho AUR recipient consent confirm hota hai.
- Memory on ho to messages MongoDB mein ownerId+chatId ke saath store hote hain;
  off ho to kuch store nahi hota.
- `.env` gitignored; keys kabhi repo/chat/PDF mein mat likho.
