// Serves site/ for the iOS Simulator run and lets the host drive the page.
// index.html gets one extra same-origin script (/__tour.js), allowed by the page's own CSP.
// The page polls GET /__cmd; the host queues commands with queue(); the page POSTs /__ack.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../../site/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

export function startSimServer(port = 8770) {
  const queue = [];
  let waiting = null; // resolve fn for the current ack
  let seq = 0;
  let current = null, blocked = null; // page instance ids: commands never go to a page being replaced
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/__cmd') {
      const inst = url.searchParams.get('i');
      if (blocked && inst === blocked) { res.writeHead(204); return res.end(); }
      if (blocked && inst !== blocked) blocked = null;
      current = inst;
      const cmd = queue.shift();
      res.writeHead(cmd ? 200 : 204, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(cmd ? JSON.stringify(cmd) : '');
    }
    if (url.pathname === '/__ack') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(204); res.end();
        const msg = JSON.parse(body || '{}');
        if (waiting && msg.id === waiting.id) { const w = waiting; waiting = null; w.resolve(msg); }
      });
      return;
    }
    if (url.pathname === '/__tour.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end(await readFile(new URL('./tour.js', import.meta.url)));
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '');
    if (!path || path.endsWith('/')) path += 'index.html';
    try {
      let data = await readFile(join(ROOT, path));
      if (path === 'index.html') data = Buffer.from(String(data).replace('</head>', '<script src="/__tour.js" defer></script>\n</head>'));
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  // Queue one command and wait until the page reports it done (or the timeout passes).
  function run(cmd, timeout = 45000) { // the simulator can stall for a while when the Mac is busy
    const id = ++seq;
    queue.push({ id, ...cmd });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting = null; reject(new Error(`timeout: ${JSON.stringify(cmd)}`)); }, timeout);
      waiting = { id, resolve: (m) => { clearTimeout(timer); resolve(m); } };
    });
  }
  // Call before navigating from outside (simctl openurl): the page that is open now gets no more commands.
  function expectNewPage() { blocked = current || '__none__'; }
  return new Promise((r) => server.listen(port, '0.0.0.0', () => r({ server, run, expectNewPage })));
}
