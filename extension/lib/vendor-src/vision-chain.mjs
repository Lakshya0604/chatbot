// vision-chain.mjs - LangChain.js layer for chat-screenshot interpretation.
// ChatOpenAI (LangChain.js) model object use hota hai. Cloudflare Workers AI ka
// OpenAI-compatible /ai/v1/chat/completions endpoint is vision model par image
// ke saath fail hota hai (live test 2026-10-28: AiError 3030), isliye Cloudflare
// ke liye ChatOpenAI ko custom fetch diya jata hai jo wahi request native
// /ai/run/<model> par bhejta hai ({prompt, image}) aur jawab OpenAI shape mein
// wapas deta hai. Baaki providers (custom OpenAI-compatible) seedhe /chat/completions.
// Bundled to lib/vendor/langchain-vision.bundle.js (IIFE global: CCLangChainVision).
import { ChatOpenAI } from '@langchain/openai';

function cloudflareFetch(model) {
  return async (url, init) => {
    const body = JSON.parse(String(init && init.body ? init.body : '{}'));
    let prompt = '';
    let image = '';
    for (const m of body.messages || []) {
      const parts = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content || '') }];
      for (const p of parts) {
        if (p.type === 'text') prompt += (prompt ? '\n' : '') + p.text;
        if (p.type === 'image_url') {
          const u = typeof p.image_url === 'string' ? p.image_url : (p.image_url && p.image_url.url) || '';
          const idx = u.indexOf('base64,');
          if (idx >= 0) image = u.slice(idx + 7);
        }
      }
    }
    if (!image) throw new Error('vision: image missing in request');
    const runUrl = String(url).replace(/\/ai\/v1\/chat\/completions.*$/, '/ai/run/' + model);
    const res = await fetch(runUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: init.headers && (init.headers.Authorization || init.headers.authorization || (typeof init.headers.get === 'function' && init.headers.get('authorization'))) || '' },
      body: JSON.stringify({ prompt, image, max_tokens: 600, temperature: 0 }),
      signal: init && init.signal,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) {
      const msg = (j.errors && j.errors[0] && j.errors[0].message) || ('HTTP ' + res.status);
      return new Response(JSON.stringify({ error: { message: 'cloudflare: ' + String(msg).slice(0, 200), type: 'cf_error' } }), { status: res.ok ? 502 : res.status, headers: { 'content-type': 'application/json' } });
    }
    const r = j.result && j.result.response;
    const content = typeof r === 'string' ? r : JSON.stringify(r == null ? '' : r);
    return new Response(JSON.stringify({
      id: 'cf-vision', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

// messages = OpenAI-format multimodal messages from CCVision.buildVisionMessages.
export async function interpretChatImage({ baseUrl, apiKey, model, messages, timeoutMs, provider }) {
  const configuration = { baseURL: baseUrl };
  if (provider === 'cloudflare') configuration.fetch = cloudflareFetch(model);
  const llm = new ChatOpenAI({ apiKey, model, configuration, timeout: timeoutMs || 60000, temperature: 0, maxRetries: 1 });
  const res = await llm.invoke(messages);
  if (typeof res.content === 'string') return res.content;
  return (res.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
}
