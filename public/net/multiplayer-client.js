// Thin WebSocket wrapper for REPLICO multiplayer. Deliberately has no DOM
// access - it only sends/receives messages - so it can be reused later from
// a non-browser-UI shell (e.g. a desktop build) without changes.

function createMultiplayerClient() {
  let ws = null;
  let playerId = null;
  const handlers = {};

  function on(type, fn) {
    handlers[type] = fn;
  }

  function connect() {
    return new Promise((resolve, reject) => {
      const url = window.REPLICO_CONFIG.resolveWsUrl();
      ws = new WebSocket(url);

      ws.onopen = () => resolve();
      ws.onerror = (event) => reject(event);

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === 'welcome') playerId = msg.playerId;
        const handler = handlers[msg.type];
        if (handler) handler(msg);
      };

      ws.onclose = () => {
        if (handlers.disconnected) handlers.disconnected();
      };
    });
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function createRoom(name) {
    send({ type: 'create-room', name });
  }

  function joinRoom(code, name) {
    send({ type: 'join-room', code, name });
  }

  function startMatch() {
    send({ type: 'start-match' });
  }

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(blob);
    });
  }

  async function sendAttemptResult(scores, blob) {
    const audio = await blobToBase64(blob);
    send({ type: 'attempt-result', scores, audio, mimeType: blob.type });
  }

  function base64ToBlob(base64, mimeType) {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  }

  return {
    on,
    connect,
    createRoom,
    joinRoom,
    startMatch,
    sendAttemptResult,
    base64ToBlob,
    getPlayerId: () => playerId,
  };
}

window.REPLICO_NET = createMultiplayerClient();
