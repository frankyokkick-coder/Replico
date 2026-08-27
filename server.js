const http = require('http');
const path = require('path');
const fs = require('fs');
const netConfig = require('./server/config');
const { attachMultiplayer } = require('./server/wsServer');

const PORT = netConfig.port;
const ROOT = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.join(ROOT, reqPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + reqPath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

attachMultiplayer(server, netConfig);

server.listen(PORT, () => {
  const displayUrl = netConfig.publicUrl || `http://localhost:${PORT}`;
  console.log(`REPLICO [${netConfig.mode}] running at ${displayUrl}`);
  console.log(`Multiplayer WebSocket path: ${netConfig.wsPath} (auto-detected by clients, wss:// in production)`);
});
