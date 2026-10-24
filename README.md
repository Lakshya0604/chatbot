# Character Chatbot - local AI reply engine

> **Status (24 Oct 2026): PLATFORM ADAPTERS ABHI AVAILABLE NAHI HAIN.**
> Ye repo abhi ek **common engine** hai: character settings, local secure backend,
> BYOK AI connection, aur safety rails. Kisi bhi chatting website (Telegram,
> WhatsApp, etc.) par chalne wala adapter is commit mein **shamil nahi** hai -
> neeche "Platform status" padho. Ise abhi "working extension" mat samjho.

Personal chatting apps mein ek AI character jo tumhari chosen chats mein
replies draft karega: naam, role, tone, humour, reply length, topics,
boundaries, style examples - sab tum configure karte ho. Language/script aur
mood match karta hai, sarcasm/ambiguity par guess ki jagah clarify karta hai,
aur "ruk jao" sunte hi rukta hai. Koi perfect-human claim nahi.

## Architecture (jo bana hai)

```
chat website  <--(platform adapter - NOT IMPLEMENTED)-->  extension
                                                             |
                                                background.js (bridge, token yahin rehta hai)
                                                             |
                                                   backend (Express, 127.0.0.1 only)
                                                  prompt.js -> provider.js -> tumhara AI API (BYOK)
```

- `extension/manifest.json` - MV3 registration (koi platform adapter abhi registered nahi)
- `extension/content/engine.js` - platform-agnostic assistant engine: per-chat opt-in + consent,
  batching, race-safe delivery (reply galat chat mein kabhi nahi), fail-closed identity,
  suggestion-only (auto-send code nahi). Kisi website ke selectors isme NAHI hain.
- `extension/background.js` - content script aur backend ka bridge; authToken SIRF yahan; 45s timeout
- `extension/options/` - character + backend settings page (chrome.storage.sync)
- `extension/test/` - engine ke jsdom fixture tests (generic fake DOM, 6/6 pass)
- `backend/src/server.js` - POST /reply; origin guard (server-side 403), token auth (401), rate limit (429), loop guard
- `backend/src/prompt.js` - character se system prompt (boundaries, language-mirror, consent-stop, injection guard)
- `backend/src/provider.js` - OpenAI-compatible call + 30s timeout + test mock

## Platform status (honest)

| Platform | Status | Kyun |
|---|---|---|
| Telegram Web | **Blocked / not implemented** | Telegram ki Content Licensing & AI Scraping Terms (API ToS 1.5, core.telegram.org/api/terms) AI ke "deployment" mein platform data ka use prohibit karti hain - personal AI replies iske andar aate hain ya nahi, text se clear nahi. Live selector verification bhi pending (login ke bina possible nahi). |
| WhatsApp | **Removed** | Personal-account auto-messaging WhatsApp ToS ke against hai, account-ban risk (whatsapp.com/legal/messaging-guidelines). User ke request par adapter hata diya; history mein hai (commit 678076e tak). |
| Instagram / Facebook / Threads | **Not planned for personal use** | Meta ToS automated access/collection bina permission ke prohibit karta hai; official messaging APIs sirf Business accounts ke liye hain. |

## Chalane ka tareeqa (common engine)

```bash
cd backend
npm install
cp .env.example .env
# .env mein:
#   1) AUTH_TOKEN banao:  node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
#      (yehi token extension Options > Auth token mein bhi paste karna hai)
#   2) AI_MOCK=true rakho (bina key ke test) ya apni AI key daalo (BYOK)
npm test    # 8 unit tests
npm start   # http://127.0.0.1:8787 (sirf tumhara laptop)
```

Extension load karna (abhi sirf options page kaam karega):
`chrome://extensions` → Developer mode on → Load unpacked → `extension/` folder.
Options mein character bharo, backend URL `http://127.0.0.1:8787`, wahi Auth token.

## Security & privacy (jo engine mein pehle se hai)

- Backend sirf `127.0.0.1` par sunta hai (LAN se unreachable).
- `/reply` par shared-secret token (401), non-extension Origin par server-side 403,
  30 req/min rate limit (429), 30s provider timeout (504).
- authToken kabhi page/content script ko nahi milta - sirf background worker padhta hai.
- Koi message store nahi hota; chat text sirf tumhare chosen AI provider ko jaata hai.
- Pehli baar kisi chat ko enable karne par explicit consent dialog (chat data device
  se bahar jaata hai) - ye adapter ke saath wapas aayega.
- `.env` gitignored hai; API keys kabhi code/chat mein mat likho.

## Verified kya hai (aur kya nahi)

- Backend: 8/8 unit tests; curl se verify: 401 (no/wrong token), 403 (non-extension
  origin, server-side reject), 429 (31st request), health, mock end-to-end.
- Engine (race-safe cross-chat delivery, fail-closed identity, token isolation,
  banner fallback, disabled/duplicate guards): jsdom fixture tests 6/6 pass -
  `cd extension/test && npm install && npm test` (generic fake DOM; kisi platform
  ke selectors ka proof NAHI).
- **NOT verified:** kisi bhi platform par live behavior. Koi real chat/message
  kabhi test ke liye use nahi hua.
