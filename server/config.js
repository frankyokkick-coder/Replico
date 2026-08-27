// Server-side runtime configuration, separated from code so local dev and
// a real production deployment can differ without editing source files.
//
// Local dev: defaults below just work (node server.js).
// Production: set PORT / REPLICO_WS_PATH env vars however your host
// requires (most hosts inject PORT automatically).

module.exports = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 8710,
  wsPath: process.env.REPLICO_WS_PATH || '/ws',
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  // Informational only (logged at startup) - the app itself never needs
  // this, since the client auto-detects its WebSocket URL from whatever
  // origin served the page. Set it on your host so `node server.js`'s
  // startup log tells you the real public URL to share.
  publicUrl: process.env.REPLICO_PUBLIC_URL || '',
};
