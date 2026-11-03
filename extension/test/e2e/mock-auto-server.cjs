// mock-auto-server.cjs - E2E ONLY: auto-mode mock pages static serve karta hai (8792).
// Run: node mock-auto-server.cjs
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
http.createServer((req, res) => {
  const fp = path.join(DIR, req.url === '/' ? 'mock-auto-attr.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!fp.startsWith(DIR) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': fp.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
}).listen(8792, () => console.log('mock-auto server: http://127.0.0.1:8792'));
