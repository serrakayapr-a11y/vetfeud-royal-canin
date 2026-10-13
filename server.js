// Zero-dependency Node HTTP server — no npm install needed.
// Serves the static game pages and a tiny JSON state API that the
// stage/kontrol pages poll to stay in sync across devices.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// single shared game-state blob, kept in memory for the life of this process
let state = { data: null, updatedAt: 0 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/healthz') { res.writeHead(200); res.end('ok'); return; }

  if (pathname === '/api/state') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ data: state.data, updatedAt: state.updatedAt }));
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        state.data = body;
        state.updatedAt = Date.now();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400); res.end('Bad request');
      }
      return;
    }
  }

  // friendly clean URLs
  if (pathname === '/sahne') { sendFile(res, path.join(PUBLIC_DIR, 'sahne.html')); return; }
  if (pathname === '/kontrol') { sendFile(res, path.join(PUBLIC_DIR, 'kontrol.html')); return; }

  // static files
  let rel = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(PUBLIC_DIR, rel);
  // prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

server.listen(PORT, () => console.log('VetFeud server listening on', PORT));
