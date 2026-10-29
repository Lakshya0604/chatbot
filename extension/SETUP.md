# Character Chatbot v0.8.1 - setup (no secrets are included in this folder)

## Install
1. Chrome > chrome://extensions > turn on Developer mode > "Load unpacked" > pick this folder.
2. Open the extension's Settings (Details > Extension options).

## Two keys are needed (both are your own, both free-plan only)
1. Reply AI = Groq key (card "1"). Groq is the provider that writes the replies; message text goes to Groq.
2. Vision check = Cloudflare Account ID + Workers AI token (card "1v"). Screenshots go to Cloudflare. Without it, auto-send stays off.
Create each key yourself in your own account and copy it once when it is shown; paste it only into the extension's masked field, never into chat.
Groq: use a free account and do not upgrade; its current free-plan limits and terms should be read on console.groq.com/docs/rate-limits (not verified by this project for your account). Cloudflare: Workers Free plan, 10,000 neurons/day, no payment method.

## Already have the extension installed?
- Same folder: replace the files inside the SAME folder you loaded before, then press "Reload" on chrome://extensions. The extension keeps its ID and your saved settings (Chrome local storage).
- Different folder or a fresh "Load unpacked": Chrome treats it as a new extension (new ID), so settings and keys must be entered again. Remove the old one only after the new one works.
- After updating, open Settings and check the Vision card shows your saved state.

## Keys (you paste your own; fields are masked and stored only in this Chrome profile, never synced)
- Reply AI: card "1" - your own free Groq API key (console.groq.com/keys), press "Key save karo + test".
- Vision check: card "1v" - your Cloudflare Account ID (32 hex) and a Cloudflare Workers AI API token from YOUR free Cloudflare account
  (dash.cloudflare.com > My Profile > API Tokens > Create Token > "Workers AI" template). Press "Vision save karo + test" (1 tiny free vision call).
- Never paste keys into any chat. Cloudflare shows a token only once when it is created.

## Use
- Open the chat site, click the extension's toolbar icon once (this gives screenshot access for that tab only, "activeTab"; click again after leaving and returning to the site).
- Turn AI on in the panel (2-step consent), then Auto. Every auto-reply needs: consent active, direction clearly detected, and a fresh vision check
  that the last incoming message on screen matches what the page text says. Anything unclear = no auto-send (draft only).
- "Stop all" in the panel stops everything immediately.

## Limits (honest)
- Tested end to end on one own test site (Orbix) and one local test chat page, Chrome only. WhatsApp Web, Telegram, Instagram, ChatGPT not tested.
- Direction (which side is "you") uses page layout; unusual layouts stay fail-closed (no auto-send).
- Vision default model: Llama 4 Scout on Cloudflare Workers AI. Free plan = 10,000 neurons/day (resets 00:00 UTC); when exhausted or any error occurs the vision check fails and nothing is auto-sent. No paid plan is needed or set up here.
- Llama 4 terms: Llama 4 Community License + Acceptable Use Policy (https://www.llama.com/llama4/license/ , https://www.llama.com/llama4/use-policy). The AUP bars rights to multimodal models for EU-domiciled individuals/companies; it also bars impersonation without consent and representing AI output as human-generated. Use only with the other person's consent.
- Screenshots of the visible chat area are sent to Cloudflare for the check; message text goes to your reply-AI provider.
