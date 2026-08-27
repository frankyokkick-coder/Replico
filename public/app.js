// REPLICO game loop - Phase 2 (The Garage):
// ROUND INTRO -> WALK TO MIC -> LISTEN -> COUNTDOWN -> REPLICATE -> RECORD
// -> PLAYBACK -> CHARACTER REACTION -> SCORE -> (walk back) -> NEXT ROUND
// repeated for 5 rounds, then FINAL SCORE -> PLAY AGAIN.
//
// This file only orchestrates flow/UI. It does not change how recording,
// playback, analysis, or scoring work - those calls (window.REPLICO_RECORDER,
// window.REPLICO_ANALYZER, window.REPLICO_SCORING) are untouched from the
// working Phase 1 prototype.

const RECORD_DURATION_MS = window.REPLICO_GAME_CONFIG.RECORD_DURATION_MS;
const COUNTDOWN_STEP_MS = 700;
const WALK_DURATION_MS = 1100;
const REACTION_DURATION_MS = 1200;
const ROUND_INTRO_DURATION_MS = 1000;
const TOTAL_ROUNDS = 5;

const screens = {};
document.querySelectorAll('.screen').forEach((el) => (screens[el.id] = el));

function showScreen(id) {
  Object.values(screens).forEach((el) => el.classList.remove('active'));
  screens[id].classList.add('active');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const state = {
  audioContext: null,
  micStream: null,
  soundDeck: null,
  soundBufferCache: new Map(),
  soundAnalysisCache: new Map(),
  currentRound: 0,
  totalScore: 0,
  recordedBlob: null,
};

const startBtn = document.getElementById('btn-start');
const startError = document.getElementById('start-error');
const roundBannerEl = document.getElementById('round-banner');
const soundNameEl = document.getElementById('sound-name');
const countdownNumberEl = document.getElementById('countdown-number');
const timerBarFill = document.getElementById('timer-bar-fill');
const playbackAudio = document.getElementById('playback-audio');
const overallScoreEl = document.getElementById('overall-score');
const finalScoreEl = document.getElementById('final-score');
const roundIndicatorEl = document.getElementById('round-indicator');
const runningScoreEl = document.getElementById('running-score');
const nextRoundBtn = document.getElementById('btn-next-round');
const characterEl = document.getElementById('character');

startBtn.addEventListener('click', onStartClicked);
nextRoundBtn.addEventListener('click', onNextRoundClicked);
document.getElementById('btn-play-again').addEventListener('click', onPlayAgainClicked);
document.getElementById('btn-playback').addEventListener('click', () => {
  playbackAudio.currentTime = 0;
  playbackAudio.play();
});

// ---------- setup ----------

async function onStartClicked() {
  startBtn.disabled = true;
  startError.textContent = '';

  try {
    if (!state.audioContext) {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    await state.audioContext.resume();

    if (!state.micStream) {
      state.micStream = await window.REPLICO_RECORDER.requestMicStream();
    }

    if (!state.soundDeck) {
      state.soundDeck = window.REPLICO_SOUNDS.createSoundDeck();
    }
  } catch (err) {
    console.error(err);
    startError.textContent = 'Could not access microphone. Please allow mic access and try again.';
    startBtn.disabled = false;
    return;
  }

  startMatch();
}

// ---------- match / round loop ----------

function startMatch() {
  state.currentRound = 0;
  state.totalScore = 0;
  state.soundDeck.reset();
  updateHud();
  playNextRound();
}

async function playNextRound() {
  state.currentRound++;
  updateHud();

  showScreen('screen-round-intro');
  roundBannerEl.textContent = `ROUND ${state.currentRound}/${TOTAL_ROUNDS}`;
  await sleep(ROUND_INTRO_DURATION_MS);

  await walkToMic();

  const soundId = state.soundDeck.next();
  const soundDef = window.REPLICO_SOUNDS.getSoundById(soundId);
  const referenceBuffer = await getOrCreateSoundBuffer(soundDef);
  const refAnalysis = getOrCreateAnalysis(soundId, referenceBuffer);

  showScreen('screen-listen');
  soundNameEl.textContent = soundDef.name.toUpperCase();
  await playReferenceSound(referenceBuffer);

  await runCountdown();
  const blob = await runRecording();

  state.recordedBlob = blob;
  playbackAudio.src = URL.createObjectURL(blob);

  const recordedBuffer = await window.REPLICO_RECORDER.decodeBlobToBuffer(blob, state.audioContext);
  const playerAnalysis = window.REPLICO_ANALYZER.analyzeBuffer(recordedBuffer);
  const scores = window.REPLICO_SCORING.scoreAttempt(refAnalysis, playerAnalysis);

  await runPlayback();
  await runReaction(scores.overall);

  state.totalScore += scores.overall;
  updateHud();
  showRoundResults(scores);
}

async function onNextRoundClicked() {
  characterEl.classList.remove('expr-happy', 'expr-shock', 'expr-derp');
  characterEl.classList.add('expr-neutral');

  await walkToHangout();

  if (state.currentRound < TOTAL_ROUNDS) {
    playNextRound();
  } else {
    showFinalScore();
  }
}

function onPlayAgainClicked() {
  startMatch();
}

function showFinalScore() {
  finalScoreEl.textContent = String(state.totalScore);
  showScreen('screen-final');
}

function updateHud() {
  roundIndicatorEl.textContent = `ROUND ${state.currentRound || 1}/${TOTAL_ROUNDS}`;
  runningScoreEl.textContent = `TOTAL: ${state.totalScore}`;
}

// ---------- sound caching ----------

async function getOrCreateSoundBuffer(soundDef) {
  if (state.soundBufferCache.has(soundDef.id)) {
    return state.soundBufferCache.get(soundDef.id);
  }
  const buffer = await soundDef.create(state.audioContext.sampleRate);
  state.soundBufferCache.set(soundDef.id, buffer);
  return buffer;
}

function getOrCreateAnalysis(soundId, buffer) {
  if (state.soundAnalysisCache.has(soundId)) {
    return state.soundAnalysisCache.get(soundId);
  }
  const analysis = window.REPLICO_ANALYZER.analyzeBuffer(buffer);
  state.soundAnalysisCache.set(soundId, analysis);
  return analysis;
}

// ---------- character movement ----------

function walkToMic() {
  characterEl.classList.remove('facing-left');
  characterEl.classList.add('walking');
  void characterEl.offsetWidth;
  characterEl.classList.add('at-mic');
  return sleep(WALK_DURATION_MS).then(() => {
    characterEl.classList.remove('walking');
  });
}

function walkToHangout() {
  characterEl.classList.add('facing-left');
  characterEl.classList.add('walking');
  characterEl.classList.remove('at-mic');
  return sleep(WALK_DURATION_MS).then(() => {
    characterEl.classList.remove('walking');
  });
}

// ---------- gameplay steps ----------

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
    countdownNumberEl.textContent = String(n);
    await sleep(COUNTDOWN_STEP_MS);
  }
}

async function runRecording() {
  showScreen('screen-record');

  timerBarFill.style.transition = 'none';
  timerBarFill.style.width = '100%';
  void timerBarFill.offsetWidth;
  timerBarFill.style.transition = `width ${RECORD_DURATION_MS}ms linear`;
  timerBarFill.style.width = '0%';

  return window.REPLICO_RECORDER.recordForDuration(state.micStream, RECORD_DURATION_MS);
}

function runPlayback() {
  showScreen('screen-playback');
  return new Promise((resolve) => {
    playbackAudio.onended = resolve;
    playbackAudio.currentTime = 0;
    playbackAudio.play().catch(resolve);
  });
}

function scoreTier(overall) {
  if (overall >= 80) return 'happy';
  if (overall >= 50) return 'shock';
  return 'derp';
}

async function runReaction(overallScore) {
  const tier = scoreTier(overallScore);
  characterEl.classList.remove('expr-neutral', 'expr-happy', 'expr-shock', 'expr-derp');
  characterEl.classList.add(`expr-${tier}`);

  showScreen('screen-reaction');
  await sleep(REACTION_DURATION_MS);
}

function showRoundResults(scores) {
  overallScoreEl.textContent = String(scores.overall);
  setScoreRow('pitch', scores.pitch);
  setScoreRow('timing', scores.timing);
  setScoreRow('energy', scores.energy);

  nextRoundBtn.textContent = state.currentRound < TOTAL_ROUNDS ? 'NEXT ROUND' : 'SEE FINAL SCORE';

  showScreen('screen-results');
}

function setScoreRow(name, value) {
  document.getElementById(`val-${name}`).textContent = String(value);
  document.getElementById(`bar-${name}`).style.width = `${value}%`;
}
