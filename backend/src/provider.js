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
        // Reasoning models (jaise gpt-oss) reasoning tokens bhi isi budget se kaat-te
        // hain - 300 par reply truncate/empty ho jaata hai (finish_reason=length).
        max_completion_tokens: 1024,
        // Optional: kuch providers (Groq gpt-oss) reasoning_effort lete hain.
        ...(process.env.AI_REASONING_EFFORT ? { reasoning_effort: process.env.AI_REASONING_EFFORT } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      // 429 = rate limit, 401/403 = key problem - status code message mein rehta hai.
      throw new Error(`AI provider error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const choice = data.choices && data.choices[0];
    const reply = choice && choice.message ? choice.message.content : '';
    const text = String(reply || '').trim();
    // Empty reply + finish_reason=length = token budget reasoning mein khatam.
    // Isko silent empty suggestion banne se rokna hai - saaf error do.
    if (!text && choice && choice.finish_reason === 'length') {
      throw new Error('AI reply token budget mein truncate ho gaya (empty) - max_completion_tokens badhao ya reasoning_effort kam karo.');
    }
    return text;
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
