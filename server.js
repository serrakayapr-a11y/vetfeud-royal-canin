// Zero-dependency Node HTTP server — no npm install needed.
// Serves the static game pages and a tiny JSON state API that the
// stage/kontrol pages poll to stay in sync across devices.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = __dirname;
const PORT = process.env.PORT || 3000;

// Shared game-state blob. Kept in memory for speed, but also written to disk
// on every update and reloaded on boot — a process restart (crash, redeploy,
// a free-tier host spinning the dyno back up) must never silently wipe an
// in-progress game and make a reconnecting control screen look "stuck" or
// jump to a different question. (Note: some free hosting tiers also wipe the
// local disk itself on a restart/redeploy, not just memory — this covers the
// common case of an in-process restart, but isn't a substitute for an always-on
// plan if that's a risk for the actual event.)
const STATE_FILE = path.join(__dirname, '.state.json');
let state = { data: null, updatedAt: 0 };
try {
  if (fs.existsSync(STATE_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (loaded && typeof loaded === 'object') state = loaded;
  }
} catch (e) { /* corrupt or missing — start fresh rather than crash */ }

function persistState() {
  fs.writeFile(STATE_FILE, JSON.stringify(state), () => {});
}

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
        persistState();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400); res.end('Bad request');
      }
      return;
    }
  }

  // friendly clean URLs
  // root "/" intentionally serves the STAGE-ONLY screen (never the combined
  // single-device view), so the bare site link can never accidentally show
  // the control panel underneath the game screen.
  if (pathname === '/' || pathname === '/sahne') { sendFile(res, path.join(PUBLIC_DIR, 'sahne.html')); return; }
  if (pathname === '/kontrol') { sendFile(res, path.join(PUBLIC_DIR, 'kontrol.html')); return; }
  // combined single-device view kept available at /tek-cihaz as a fallback, not as the default
  if (pathname === '/tek-cihaz') { sendFile(res, path.join(PUBLIC_DIR, 'index.html')); return; }

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
