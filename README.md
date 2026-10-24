# Character Chatbot (WhatsApp Web, suggestion mode)

A Chrome extension + small Node backend that drafts AI replies **as suggestions** inside
WhatsApp Web, in a character you configure: naam, role, tone, humour, reply length,
topics, boundaries, aur tumhare apne style examples.

**Auto-send is OFF.** The AI writes into the typing box as a suggestion. You read it,
edit it if you want, and press send yourself. No message ever goes out on its own.

## How it works

1. The extension's content script watches the open WhatsApp Web chat (MutationObserver).
2. When the other person sends messages, it waits for a short silence window and batches
   back-to-back messages into one input.
3. It collects the last 20 messages (with who-sent-what) and sends them to the backend.
4. The backend builds a system prompt from your character settings and calls an
   OpenAI-compatible AI API.
5. The reply comes back and is inserted into the typing box as a suggestion. Send stays
   with you.

Language and mood matching are part of the character prompt: the reply follows the other
person's language and script (Hindi / Roman Hinglish / English), matches jokes with
playful replies, and de-escalates when the other person is uncomfortable or says stop.
Sarcasm and double meanings can still fool the AI; when unsure it is instructed to reply
neutrally or ask a short clarifying question.

## Project layout

```
extension/            Chrome extension (Manifest V3, no build step)
  manifest.json       Extension registration: permissions, content script, options page
  background.js       Service worker: bridge between content script and backend
  content/whatsapp.js Watches chats, batches messages, inserts suggestions
  content/whatsapp.css
  options/            Character settings page (saved in chrome.storage.sync)
backend/              Node + Express server
  src/prompt.js       Builds the system prompt from character settings
  src/provider.js     OpenAI-compatible API call (+ mock mode for testing)
  src/server.js       POST /reply endpoint
  test/               Unit tests (node:test, no extra deps)
```

## Setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env   # phir .env mein apni AI_API_KEY dalo
npm start              # http://localhost:8787
```

Test without any API key: keep `AI_MOCK=true` in `.env`; the backend returns a fake
echo reply so you can verify the whole flow.

Run unit tests: `npm test`

### 2. Extension

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top right).
3. **Load unpacked** and select the `extension/` folder.
4. Open the extension's **Options** page and fill in the character settings.
5. Open `web.whatsapp.com`, open a chat, and click the **AI off** button in the chat
   header to turn it on for that chat only.

## Provider and cost

The backend talks to any OpenAI-compatible chat completions API (set `AI_BASE_URL`,
`AI_MODEL`, `AI_API_KEY` in `.env`). The default values point at Groq as an example.
**The provider choice, free tier and cost are not final yet** - verify current pricing
and limits before relying on them. The extension never charges anything by itself.

## Security and privacy

- The backend binds to **127.0.0.1 only** - your own laptop. It is not reachable from
  your Wi-Fi network or the internet.
- Set `AUTH_TOKEN` in `.env` and the same value in the extension Options page. The
  backend then rejects every request without that token, so no random website you visit
  can call your local backend or spend your AI credit. CORS also only allows
  chrome-extension:// origins.
- **Chat data consent:** the first time you turn AI on for a chat, the extension asks
  for an explicit OK. Only that chat's messages, and only while AI is on, go to the
  backend and the AI provider.
- Character settings and style examples live in Chrome sync storage under your own
  Google account. Style examples are prompts, so treat them as private text.
- Prompt-injection guard: the system prompt tells the AI that chat messages are data,
  never instructions - a message saying "ignore your rules" is answered in character,
  not obeyed.

## Honest limits

- Works on **WhatsApp Web only**. Telegram Web or any other site needs its own adapter;
  nothing else is tested or claimed.
- WhatsApp Web can change its page structure (DOM) any time; the selectors in
  `content/whatsapp.js` may then need an update.
- Your laptop must be on, Chrome open, and the backend running.
- This is not an official WhatsApp/Meta feature. Heavy automation can risk account
  restrictions; suggestion mode keeps a human on every send.
- Character is fictional. Do not configure it to impersonate a real person.
- Only the prompt pipeline and server endpoints are unit/integration tested in mock
  mode (7+ tests passing). The WhatsApp Web selectors in `content/whatsapp.js` are
  written against WhatsApp Web's known DOM structure but are **not yet verified in a
  live browser session** - first real run may need selector tweaks. No real messages
  were sent or used in testing.

## Safety defaults

- Auto-send OFF (no code path sends a message).
- Per-chat on/off toggle.
- Loop prevention: the extension only reacts to incoming messages and the backend
  rejects requests whose last message is not incoming.
- Your typed text is never overwritten: if the typing box already has text, the
  suggestion shows in a banner instead.
