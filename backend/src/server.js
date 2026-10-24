// server.js - backend ka entry point.
// Express server jo POST /reply par character + chat context leta hai
// aur AI ki reply deta hai.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { buildMessages } from './prompt.js';
import { callChatCompletion, mockReply } from './provider.js';

const app = express();
// Sirf extension (chrome-extension:// origin) ya local tools (no origin, jaise curl) allow.
// Kisi random website se aayi request is local server ko call na kar sake.
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origin.startsWith('chrome-extension://')) return cb(null, true);
    return cb(new Error('origin not allowed'));
  },
}));
app.use(express.json({ limit: '256kb' }));

const PORT = Number(process.env.PORT) || 8787;
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1';
const AI_MODEL = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MOCK = process.env.AI_MOCK === 'true';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

// Health check - extension/terminal se backend zinda hai ya nahi dekhne ke liye.
app.get('/health', (req, res) => {
  res.json({ ok: true, mock: AI_MOCK });
});

app.post('/reply', async (req, res) => {
  const { character, messages } = req.body || {};

  // Shared-secret check: .env ka AUTH_TOKEN aur extension ka token match hona chahiye.
  // Isse koi aur website/app tumhare local backend (aur AI credit) use nahi kar sakti.
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
        });

    if (!reply) {
      return res.status(502).json({ error: 'AI ne khaali reply di' });
    }
    return res.json({ reply });
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
});

// Sirf isi laptop par sunna hai - 127.0.0.1. 0.0.0.0 par bind karne se
// same network (Wi-Fi) wale log bhi is server ko call kar sakte the.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`backend chal raha hai: http://localhost:${PORT} (mock: ${AI_MOCK})`);
  if (!AI_MOCK && !AI_API_KEY) {
    console.warn('WARNING: AI_API_KEY set nahi hai. .env mein key dalo, ya test ke liye AI_MOCK=true rakho.');
  }
});
