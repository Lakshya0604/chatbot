// Real-Chromium layout matrix for AUTO direction detection (no site selectors): bot left / user right,
// short + long English, Hindi, Hinglish, full-width replies, header+answer rows, empty streaming row.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.resolve(__dirname, '../../content/adapters/auto-utils.js'), 'utf8');
const long = 'This is a much longer English reply that keeps going and going so that it wraps across the entire width of the message column for sure, and then continues for another line or two to make it unmistakably a full width block of text.';
const hi = 'मैं बिल्कुल ठीक हूँ, और तुम बताओ कल का क्या प्लान है? चलो शाम को चाय पर मिलते हैं और बात करते हैं।';
const hing = 'Main theek hu yaar, tu bata kal ka kya scene hai? Chal shaam ko chai pe milte hain 😄 aur sab discuss karte hain';
const botShort = 'ok', botLong = long, botHi = hi, botHing = hing;
function page(botTexts, style) {
  const rows = [];
  botTexts.forEach((b, i) => {
    rows.push(`<div class="row me"><div class="bub">hey kya haal ${i}</div></div>`);
    rows.push(style === 'header' ? `<div class="row bot"><div class="hd">Assistant (model-x) · answered directly · no tools used</div><div class="ans">${b}</div><button>Save</button></div>` : `<div class="row bot"><div class="bub2">${b}</div></div>`);
  });
  return `<meta charset=utf-8><style>body{margin:0;font:16px sans-serif}#list{width:900px;margin:0 auto;padding:0 30px;box-sizing:border-box}.row{margin:10px 0}.me{display:flex;justify-content:flex-end}.me .bub{background:#7c4dff;color:#fff;padding:10px;border-radius:12px;max-width:70%}.bot .bub2{max-width:100%}.hd{background:#eee;padding:6px}.ans{max-width:100%}</style><div id=list>${rows.join('')}</div><form><textarea></textarea></form>`;
}
(async () => {
  const b = await chromium.launch(); let fail = 0;
  const cases = { 'short en': [botShort, botShort], 'long en': [botLong, botLong], 'hindi': [botHi, botHi], 'hinglish': [botHing, botHing], 'mixed': [botShort, botLong, botHi] };
  for (const style of ['plain', 'header']) for (const [name, bots] of Object.entries(cases)) {
    const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
    await p.setContent(page(bots, style)); await p.addScriptTag({ content: SRC });
    const r = await p.evaluate(() => {
      const A = window.ChatAuto, list = document.getElementById('list');
      const rows = Array.from(list.children);
      const d = A.detectDirectionByAlignment(rows, list);
      const inc = d ? rows.map(x => A.isIncomingByAlign(x, list, d.outgoing)) : null;
      return { d: d && d.outgoing, inc, expect: rows.map(x => x.classList.contains('bot')) };
    });
    const ok = r.d === 'right' && JSON.stringify(r.inc) === JSON.stringify(r.expect);
    console.log((ok ? 'PASS ' : 'FAIL ') + style + ' / ' + name + ' ' + JSON.stringify(r));
    if (!ok) fail++;
    await p.close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
