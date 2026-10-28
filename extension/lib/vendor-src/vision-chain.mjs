// vision-chain.mjs - LangChain.js layer for chat-screenshot interpretation.
// ChatOpenAI ko Cloudflare ke OpenAI-compatible endpoint par point karta hai
// (docs.langchain.com multimodal content blocks + CF /ai/v1 baseURL swap).
// Bundled to lib/vendor/langchain-vision.bundle.js (IIFE global: CCLangChainVision).
import { ChatOpenAI } from '@langchain/openai';

// messages = OpenAI-format multimodal messages from CCVision.buildVisionMessages.
// LangChain.js chat models accept OpenAI chat-completions content-block format directly.
export async function interpretChatImage({ baseUrl, apiKey, model, messages, timeoutMs }) {
  const llm = new ChatOpenAI({
    apiKey,
    model,
    configuration: { baseURL: baseUrl },
    timeout: timeoutMs || 60000,
    temperature: 0,
  });
  const res = await llm.invoke(messages);
  // AIMessage content can be string or content-block array; normalize to text.
  if (typeof res.content === 'string') return res.content;
  return (res.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
}
