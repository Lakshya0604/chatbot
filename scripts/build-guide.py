#!/usr/bin/env python3
# build-guide.py - chatbot-code-guide.pdf generator (26 Oct 2026 refresh).
# Har source file ka CURRENT code line-numbers ke saath + Hinglish explanations.
# Code badalne par dobara chalao: python3 scripts/build-guide.py
import html, os, subprocess, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FILES = [
 ("extension/manifest.json", "manifest.json - extension ka registration card",
  "Ye file Chrome ko batati hai ki extension kya hai, kis page par chalega (web.telegram.org, web.whatsapp.com) aur kaunsi permissions chahiye. Bina iske extension exist nahi karta. 26 Oct: WhatsApp Web entry add hui (EXPERIMENTAL adapter)."),
 ("extension/content/engine.js", "engine.js - platform-agnostic core (sabse important file)",
  "Ye poori soch hai: per-chat opt-in + recipient consent gate, burst batching, activation snapshot (purane messages trigger nahi hote), race-safe delivery, STOP ALL + in-flight cancel, per-chat AUTO mode (default suggest), AI marker har suggestion par. BUGFIX #10 (26 Oct, corrected): activation/stop snapshot first-bind priming ka baseline banata hai, LEKIN sirf jab messages actually render ho chuke hon (msgs.length guard) - warna hash-router sites par home-screen ka snapshot priming kha jaata aur khuli chat ki history trigger ban jaati (Orbix 2j regression se pakda)."),
 ("extension/background.js", "background.js - service worker bridge",
  "Content script aur backend ka bridge. authToken storage.local mein yahin rehta hai; AI backend call sirf ye karta hai taaki API key/token page ke JavaScript ko kabhi na dikhe. GENERATE_REPLY relay + context-menu/options wiring."),
 ("extension/content/adapters/telegram.js", "adapters/telegram.js - Telegram Web (EXPERIMENTAL)",
  "Telegram Web K/A versions ke best-known selectors. Dummy mock par tested, live Telegram par UNVERIFIED. Fail-closed: identity/selector na mile to feature band. Chat-list watcher + auto-open ka read-receipt caveat documented hai."),
 ("extension/content/adapters/whatsapp.js", "adapters/whatsapp.js - WhatsApp Web (NAYA, EXPERIMENTAL)",
  "26 Oct ko user ke explicit request par bana. Sirf KHULI chat scope: #main header se chat identity, message-in/out bubbles se messages, footer contenteditable composer, send button data-tab se. Mock WhatsApp page par full E2E pass (consent, draft, AUTO send, STOP ALL); live WhatsApp Web UNVERIFIED. Meta/WhatsApp ToS unauthorized automation restrict karte hain - ban-risk real hai, koi undetectability/safety guarantee NAHI. Fail-closed design."),
 ("extension/content/adapters/custom-utils.js", "adapters/custom-utils.js - picker utilities",
  "CUSTOM mode ke picker ke helpers: user ke click se robust CSS selectors derive karna (ancestor-walk fix ke saath), role detection, selector validation."),
 ("extension/content/adapters/custom.js", "adapters/custom.js - CUSTOM mode (kisi bhi allowed site par)",
  "User khud page par message bubbles, outgoing, composer, send button select karta hai; profile save hoti hai; phir engine wahi selectors use karta hai. Generic sites ke liye."),
 ("extension/content/formfill.js", "formfill.js - form auto-fill (review-first)",
  "Generic form auto-fill: draft deta hai, SUBMIT kabhi nahi karta - review-first design."),
 ("backend/src/server.js", "server.js - local AI server (Express, sirf 127.0.0.1)",
  "Sirf localhost par sunta hai. Token auth (X-Chatbot-Token), origin guard (sirf chrome-extension:// origins), rate limit. /reply endpoint: prompt build -> provider -> (optional) memory store. AI_MOCK=true se bina key ke test replies."),
 ("backend/src/prompt.js", "prompt.js - character se prompt banana",
  "Character settings (naam, role, tone, boundaries, language/script matching, mood) se system prompt + message list banata hai. Stop-signal de-escalation aur prompt-injection guard hamesha include."),
 ("backend/src/provider.js", "provider.js - AI provider (BYOK)",
  "OpenAI-compatible API call (default Groq). Key sirf backend/.env mein; kisi aur jagah nahi."),
 ("backend/src/memory.js", "memory.js - OPTIONAL per-contact memory (MongoDB)",
  "MONGODB_URI set ho to /reply exchanges ownerId+chatId ke saath store hote hain (har contact ki alag memory). Khaali ho to memory poori tarah off. ownerId sirf token se derive hota hai."),
]

def numbered_code(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        lines = f.read().splitlines()
    out = []
    for i, ln in enumerate(lines, 1):
        out.append(f'<tr><td class="ln">{i}</td><td class="code">{html.escape(ln) or " "}</td></tr>')
    return "\n".join(out), len(lines)

css = """
body{font-family:-apple-system,'Segoe UI',sans-serif;margin:28px;color:#1a1a1a;font-size:12px}
h1{font-size:22px} h2{font-size:16px;margin-top:26px;border-bottom:2px solid #ddd;padding-bottom:4px}
.meta{color:#555} .expl{background:#f5f7fa;border-left:4px solid #4a7dd6;padding:10px 12px;margin:10px 0;white-space:pre-wrap}
.warn{background:#fff4e5;border-left:4px solid #e69a4a;padding:10px 12px;margin:10px 0}
table{border-collapse:collapse;width:100%} td{vertical-align:top}
td.ln{width:38px;text-align:right;color:#999;font-family:monospace;font-size:10px;border-right:1px solid #eee;padding-right:6px}
td.code{font-family:monospace;font-size:10px;white-space:pre-wrap;word-break:break-all;padding-left:6px}
"""

parts = [f"""<html><head><meta charset="utf-8"><style>{css}</style></head><body>
<h1>Chatbot Extension - Pura Code Explained</h1>
<p class="meta">Chrome extension + local AI backend: kisi bhi chat site par character ke roop mein draft/auto replies<br>
Banaya gaya: 26 October 2026 (refresh) | Code version: current working tree (10 bugfixes ke saath, #10 corrected)<br>
Har file ka poora code neeche line-numbers ke saath hai, har file ke upar Hinglish explanation.</p>
<div class="warn"><b>26 Oct refresh kyun:</b> WhatsApp Web adapter (adapters/whatsapp.js, EXPERIMENTAL) naya hai,
manifest.json mein web.whatsapp.com entry add hui, aur engine.js mein bugfix #10 (activation/stop priming,
msgs.length guard ke saath corrected) aaya. Purani guide (9 bugfixes wali) in teeno se pehle ki thi.</div>
<h2>0. Bade picture - ye cheez kaise kaam karti hai</h2>
<div class="expl">Flow: Chat site ka page -> content script (engine.js + adapter) messages padhti hai -> naya incoming aaya to
service worker (background.js) ko bhejti hai -> wo backend (server.js) ko call karta hai -> backend character ke hisaab se
AI se reply banwata hai -> reply wapas -> SUGGEST mode: composer mein draft (owner padhkar KHUD send dabata hai) ya AUTO mode:
safety checks ke baad apne aap send.
Safety pillars: (1) Har chat ka apna 2-click consent (bina consent KUCH nahi hota). (2) Saamne wala "stop" likhe to chat
turant band, wo message AI ko kabhi nahi jaata. (3) STOP ALL = emergency brake. (4) Reload/reopen par purane messages par
reply nahi (baseline priming). (5) Owner type kar raha ho to uska text kabhi overwrite/send nahi. (6) Follow-up max 1 per
silence episode. (7) Replies natural gap ke baad.</div>
<div class="warn"><b>WhatsApp note:</b> WhatsApp Web adapter EXPERIMENTAL hai - mock-tested, live unverified. WhatsApp/Meta
unauthorized automation par account ban/mute kar sakte hain. README ka "WhatsApp Web self-test" section padhe bina live
par mat chalao. Koi ban-safety guarantee nahi.</div>"""]

for rel, title, expl in FILES:
    rows, n = numbered_code(rel)
    parts.append(f'<h2 style="page-break-before:always">{html.escape(title)}</h2>\n<p class="meta">File: {rel} ({n} lines)</p>\n<div class="expl">{html.escape(expl)}</div>\n<table>{rows}</table>')

parts.append("</body></html>")
html_path = os.path.join(ROOT, "scripts", "guide.html")
with open(html_path, "w", encoding="utf-8") as f:
    f.write("\n".join(parts))
out = os.path.join(ROOT, "chatbot-code-guide.pdf")
subprocess.run(["wkhtmltopdf", "-q", "--encoding", "utf-8", html_path, out], check=True)
print("PDF written:", out, os.path.getsize(out), "bytes")
