// Chạy: node server.js  → mở http://localhost:3000   (cần Node 18+)
const http = require('http'), fs = require('fs'), path = require('path');
const ALLOW = ['finfo-api.vndirect.com.vn', 'dchart-api.vndirect.com.vn', 'iboard-query.ssi.com.vn'];
const TYPE = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

http.createServer(async (q, s) => {
  const u = new URL(q.url, 'http://localhost');
  if (u.pathname === '/proxy') {
    try {
      const t = new URL(u.searchParams.get('url'));
      if (t.protocol !== 'https:' || !ALLOW.includes(t.hostname)) { s.writeHead(403); return s.end('blocked'); }
      const r = await fetch(t, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Referer: 'https://dstock.vndirect.com.vn/', Origin: 'https://dstock.vndirect.com.vn' } });
      s.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return s.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { s.writeHead(502); return s.end(JSON.stringify({ error: String(e) })); }
  }
  const f = path.join(__dirname, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(__dirname)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { s.writeHead(404); return s.end('404'); }
    s.writeHead(200, { 'Content-Type': (TYPE[path.extname(f)] || 'text/plain') + '; charset=utf-8' });
    s.end(d);
  });
}).listen(3000, () => console.log('Mở http://localhost:3000'));
