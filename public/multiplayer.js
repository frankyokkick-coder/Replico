// REPLICO multiplayer orchestration. Wrapped in an IIFE so its top-level
// names never collide with app.js's (both files declare things like
// `state` and `showScreen` at top level - classic <script> tags share one
// global scope, so this isolation is required, not just tidy).
//
// This file reuses the SAME gameplay screens, and the SAME unchanged
// audio pipeline (window.REPLICO_RECORDER / REPLICO_ANALYZER /
// REPLICO_SCORING / REPLICO_SOUNDS) as single-player. It does not import
// or call anything from app.js, and app.js does not know this file
// exists - single-player keeps working exactly as before.

(function () {
  'use strict';

  const RECORD_DURATION_MS = window.REPLICO_GAME_CONFIG.RECORD_DURATION_MS;
  const COUNTDOWN_STEP_MS = 700;
  const WALK_DURATION_MS = 1100;
  const REACTION_DURATION_MS = 1200;
  const ROUND_INTRO_DURATION_MS = 1000;

  const PLAYER_TINTS = [
    'none', 'hue-rotate(110deg)', 'hue-rotate(220deg)',
    'hue-rotate(300deg) saturate(1.4)', 'hue-rotate(60deg) saturate(1.3)', 'hue-rotate(170deg) invert(0.12)',
  ];
  const SLOT_CLASSES = ['mp-slot-0', 'mp-slot-1', 'mp-slot-2', 'mp-slot-3', 'mp-slot-4', 'mp-slot-5'];
  const RANK_LABELS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  const net = window.REPLICO_NET;
  const characterTemplate = document.getElementById('character');
  const characterClones = new Map(); // playerId -> element

  const state = {
    audioContext: null,
    micStream: null,
    players: [],
    hostId: null,
    lastRound: 0,
    soundBufferCache: new Map(),
    soundAnalysisCache: new Map(),
  };

  const el = {
    btnMpMode: document.getElementById('btn-mp-mode'),
    nameInput: document.getElementById('mp-name-input'),
    codeInput: document.getElementById('mp-code-input'),
    btnCreate: document.getElementById('btn-mp-create'),
    btnJoin: document.getElementById('btn-mp-join'),
    lobbyError: document.getElementById('mp-lobby-error'),
    roomCodeLabel: document.getElementById('mp-room-code'),
    playerList: document.getElementById('mp-player-list'),
    btnStartMatch: document.getElementById('btn-mp-start'),
    roomHint: document.getElementById('mp-room-hint'),
    roundBanner: document.getElementById('round-banner'),
    soundName: document.getElementById('sound-name'),
    countdownNumber: document.getElementById('countdown-number'),
    timerBarFill: document.getElementById('timer-bar-fill'),
    overallScore: document.getElementById('overall-score'),
    roundIndicator: document.getElementById('round-indicator'),
    runningScore: document.getElementById('running-score'),
    turnPlayerLabel: document.getElementById('turn-player-label'),
    leaderboard: document.getElementById('mp-leaderboard'),
    btnBackToLobby: document.getElementById('btn-mp-back-to-lobby'),
    mpCharacters: document.getElementById('mp-characters'),
    mpPlaybackAudio: document.getElementById('mp-playback-audio'),
    roundResultTitle: document.getElementById('mp-round-result-title'),
    roundLeaderboard: document.getElementById('mp-round-leaderboard'),
    winnerBanner: document.getElementById('mp-winner-banner'),
  };

  function setScoreRow(name, value) {
    document.getElementById(`val-${name}`).textContent = String(value);
    document.getElementById(`bar-${name}`).style.width = `${value}%`;
  }

  function scoreTier(overall) {
    if (overall >= 80) return 'happy';
    if (overall >= 50) return 'shock';
    return 'derp';
  }

  function nameForId(id) {
    const p = state.players.find((pl) => pl.id === id);
    return p ? p.name : 'Someone';
  }

  // ---------- mode select ----------

  el.btnMpMode.addEventListener('click', () => {
    document.body.classList.add('mp-active');
    characterTemplate.style.display = 'none';
    showScreen('screen-mp-lobby');
  });

  // ---------- mic + connection setup ----------

  async function ensureAudioReady() {
    if (!state.audioContext) {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    await state.audioContext.resume();
    if (!state.micStream) {
      state.micStream = await window.REPLICO_RECORDER.requestMicStream();
    }
  }

  let connected = false;
  async function ensureConnected() {
    if (connected) return;
    await net.connect();
    connected = true;
    wireNetHandlers();
  }

  el.btnCreate.addEventListener('click', async () => {
    el.lobbyError.textContent = '';
    // Leave blank if the player didn't type a name - the server assigns a
    // distinguishable default ("Player 1", "Player 2", ...) so unnamed
    // players in the same room are never all shown as the same "Player".
    const name = el.nameInput.value.trim();
    try {
      await ensureAudioReady();
      await ensureConnected();
      net.createRoom(name);
    } catch (err) {
      console.error(err);
      el.lobbyError.textContent = 'Could not access microphone or reach the multiplayer server.';
    }
  });

  el.btnJoin.addEventListener('click', async () => {
    el.lobbyError.textContent = '';
    const name = el.nameInput.value.trim();
    const code = el.codeInput.value.trim().toUpperCase();
    if (code.length !== 4) {
      el.lobbyError.textContent = 'Enter the 4-letter room code.';
      return;
    }
    try {
      await ensureAudioReady();
      await ensureConnected();
      net.joinRoom(code, name);
    } catch (err) {
      console.error(err);
      el.lobbyError.textContent = 'Could not access microphone or reach the multiplayer server.';
    }
  });

  el.btnStartMatch.addEventListener('click', () => net.startMatch());

  el.btnBackToLobby.addEventListener('click', () => {
    // Simplest reset for this first version.
    window.location.reload();
  });

  // ---------- room lobby rendering ----------

  function renderRoom(msg) {
    state.hostId = msg.hostId;
    state.players = msg.players;

    el.roomCodeLabel.textContent = msg.code;
    el.playerList.innerHTML = '';
    msg.players.forEach((p) => {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name;
      li.appendChild(nameSpan);
      if (p.id === msg.hostId) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'HOST';
        li.appendChild(tag);
      }
      el.playerList.appendChild(li);
    });

    const isHost = net.getPlayerId() === msg.hostId;
    el.btnStartMatch.style.display = isHost ? '' : 'none';
    el.btnStartMatch.disabled = msg.players.length < 2;
    el.roomHint.textContent = isHost
      ? (msg.players.length < 2 ? 'Need at least 2 players to start.' : 'Ready when you are.')
      : "Waiting for the host to start the match...";

    ensureCharacterClones(msg.players);
    showScreen('screen-mp-room');
  }

  // ---------- character clones sharing the single-player garage ----------

  function ensureCharacterClones(players) {
    for (const [id, clone] of characterClones) {
      if (!players.find((p) => p.id === id)) {
        clone.remove();
        characterClones.delete(id);
      }
    }
    players.forEach((p, i) => {
      if (characterClones.has(p.id)) return;
      const clone = characterTemplate.cloneNode(true);
      clone.removeAttribute('id');
      clone.classList.remove('at-mic', 'walking', 'facing-left');
      clone.classList.add('expr-neutral', SLOT_CLASSES[i % SLOT_CLASSES.length]);
      clone.style.display = '';
      clone.style.filter = PLAYER_TINTS[i % PLAYER_TINTS.length];

      const tag = document.createElement('div');
      tag.className = 'mp-name-tag';
      tag.textContent = p.name;
      clone.appendChild(tag);

      el.mpCharacters.appendChild(clone);
      characterClones.set(p.id, clone);
    });
  }

  function setCharacterExpression(playerId, tier) {
    const clone = characterClones.get(playerId);
    if (!clone) return;
    clone.classList.remove('expr-neutral', 'expr-happy', 'expr-shock', 'expr-derp');
    clone.classList.add(`expr-${tier}`);
  }

  function walkCharacterToMic(playerId) {
    const clone = characterClones.get(playerId);
    if (!clone) return Promise.resolve();
    clone.classList.remove('facing-left');
    clone.classList.add('walking');
    void clone.offsetWidth;
    clone.classList.add('at-mic');
    return sleep(WALK_DURATION_MS).then(() => clone.classList.remove('walking'));
  }

  function walkCharacterToHangout(playerId) {
    const clone = characterClones.get(playerId);
    if (!clone) return Promise.resolve();
    clone.classList.add('facing-left', 'walking');
    clone.classList.remove('at-mic');
    return sleep(WALK_DURATION_MS).then(() => {
      clone.classList.remove('walking', 'facing-left');
      clone.classList.remove('expr-happy', 'expr-shock', 'expr-derp');
      clone.classList.add('expr-neutral');
    });
  }

  // ---------- sound caching (independent copy of app.js's approach) ----------

  async function getOrCreateSoundBuffer(soundDef) {
    if (state.soundBufferCache.has(soundDef.id)) return state.soundBufferCache.get(soundDef.id);
    const buffer = await soundDef.create(state.audioContext.sampleRate);
    state.soundBufferCache.set(soundDef.id, buffer);
    return buffer;
  }

  function getOrCreateAnalysis(soundId, buffer) {
    if (state.soundAnalysisCache.has(soundId)) return state.soundAnalysisCache.get(soundId);
    const analysis = window.REPLICO_ANALYZER.analyzeBuffer(buffer);
    state.soundAnalysisCache.set(soundId, analysis);
    return analysis;
  }

  function playReferenceSound(buffer) {
    const source = state.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(state.audioContext.destination);
    return new Promise((resolve) => {
      source.onended = resolve;
      source.start();
    });
  }

  async function runCountdown() {
    showScreen('screen-countdown');
    for (const n of [3, 2, 1]) {
      el.countdownNumber.textContent = String(n);
      await sleep(COUNTDOWN_STEP_MS);
    }
  }

  // ---------- turn handling ----------

  async function handleTurnStart(msg) {
    const myId = net.getPlayerId();
    el.roundIndicator.textContent = `ROUND ${msg.round}/${msg.totalRounds}`;
    el.runningScore.textContent = `TOTAL: ${msg.scores[myId] || 0}`;

    if (msg.round !== state.lastRound) {
      state.lastRound = msg.round;
      showScreen('screen-round-intro');
      el.roundBanner.textContent = `ROUND ${msg.round}/${msg.totalRounds}`;
      await sleep(ROUND_INTRO_DURATION_MS);
    }

    const isMyTurn = msg.playerId === myId;
    el.turnPlayerLabel.textContent = isMyTurn ? 'YOUR TURN' : `${nameForId(msg.playerId).toUpperCase()}'S TURN`;

    await walkCharacterToMic(msg.playerId);

    const soundDef = window.REPLICO_SOUNDS.getSoundById(msg.soundId);
    const buffer = await getOrCreateSoundBuffer(soundDef);
    const refAnalysis = getOrCreateAnalysis(msg.soundId, buffer);

    showScreen('screen-listen');
    el.soundName.textContent = soundDef.name.toUpperCase();
    await playReferenceSound(buffer);

    await runCountdown();

    showScreen('screen-record');
    el.timerBarFill.style.transition = 'none';
    el.timerBarFill.style.width = '100%';
    void el.timerBarFill.offsetWidth;
    el.timerBarFill.style.transition = `width ${RECORD_DURATION_MS}ms linear`;
    el.timerBarFill.style.width = '0%';

    if (isMyTurn) {
      const blob = await window.REPLICO_RECORDER.recordForDuration(state.micStream, RECORD_DURATION_MS);
      const recordedBuffer = await window.REPLICO_RECORDER.decodeBlobToBuffer(blob, state.audioContext);
      const playerAnalysis = window.REPLICO_ANALYZER.analyzeBuffer(recordedBuffer);
      const scores = window.REPLICO_SCORING.scoreAttempt(refAnalysis, playerAnalysis);
      net.sendAttemptResult(scores, blob);
    }
    // Spectators simply stay on screen-record; the 'turn-result' broadcast
    // (below) is what moves everyone forward together.
  }

  async function handleTurnResult(msg) {
    const blob = net.base64ToBlob(msg.audio, msg.mimeType);
    el.mpPlaybackAudio.src = URL.createObjectURL(blob);

    showScreen('screen-playback');
    await new Promise((resolve) => {
      el.mpPlaybackAudio.onended = resolve;
      el.mpPlaybackAudio.currentTime = 0;
      el.mpPlaybackAudio.play().catch(resolve);
    });

    setCharacterExpression(msg.playerId, scoreTier(msg.scores.overall));
    showScreen('screen-reaction');
    await sleep(REACTION_DURATION_MS);

    el.overallScore.textContent = String(msg.scores.overall);
    setScoreRow('pitch', msg.scores.pitch);
    setScoreRow('timing', msg.scores.timing);
    setScoreRow('energy', msg.scores.energy);
    const myId = net.getPlayerId();
    el.runningScore.textContent = `TOTAL: ${msg.totalScores[myId] || 0}`;
    showScreen('screen-results');

    walkCharacterToHangout(msg.playerId);
  }

  function buildRankedListItems(container, entries, scoreKey) {
    container.innerHTML = '';
    entries.forEach((r) => {
      const li = document.createElement('li');
      if (r.rank === 1) li.classList.add('rank-1');

      const rankSpan = document.createElement('span');
      rankSpan.className = 'rank-label';
      rankSpan.textContent = RANK_LABELS[r.rank - 1] || `${r.rank}th`;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = r.name;

      const scoreSpan = document.createElement('span');
      scoreSpan.textContent = r[scoreKey];

      li.appendChild(rankSpan);
      li.appendChild(nameSpan);
      li.appendChild(scoreSpan);
      container.appendChild(li);
    });
  }

  function handleRoundResult(msg) {
    el.roundResultTitle.textContent = `ROUND ${msg.round} RESULTS`;
    buildRankedListItems(el.roundLeaderboard, msg.results, 'score');
    showScreen('screen-mp-round-result');
  }

  function handleMatchComplete(msg) {
    buildRankedListItems(el.leaderboard, msg.results, 'total');
    const winner = msg.results.find((r) => r.rank === 1);
    el.winnerBanner.textContent = winner ? `🏆 ${winner.name} WINS!` : '';
    showScreen('screen-mp-final');
  }

  // ---------- networking wiring ----------

  function wireNetHandlers() {
    net.on('room-joined', renderRoom);
    net.on('turn-start', handleTurnStart);
    net.on('turn-result', handleTurnResult);
    net.on('round-result', handleRoundResult);
    net.on('match-complete', handleMatchComplete);
    net.on('error', (msg) => {
      console.error('REPLICO multiplayer error:', msg.message);
      el.lobbyError.textContent = msg.message;
      el.roomHint.textContent = msg.message;
    });
    net.on('disconnected', () => {
      el.lobbyError.textContent = 'Disconnected from the multiplayer server.';
    });
  }
})();
