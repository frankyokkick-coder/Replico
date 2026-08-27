// WebSocket layer for REPLICO multiplayer. Translates socket messages into
// RoomManager calls and broadcasts the resulting state to every player in
// a room. No game rules live here - that's all in rooms.js.

const crypto = require('crypto');
const WebSocket = require('ws');
const { RoomManager, TOTAL_ROUNDS } = require('./rooms');

// Fixed pacing delays rather than per-client ready-acks (kept simple for
// this first version). RESULT_DISPLAY_MS must comfortably cover the
// slowest client's playback-of-recording + reaction display time;
// ROUND_RESULT_DISPLAY_MS is how long the round ranking stays on screen
// before the next round's sound is dealt.
const RESULT_DISPLAY_MS = 4000;
const ROUND_RESULT_DISPLAY_MS = 3500;

function attachMultiplayer(httpServer, config) {
  const wss = new WebSocket.Server({ server: httpServer, path: config.wsPath });
  const roomManager = new RoomManager();
  const clients = new Map(); // playerId -> ws

  function send(ws, msg) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcastRoom(room, msg) {
    if (!room) return;
    room.players.forEach((p) => {
      const ws = clients.get(p.id);
      if (ws) send(ws, msg);
    });
  }

  function roomSummary(room) {
    return {
      code: room.code,
      hostId: room.hostId,
      state: room.state,
      players: room.players.map((p) => ({ id: p.id, name: p.name })),
    };
  }

  function turnPayload(room) {
    return {
      round: room.round,
      totalRounds: TOTAL_ROUNDS,
      playerId: room.currentPlayerId,
      soundId: room.currentSoundId,
      scores: room.scores,
    };
  }

  function applyStartRoundOutcome(outcome) {
    if (outcome.type === 'match-complete') {
      broadcastRoom(outcome.room, { type: 'match-complete', results: roomManager.getRankedResults(outcome.room) });
    } else {
      broadcastRoom(outcome.room, { type: 'turn-start', ...turnPayload(outcome.room) });
    }
  }

  function applyAdvance(room) {
    const outcome = roomManager.advanceTurn(room.code);
    if (outcome.type === 'turn-start') {
      broadcastRoom(outcome.room, { type: 'turn-start', ...turnPayload(outcome.room) });
    } else if (outcome.type === 'round-complete') {
      broadcastRoom(outcome.room, {
        type: 'round-result',
        round: outcome.room.round,
        totalRounds: TOTAL_ROUNDS,
        results: outcome.roundRanked,
        totalScores: outcome.room.scores,
      });
      setTimeout(() => {
        applyStartRoundOutcome(roomManager.startNextRound(outcome.room.code));
      }, ROUND_RESULT_DISPLAY_MS);
    }
  }

  wss.on('connection', (ws) => {
    const playerId = crypto.randomUUID();
    ws.playerId = playerId;
    clients.set(playerId, ws);
    send(ws, { type: 'welcome', playerId });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      try {
        if (msg.type === 'create-room') {
          // Host is always the first player in a fresh room, so an unnamed
          // host defaults to "Player 1" rather than a bare, ambiguous "Player".
          const enteredName = String(msg.name || '').trim().slice(0, 16);
          const player = { id: playerId, name: enteredName || 'Player 1' };
          const room = roomManager.createRoom(player);
          ws.roomCode = room.code;
          send(ws, { type: 'room-joined', ...roomSummary(room) });
        } else if (msg.type === 'join-room') {
          const code = String(msg.code || '').toUpperCase().trim();
          // Default name reflects actual join order ("Player 2", "Player 3", ...)
          // so multiple unnamed players stay distinguishable in results/rankings.
          const existingRoom = roomManager.getRoom(code);
          const defaultName = `Player ${(existingRoom ? existingRoom.players.length : 0) + 1}`;
          const enteredName = String(msg.name || '').trim().slice(0, 16);
          const player = { id: playerId, name: enteredName || defaultName };
          const room = roomManager.joinRoom(code, player);
          ws.roomCode = code;
          broadcastRoom(room, { type: 'room-joined', ...roomSummary(room) });
        } else if (msg.type === 'start-match') {
          const room = roomManager.getRoom(ws.roomCode);
          if (!room) throw new Error('ROOM_NOT_FOUND');
          const outcome = roomManager.startMatch(ws.roomCode, playerId);
          broadcastRoom(room, { type: 'match-started', ...roomSummary(room) });
          applyStartRoundOutcome(outcome);
        } else if (msg.type === 'attempt-result') {
          const room = roomManager.getRoom(ws.roomCode);
          if (!room) throw new Error('ROOM_NOT_FOUND');
          roomManager.recordTurnResult(ws.roomCode, playerId, msg.scores || {});

          broadcastRoom(room, {
            type: 'turn-result',
            playerId,
            scores: msg.scores,
            audio: msg.audio,
            mimeType: msg.mimeType,
            totalScores: room.scores,
          });

          setTimeout(() => applyAdvance(room), RESULT_DISPLAY_MS);
        }
      } catch (err) {
        send(ws, { type: 'error', message: err.message });
      }
    });

    ws.on('close', () => {
      clients.delete(playerId);
      if (ws.roomCode) {
        const room = roomManager.removePlayer(ws.roomCode, playerId);
        if (room) broadcastRoom(room, { type: 'room-joined', ...roomSummary(room) });
      }
    });
  });

  return { roomManager };
}

module.exports = { attachMultiplayer };
