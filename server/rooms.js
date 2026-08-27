// Room + turn-order state machine for REPLICO multiplayer matches.
// Deliberately has no networking/socket code in it - it's plain data and
// pure functions, so it can be unit tested on its own and reused later
// (e.g. a LAN-only desktop build) without dragging in the WebSocket layer.
//
// Round model: ONE sound is dealt per ROUND, and every player in the room
// imitates that SAME sound before the round ends. Turn order cycles
// through all players each round; each player's own score accumulates
// into their running total across rounds.

const { SOUND_IDS } = require('./soundIds');

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const TOTAL_ROUNDS = 5;
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateRoomCode(existingCodes) {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (existingCodes.has(code));
  return code;
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> room
  }

  createRoom(hostPlayer) {
    const code = generateRoomCode(new Set(this.rooms.keys()));
    const room = {
      code,
      hostId: hostPlayer.id,
      players: [hostPlayer], // { id, name }
      state: 'lobby', // lobby | playing | finished
      turnOrder: [],
      turnIndex: -1,
      round: 0,
      soundDeck: [],
      soundDeckPos: 0,
      lastSoundId: null,
      currentPlayerId: null,
      currentSoundId: null,
      scores: {}, // playerId -> cumulative total across all rounds
      roundScores: {}, // playerId -> score for the CURRENT round only
    };
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(code);
  }

  joinRoom(code, player) {
    const room = this.rooms.get(code);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    if (room.state !== 'lobby') throw new Error('MATCH_ALREADY_STARTED');
    if (room.players.length >= MAX_PLAYERS) throw new Error('ROOM_FULL');
    room.players.push(player);
    return room;
  }

  removePlayer(code, playerId) {
    const room = this.rooms.get(code);
    if (!room) return null;
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.players.length === 0) {
      this.rooms.delete(code);
      return null;
    }
    if (room.hostId === playerId) room.hostId = room.players[0].id;
    return room;
  }

  startMatch(code, requesterId) {
    const room = this.rooms.get(code);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    if (room.hostId !== requesterId) throw new Error('ONLY_HOST_CAN_START');
    if (room.players.length < MIN_PLAYERS) throw new Error('NEED_AT_LEAST_2_PLAYERS');

    room.state = 'playing';
    room.turnOrder = shuffle(room.players.map((p) => p.id));
    room.round = 0;
    room.soundDeck = shuffle(SOUND_IDS);
    room.soundDeckPos = 0;
    room.lastSoundId = null;
    room.scores = {};
    room.players.forEach((p) => { room.scores[p.id] = 0; });

    return this._startRound(room);
  }

  _nextSoundId(room) {
    if (room.soundDeckPos >= room.soundDeck.length) {
      room.soundDeck = shuffle(SOUND_IDS);
      if (room.lastSoundId && room.soundDeck.length > 1 && room.soundDeck[0] === room.lastSoundId) {
        const swapIdx = 1 + Math.floor(Math.random() * (room.soundDeck.length - 1));
        [room.soundDeck[0], room.soundDeck[swapIdx]] = [room.soundDeck[swapIdx], room.soundDeck[0]];
      }
      room.soundDeckPos = 0;
    }
    const id = room.soundDeck[room.soundDeckPos++];
    room.lastSoundId = id;
    return id;
  }

  /** Starts a new round: one fresh sound, shared by every player's turn this round. */
  _startRound(room) {
    room.round++;
    if (room.round > TOTAL_ROUNDS) {
      room.state = 'finished';
      return { type: 'match-complete', room };
    }
    room.currentSoundId = this._nextSoundId(room);
    room.roundScores = {};
    room.turnIndex = 0;
    room.currentPlayerId = room.turnOrder[room.turnIndex];
    return { type: 'turn-start', room };
  }

  /** Called after the active player's client reports its (unchanged) local scoring result. */
  recordTurnResult(code, playerId, scores) {
    const room = this.rooms.get(code);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    if (room.currentPlayerId !== playerId) throw new Error('NOT_YOUR_TURN');
    const overall = Math.max(0, Math.min(100, Math.round(Number(scores.overall) || 0)));
    room.scores[playerId] = (room.scores[playerId] || 0) + overall;
    room.roundScores[playerId] = overall;
    return room;
  }

  /**
   * Moves to the next player's turn within the same round (same sound).
   * Returns 'round-complete' once every player has gone this round -
   * the caller is then responsible for displaying the round ranking and
   * calling startNextRound() to continue.
   */
  advanceTurn(code) {
    const room = this.rooms.get(code);
    if (!room) throw new Error('ROOM_NOT_FOUND');

    room.turnIndex++;
    if (room.turnIndex >= room.turnOrder.length) {
      return { type: 'round-complete', room, roundRanked: this.getRankedRoundResults(room) };
    }
    room.currentPlayerId = room.turnOrder[room.turnIndex];
    return { type: 'turn-start', room };
  }

  /** Call after a 'round-complete' (and displaying its ranking) to begin the next round or finish the match. */
  startNextRound(code) {
    const room = this.rooms.get(code);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    return this._startRound(room);
  }

  getRankedRoundResults(room) {
    const ranked = room.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: room.roundScores[p.id] || 0,
    }));
    ranked.sort((a, b) => b.score - a.score);
    ranked.forEach((r, i) => { r.rank = i + 1; });
    return ranked;
  }

  getRankedResults(room) {
    const ranked = room.players.map((p) => ({
      id: p.id,
      name: p.name,
      total: room.scores[p.id] || 0,
    }));
    ranked.sort((a, b) => b.total - a.total);
    ranked.forEach((r, i) => { r.rank = i + 1; });
    return ranked;
  }
}

module.exports = { RoomManager, TOTAL_ROUNDS, MAX_PLAYERS, MIN_PLAYERS };
