// provider.js - AI model se baat karne wala hissa.
// OpenAI-compatible chat completions API use karta hai, taaki provider badalna
// sirf .env mein AI_BASE_URL/AI_MODEL change karne jitna kaam ho.

export async function callChatCompletion({ baseUrl, apiKey, model, messages, timeoutMs = 30000 }) {
  // Timeout: provider hang ho jaye to request hamesha ke liye atke nahi.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.8,
        max_tokens: 300,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      // 429 = rate limit, 401/403 = key problem - status code message mein rehta hai.
      throw new Error(`AI provider error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    return String(reply).trim();
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`AI provider timeout (${Math.round(timeoutMs / 1000)}s mein jawab nahi aaya)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Mock mode: bina API key ke test ke liye. Last incoming message ka echo deta hai.
export function mockReply(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  return `(mock reply) tumne kaha: "${last ? last.content : ''}" - yahan asli AI ka jawab aayega.`;
}
