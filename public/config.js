// Central runtime configuration for the client. This is the ONLY place
// networking targets should live - never hard-code "localhost" anywhere
// else in the client.
//
// Local dev: the defaults below auto-derive the WebSocket URL from
// whatever origin served the page, so `node server.js` on localhost just
// works with no edits.
//
// Production: if the multiplayer server ever lives on a different host
// than the static web build (e.g. static files on one CDN, WebSocket
// server on another domain), set WS_URL below to that server's full
// wss:// URL before deploying. Leave it blank to keep same-origin
// auto-detection (the common case: one host serves both).
window.REPLICO_CONFIG = Object.assign({
  WS_URL: '',
}, window.REPLICO_CONFIG || {});

window.REPLICO_CONFIG.resolveWsUrl = function resolveWsUrl() {
  if (window.REPLICO_CONFIG.WS_URL) return window.REPLICO_CONFIG.WS_URL;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
};
