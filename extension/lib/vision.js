// lib/vision.js - chat screenshot ko structured messages mein badalta hai (vision LLM).
// Pure logic yahan hai (prompt build + response parse + provider resolve) taaki
// node unit tests bina browser/network ke chal sakein. Asli model call
// background.js LangChain layer (lib/vendor/langchain-vision.bundle.js) ya
// mock transport se hota hai.
//
// PRIVACY: screenshot sirf tab bheja jata hai jab user ne us chat par AI ON
// kiya ho (consent-active). Image crop consent-active chat area tak limited
// honi chahiye - poori screen nahi.
(function (root) {

// Vision model ko sirf JSON wapas chahiye. Sides: left = incoming (saamne
// wala), right = outgoing (owner). Ye contract parseVisionResponse enforce karta hai.
const VISION_PROMPT = [
  'You are reading a screenshot of a chat conversation.',
  'Extract every visible chat message as JSON and nothing else.',
  'Rules:',
  '- Output ONLY valid JSON, no markdown fences, no explanation.',
  '- Shape: {"messages":[{"side":"left"|"right","text":"..."}]}',
  '- side "left" = messages aligned to the left (incoming, the other person). side "right" = messages aligned to the right (outgoing, the account owner).',
  '- Keep message text exactly as seen, including language and emoji. Do not translate.',
  '- Order messages top-to-bottom as they appear.',
  '- Ignore UI chrome: headers, nav bars, tab bars, buttons, typing indicators, timestamps, ads, sidebars.',
  '- If you cannot clearly identify any chat messages, return {"messages":[]}.',
].join('\n');

const CF_DEFAULT_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

// cfg: { provider: 'cloudflare' | 'custom' | 'mock', apiKey, accountId, baseUrl, model, mockReply }
// cloudflare: OpenAI-compatible endpoint https://api.cloudflare.com/client/v4/accounts/<accountId>/ai/v1
// custom: koi bhi OpenAI-compatible vision endpoint (https only)
// mock: sirf tests/dummy - network call nahi hoti, mockReply parse ho jata hai
function resolveVisionProvider(cfg) {
  const provider = cfg && cfg.provider ? String(cfg.provider) : 'cloudflare';
  if (provider === 'mock') {
    if (typeof (cfg && cfg.mockReply) !== 'string') throw new Error('mock provider ke liye mockReply chahiye');
    return { provider, mockReply: cfg.mockReply };
  }
  const apiKey = String((cfg && cfg.apiKey) || '').trim();
  if (!apiKey) throw new Error('vision API key set nahi hai');
  if (provider === 'cloudflare') {
    const accountId = String((cfg && cfg.accountId) || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Cloudflare accountId (32 hex chars) chahiye');
    return {
      provider, apiKey, accountId,
      baseUrl: 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/ai/v1',
      model: String((cfg && cfg.model) || '').trim() || CF_DEFAULT_MODEL,
    };
  }
  if (provider === 'custom') {
    const baseUrl = String((cfg && cfg.baseUrl) || '').trim().replace(/\/+$/, '');
    const model = String((cfg && cfg.model) || '').trim();
    if (!/^https:\/\/[^\s]+$/i.test(baseUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(baseUrl)) throw new Error('vision custom base URL https:// se shuru hona chahiye');
    if (!model) throw new Error('vision custom provider ke liye model name chahiye');
    return { provider, apiKey, baseUrl, model };
  }
  throw new Error('vision provider unknown: ' + provider);
}

// OpenAI chat-completions multimodal content blocks (LangChain ChatOpenAI bhi
// yahi standard format bhejti hai).
function buildVisionMessages(imageBase64, mimeType) {
  const mime = /^image\/(png|jpeg|webp)$/i.test(mimeType || '') ? mimeType : 'image/jpeg';
  return [{
    role: 'user',
    content: [
      { type: 'text', text: VISION_PROMPT },
      { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + imageBase64 } },
    ],
  }];
}

// Model output -> validated messages. FAIL-CLOSED: JSON na mile, shape galat
// ho, ya koi message valid na ho to self-describing error throw karta hai
// (kuch bhi guess karke reply flow ko nahi deta).
function parseVisionResponse(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) throw new Error('vision parse failed: empty model output');
  // markdown fence ya leading/trailing text ho to JSON substring nikalo
  let jsonText = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonText = fence[1].trim();
  else if (jsonText[0] !== '{') {
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start >= 0 && end > start) jsonText = jsonText.slice(start, end + 1);
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error('vision parse failed: output JSON nahi hai (' + text.slice(0, 120) + ')');
  }
  const msgs = parsed && parsed.messages;
  if (!Array.isArray(msgs)) throw new Error('vision parse failed: "messages" array nahi mila');
  const out = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i] || {};
    const side = m.side === 'left' || m.side === 'right' ? m.side : null;
    const t = typeof m.text === 'string' ? m.text.trim() : '';
    if (!side || !t) {
      throw new Error('vision parse failed: message[' + i + '] invalid (side=' + JSON.stringify(m.side) + ', text length=' + t.length + ')');
    }
    out.push({ side, text: t });
  }
  return out;
}

// Vision output ko engine ke reply-format mein map karta hai:
// left (incoming) -> role user, right (owner) -> role assistant.
// Fail-closed: last message incoming hona chahiye, warna generateReply waise bhi rok dega.
function toChatMessages(visionMessages) {
  return (visionMessages || []).map((m) => ({ role: m.side === 'left' ? 'user' : 'assistant', content: m.text }));
}

root.CCVision = { VISION_PROMPT, CF_DEFAULT_MODEL, resolveVisionProvider, buildVisionMessages, parseVisionResponse, toChatMessages };
})(typeof self !== 'undefined' ? self : globalThis);
