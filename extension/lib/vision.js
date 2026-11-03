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

const CF_DEFAULT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

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


// ---------- TRANSCRIPT mode (v0.8.1) ----------
// Live test 2026-10-28 (Cloudflare llama-3.2-11b-vision): model ka left/right
// label UNRELIABLE nikla (same screenshot par 5 mein se 2 baar pehla message
// "right"), isliye vision se DIRECTION kabhi decide nahi hoti. Direction DOM
// (marker/alignment) se aati hai; vision sirf independent TRANSCRIPT deta hai
// jisse hum verify karte hain ki DOM ne jo "last incoming" padha wahi screen par
// sach mein sabse aakhri visible message hai.
const VISION_TRANSCRIBE_PROMPT = [
  'You are reading a screenshot of a chat conversation.',
  'Transcribe every visible chat message bubble, top to bottom, as JSON and nothing else.',
  'Rules:',
  '- Output ONLY valid JSON: {"messages":[{"text":"..."}]}. No markdown, no explanation.',
  '- Keep each message text exactly as seen (same language, same spelling, emoji included). Do not translate.',
  '- One entry per bubble. Ignore headers, buttons, timestamps, typing indicators, sidebars.',
  '- If you cannot clearly see any chat message, return {"messages":[]}.',
].join('\n');

function buildTranscribeMessages(imageBase64, mimeType) {
  const m = buildVisionMessages(imageBase64, mimeType);
  m[0].content[0].text = VISION_TRANSCRIBE_PROMPT;
  return m;
}

function parseTranscriptResponse(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) throw new Error('vision parse failed: empty model output');
  let jsonText = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonText = fence[1].trim();
  else if (jsonText[0] !== '{') {
    const a = jsonText.indexOf('{'), b = jsonText.lastIndexOf('}');
    if (a >= 0 && b > a) jsonText = jsonText.slice(a, b + 1);
  }
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch (e) { throw new Error('vision parse failed: output JSON nahi hai (' + text.slice(0, 120) + ')'); }
  const msgs = parsed && parsed.messages;
  if (!Array.isArray(msgs)) throw new Error('vision parse failed: "messages" array nahi mila');
  return msgs.map((m, i) => {
    const t = m && typeof m.text === 'string' ? m.text.trim() : '';
    if (!t) throw new Error('vision parse failed: message[' + i + '] text khaali');
    return t;
  });
}

// Text compare: case/punctuation/emoji ignore (model aksar emoji gira deta hai).
function normText(s) {
  // NFC: same abstract text ke alag Unicode encodings (composed vs decomposed matras)
  // ko unify karta hai - alag text ko same NAHI karta (canonical equivalence only).
  return String(s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
// Critical tokens: digits (amounts/dates, Devanagari digits ASCII-normalized) aur
// negation/polarity words. Inme ek bhi farq = alag message (fail closed). Ye fuzzy
// overlap ke andar bhi enforce hota hai - lambe message mein 37/38 token milne par bhi
// "nahi" ka hona/na hona ya amount ka badalna match ko reject karega. Number WORDS
// (अट्ठाईस/अड़तिस) is rule mein nahi hain - vision unhe kabhi-kabhi alag likhta hai,
// wo documented residual risk hai (sirf actual digits + polarity enforce hoti hai).
const NEG_TOKENS = new Set(['नहीं', 'नही', 'ना', 'मत', 'न', 'not', 'no', 'never', 'dont', 'cant', 'cannot', 'nahi', 'nhi', 'nahin', 'mat']);
const DEV_DIGITS = '०१२३४५६७८९';
function criticalTokens(x) {
  const toks = x.split(' ').filter(Boolean);
  const out = [];
  for (const t of toks) {
    const d = t.replace(/[०-९]/g, (c) => String(DEV_DIGITS.indexOf(c)));
    if (/\d/.test(d)) out.push('D:' + d);
    else if (NEG_TOKENS.has(t)) out.push('N:' + t);
  }
  return out.sort();
}
function isSubMultiset(small, big) {
  const counts = {};
  for (const t of big) counts[t] = (counts[t] || 0) + 1;
  for (const t of small) { if (!counts[t]) return false; counts[t]--; }
  return true;
}
// Same-coverage comparisons (dono texts lagbhag same lambai) mein critical tokens EXACT
// equal hone chahiye: single negation/amount/date flip reject. Partial-capture slice
// (chhota text, <80% lambai) us hisse ka subset ho sakta hai - us case mein subset allow,
// kyunki slice mein poora message cover nahi hota. Noise critical token par pade to
// reject hota hai (fail-closed, safe direction).
function criticalCompatible(x, y) {
  const cx = criticalTokens(x), cy = criticalTokens(y);
  const shorter = cx.length <= cy.length ? [cx, cy] : [cy, cx];
  const lenRatio = Math.min(x.length, y.length) / Math.max(x.length, y.length);
  if (Math.max(x.length, y.length) < 120 || lenRatio >= 0.9) return cx.join(',') === cy.join(','); // chhote texts par hamesha exact critical equality (partial-capture sirf lambe messages mein aata hai)
  return isSubMultiset(shorter[0], shorter[1]);
}
function textsMatch(a, b) {
  const x = normText(a), y = normText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const sx = x.replace(/ /g, ''), sy = y.replace(/ /g, '');
  if (sx.length >= 6 && sy.length >= 6 && (sx.includes(sy) || sy.includes(sx))) return true;
  // Fuzzy path par bhi critical-token check zaroori (negation/amount/date flip = reject).
  if (!criticalCompatible(x, y)) return false;
  const tx = new Set(x.split(' ')), ty = new Set(y.split(' '));
  let common = 0; tx.forEach((t) => { if (ty.has(t)) common++; });
  return common / Math.max(tx.size, ty.size) >= 0.75;
}
// Gate: DOM ne jo last incoming padha wo vision transcript ke aakhri 2 messages mein hona chahiye.
// FAIL-CLOSED: transcript khaali ya match nahi -> { ok:false, reason }.
function verifyLastMessage(transcript, domLastText) {
  if (!Array.isArray(transcript) || transcript.length === 0) return { ok: false, reason: 'vision ko screenshot mein koi message nahi dikha' };
  const tail = transcript.slice(-2);
  const hit = tail.some((t) => textsMatch(t, domLastText));
  return hit ? { ok: true } : { ok: false, reason: 'DOM ka last message screenshot ke aakhri messages se match nahi hua (dom ' + String(domLastText || '').length + ' chars, screenshot mein ' + transcript.length + ' msgs, aakhri ' + String(tail[tail.length - 1] || '').length + ' chars)' };
}

root.CCVision = { VISION_TRANSCRIBE_PROMPT, criticalTokens, criticalCompatible, buildTranscribeMessages, parseTranscriptResponse, normText, textsMatch, verifyLastMessage, VISION_PROMPT, CF_DEFAULT_MODEL, resolveVisionProvider, buildVisionMessages, parseVisionResponse, toChatMessages };
})(typeof self !== 'undefined' ? self : globalThis);
