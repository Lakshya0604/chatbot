// mock-wa-server.cjs - E2E ONLY: mock WhatsApp page (static) + /reply proxy ko
// SAME ORIGIN (8788) par serve karta hai, taaki e2e direct-fetch patch CORS/PNA
// se na takraye. Production flow unaffected (SW relay alag verify hota hai).
// Run: backend 8787 chal raha ho; phir: node mock-wa-server.cjs
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/reply') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const proxy = http.request(
        { host: '127.0.0.1', port: 8787, path: '/reply', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Chatbot-Token': 'tok123' } },
        (pr) => { let d = ''; pr.on('data', (c) => (d += c)); pr.on('end', () => { res.writeHead(pr.statusCode, { 'Content-Type': 'application/json' }); res.end(d); }); }
      );
      proxy.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ error: String(e) })); });
      proxy.end(body);
    });
    return;
  }
  const fp = path.join(DIR, req.url === '/' ? 'mock-whatsapp.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!fp.startsWith(DIR) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': fp.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
}).listen(8788, () => console.log('mock-wa server: http://127.0.0.1:8788 (proxy /reply -> 8787)'));
