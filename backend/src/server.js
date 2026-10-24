// server.js - backend ka entry point.
// Express server jo POST /reply par character + chat context leta hai
// aur AI ki reply deta hai.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { buildMessages } from './prompt.js';
import { callChatCompletion, mockReply } from './provider.js';

const app = express();

// Origin guard: kisi random website se aayi browser-request is local server ko
// call na kar sake. Sirf extension (chrome-extension://) allowed hai.
// Bina Origin header wali requests (curl, server-to-server) ko token check pakadta hai.
// NOTE: cors package sirf response header deta hai - request ko server-side ROKNE
// ke liye ye explicit 403 middleware hai.
const ALLOWED_ORIGIN = /^chrome-extension:\/\//;
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && !ALLOWED_ORIGIN.test(origin)) {
    return res.status(403).json({ error: 'forbidden origin' });
  }
  return next();
});
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: '256kb' }));

// Simple in-memory rate limit: 30 requests/minute per IP.
// Local server hai, phir bhi koi buggy loop AI credit kha na jaaye.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;
const hits = new Map(); // ip -> [timestamps]
app.use('/reply', (req, res, next) => {
  const now = Date.now();
  const list = (hits.get(req.ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) {
    return res.status(429).json({ error: 'rate limit: thodi der baad try karo' });
  }
  list.push(now);
  hits.set(req.ip, list);
  return next();
});

const PORT = Number(process.env.PORT) || 8787;
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1';
const AI_MODEL = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MOCK = process.env.AI_MOCK === 'true';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS) || 30000;

// Health check - extension/terminal se backend zinda hai ya nahi dekhne ke liye.
app.get('/health', (req, res) => {
  res.json({ ok: true, mock: AI_MOCK });
});

app.post('/reply', async (req, res) => {
  const { character, messages } = req.body || {};

  // Shared-secret check: .env ka AUTH_TOKEN aur extension ka token match hona chahiye.
  // Isse koi aur app tumhare local backend (aur AI credit) use nahi kar sakti.
  // Mock mode mein bhi token chahiye - test setup aur real setup ka behavior same rahe.
  if (AUTH_TOKEN && req.get('X-Chatbot-Token') !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'unauthorized: token mismatch' });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const finalMessages = buildMessages(character, messages);

  // Loop prevention: agar last message incoming (user) nahi hai, reply ka koi matlab nahi.
  if (finalMessages[finalMessages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'last message must be from the other person (role: user)' });
  }

  try {
    const reply = AI_MOCK
      ? mockReply(finalMessages)
      : await callChatCompletion({
          baseUrl: AI_BASE_URL,
          apiKey: AI_API_KEY,
          model: AI_MODEL,
          messages: finalMessages,
          timeoutMs: PROVIDER_TIMEOUT_MS,
        });

    if (!reply) {
      return res.status(502).json({ error: 'AI ne khaali reply di' });
    }
    return res.json({ reply });
  } catch (err) {
    // Provider timeout ko 504, baaki provider errors ko 502 - extension banner mein reason dikhta hai.
    const msg = String((err && err.message) || err);
    if (msg.includes('timeout')) return res.status(504).json({ error: msg });
    return res.status(502).json({ error: msg });
  }
});

// Sirf isi laptop par sunna hai - 127.0.0.1. 0.0.0.0 par bind karne se
// same network (Wi-Fi) wale log bhi is server ko call kar sakte the.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`backend chal raha hai: http://127.0.0.1:${PORT} (mock: ${AI_MOCK})`);
  if (!AI_MOCK && !AI_API_KEY) {
    console.warn('WARNING: AI_API_KEY set nahi hai. .env mein key dalo, ya test ke liye AI_MOCK=true rakho.');
  }
});
