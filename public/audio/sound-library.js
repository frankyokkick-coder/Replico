// Library of short, original, copyright-safe synthesized sounds for REPLICO
// rounds. Every sound is generated with the Web Audio API only - no
// external audio files - so the exact reference waveform is always
// available for the (unchanged) analyzer/scoring pipeline to compare against.
//
// This file does NOT modify recorder.js, analyzer.js, or scoring.js.
// It reuses the existing window.REPLICO_SOUND.createReferenceBuffer (the
// original prototype sound) as one of the library entries, unmodified.

// ---------- small synthesis helpers ----------

function makeOfflineCtx(durationSec, sampleRate) {
  return new OfflineAudioContext(1, Math.ceil(sampleRate * durationSec), sampleRate);
}

function scheduleGain(ctx, dest, points) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.max(points[0][1], 0.0001), points[0][0]);
  for (let i = 1; i < points.length; i++) {
    gain.gain.linearRampToValueAtTime(Math.max(points[i][1], 0.0001), points[i][0]);
  }
  gain.connect(dest);
  return gain;
}

function tone(ctx, dest, { type = 'sine', start, stop, freqPoints, gainPoints }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freqPoints[0][1], freqPoints[0][0]);
  for (let i = 1; i < freqPoints.length; i++) {
    const [t, f, curve] = freqPoints[i];
    if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(f, 1), t);
    else osc.frequency.linearRampToValueAtTime(f, t);
  }
  const gain = scheduleGain(ctx, dest, gainPoints);
  osc.connect(gain);
  osc.start(start);
  osc.stop(stop);
  return { osc, gain };
}

function addVibrato(ctx, targetParam, { start, stop, rate = 6, depth = 20 }) {
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = rate;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = depth;
  lfo.connect(lfoGain).connect(targetParam);
  lfo.start(start);
  lfo.stop(stop);
}

function noiseBurst(ctx, dest, { start, duration, gainPoints, filterType, filterFreq, filterQ }) {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.ceil(ctx.sampleRate * duration)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  let node = src;
  if (filterType) {
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(filterFreq || 1000, start);
    if (filterQ) filt.Q.value = filterQ;
    src.connect(filt);
    node = filt;
  }

  const gain = scheduleGain(ctx, dest, gainPoints);
  node.connect(gain);
  src.start(start);
  return { src, gain };
}

async function render(ctx) {
  return ctx.startRendering();
}

// ---------- sound recipes (non-animal only - see the sample loader below
// for animal sounds, which are real recordings, not synthesized) ----------

async function createBurp(sampleRate) {
  const ctx = makeOfflineCtx(0.7, sampleRate);
  tone(ctx, ctx.destination, {
    type: 'sawtooth', start: 0, stop: 0.55,
    freqPoints: [[0, 160], [0.1, 130], [0.35, 100], [0.55, 70]],
    gainPoints: [[0, 0], [0.05, 0.5], [0.45, 0.35], [0.55, 0]],
  });
  noiseBurst(ctx, ctx.destination, {
    start: 0, duration: 0.5,
    gainPoints: [[0, 0], [0.05, 0.15], [0.5, 0]],
    filterType: 'lowpass', filterFreq: 500,
  });
  return render(ctx);
}

async function createSneeze(sampleRate) {
  const ctx = makeOfflineCtx(0.8, sampleRate);
  noiseBurst(ctx, ctx.destination, {
    start: 0, duration: 0.35,
    gainPoints: [[0, 0], [0.3, 0.15], [0.35, 0.05]],
    filterType: 'bandpass', filterFreq: 1500, filterQ: 0.5,
  });
  noiseBurst(ctx, ctx.destination, {
    start: 0.35, duration: 0.25,
    gainPoints: [[0.35, 0], [0.37, 0.7], [0.6, 0]],
    filterType: 'highpass', filterFreq: 800,
  });
  tone(ctx, ctx.destination, {
    type: 'triangle', start: 0.35, stop: 0.55,
    freqPoints: [[0.35, 700], [0.55, 250]],
    gainPoints: [[0.35, 0], [0.37, 0.4], [0.55, 0]],
  });
  return render(ctx);
}

async function createFunnyFart(sampleRate) {
  const ctx = makeOfflineCtx(0.7, sampleRate);
  const { osc, gain } = tone(ctx, ctx.destination, {
    type: 'sawtooth', start: 0, stop: 0.6,
    freqPoints: [[0, 130], [0.6, 90]],
    gainPoints: [[0, 0], [0.03, 0.4], [0.6, 0]],
  });
  addVibrato(ctx, gain.gain, { start: 0, stop: 0.6, rate: 22, depth: 0.15 });
  addVibrato(ctx, osc.frequency, { start: 0, stop: 0.6, rate: 14, depth: 10 });
  return render(ctx);
}

async function createBabyCry(sampleRate) {
  const ctx = makeOfflineCtx(1.0, sampleRate);
  const { osc } = tone(ctx, ctx.destination, {
    type: 'sawtooth', start: 0.05, stop: 0.9,
    freqPoints: [[0.05, 500], [0.3, 750], [0.6, 700], [0.9, 550]],
    gainPoints: [[0.05, 0], [0.15, 0.4], [0.75, 0.35], [0.9, 0]],
  });
  addVibrato(ctx, osc.frequency, { start: 0.05, stop: 0.9, rate: 5, depth: 30 });
  return render(ctx);
}

async function createEvilLaugh(sampleRate) {
  const ctx = makeOfflineCtx(1.1, sampleRate);
  const starts = [0, 0.2, 0.4, 0.6];
  starts.forEach((start, i) => {
    const base = 320 - i * 25;
    tone(ctx, ctx.destination, {
      type: 'sawtooth', start, stop: start + 0.16,
      freqPoints: [[start, base], [start + 0.16, base * 0.75]],
      gainPoints: [[start, 0], [start + 0.02, 0.4], [start + 0.16, 0]],
    });
  });
  return render(ctx);
}

async function createWhistle(sampleRate) {
  const ctx = makeOfflineCtx(1.0, sampleRate);
  tone(ctx, ctx.destination, {
    type: 'sine', start: 0.05, stop: 0.9,
    freqPoints: [[0.05, 700], [0.45, 1900], [0.9, 900]],
    gainPoints: [[0.05, 0], [0.15, 0.45], [0.75, 0.4], [0.9, 0]],
  });
  return render(ctx);
}

async function createDoorCreak(sampleRate) {
  const ctx = makeOfflineCtx(1.1, sampleRate);
  const buffer = ctx.createBuffer(1, ctx.length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.Q.value = 8;
  filt.frequency.setValueAtTime(300, 0);
  filt.frequency.linearRampToValueAtTime(900, 0.5);
  filt.frequency.linearRampToValueAtTime(500, 1.0);
  src.connect(filt);
  const gain = scheduleGain(ctx, ctx.destination, [[0, 0], [0.1, 0.35], [0.9, 0.3], [1.05, 0]]);
  filt.connect(gain);
  src.start(0);
  return render(ctx);
}

async function createCarHorn(sampleRate) {
  const ctx = makeOfflineCtx(0.8, sampleRate);
  tone(ctx, ctx.destination, {
    type: 'sawtooth', start: 0.03, stop: 0.65,
    freqPoints: [[0.03, 350], [0.65, 350]],
    gainPoints: [[0.03, 0], [0.06, 0.35], [0.6, 0.35], [0.65, 0]],
  });
  tone(ctx, ctx.destination, {
    type: 'sawtooth', start: 0.03, stop: 0.65,
    freqPoints: [[0.03, 440], [0.65, 440]],
    gainPoints: [[0.03, 0], [0.06, 0.3], [0.6, 0.3], [0.65, 0]],
  });
  return render(ctx);
}

async function createSiren(sampleRate) {
  const ctx = makeOfflineCtx(1.4, sampleRate);
  tone(ctx, ctx.destination, {
    type: 'sine', start: 0.05, stop: 1.35,
    freqPoints: [[0.05, 500], [0.4, 950], [0.75, 500], [1.1, 950], [1.35, 700]],
    gainPoints: [[0.05, 0], [0.15, 0.4], [1.2, 0.4], [1.35, 0]],
  });
  return render(ctx);
}

async function createPhoneRing(sampleRate) {
  const ctx = makeOfflineCtx(1.3, sampleRate);
  for (const start of [0, 0.65]) {
    tone(ctx, ctx.destination, {
      type: 'sine', start, stop: start + 0.4,
      freqPoints: [[start, 1000], [start + 0.4, 1000]],
      gainPoints: [[start, 0], [start + 0.02, 0.3], [start + 0.38, 0.3], [start + 0.4, 0]],
    });
    tone(ctx, ctx.destination, {
      type: 'sine', start, stop: start + 0.4,
      freqPoints: [[start, 830], [start + 0.4, 830]],
      gainPoints: [[start, 0], [start + 0.02, 0.25], [start + 0.38, 0.25], [start + 0.4, 0]],
    });
  }
  return render(ctx);
}

async function createRobotBeep(sampleRate) {
  const ctx = makeOfflineCtx(0.9, sampleRate);
  const freqs = [500, 700, 900, 650, 1100];
  freqs.forEach((f, i) => {
    const start = i * 0.16;
    tone(ctx, ctx.destination, {
      type: 'square', start, stop: start + 0.12,
      freqPoints: [[start, f], [start + 0.12, f]],
      gainPoints: [[start, 0], [start + 0.01, 0.3], [start + 0.11, 0.3], [start + 0.12, 0]],
    });
  });
  return render(ctx);
}

async function createLaser(sampleRate) {
  const ctx = makeOfflineCtx(0.5, sampleRate);
  tone(ctx, ctx.destination, {
    type: 'sawtooth', start: 0, stop: 0.3,
    freqPoints: [[0, 2200], [0.3, 200, 'exp']],
    gainPoints: [[0, 0], [0.01, 0.4], [0.3, 0]],
  });
  return render(ctx);
}

async function createMonsterRoar(sampleRate) {
  const ctx = makeOfflineCtx(1.3, sampleRate);
  const { osc } = tone(ctx, ctx.destination, {
    type: 'sawtooth', start: 0.05, stop: 1.2,
    freqPoints: [[0.05, 90], [0.35, 60], [0.8, 130], [1.2, 70]],
    gainPoints: [[0.05, 0], [0.2, 0.55], [1.0, 0.45], [1.2, 0]],
  });
  addVibrato(ctx, osc.frequency, { start: 0.05, stop: 1.2, rate: 9, depth: 12 });
  noiseBurst(ctx, ctx.destination, {
    start: 0.05, duration: 1.1,
    gainPoints: [[0.05, 0], [0.2, 0.15], [1.1, 0]],
    filterType: 'lowpass', filterFreq: 700,
  });
  return render(ctx);
}

async function createKazoo(sampleRate) {
  const ctx = makeOfflineCtx(0.8, sampleRate);
  const { gain } = tone(ctx, ctx.destination, {
    type: 'sawtooth', start: 0.05, stop: 0.65,
    freqPoints: [[0.05, 440], [0.3, 520], [0.65, 440]],
    gainPoints: [[0.05, 0], [0.12, 0.35], [0.55, 0.3], [0.65, 0]],
  });
  addVibrato(ctx, gain.gain, { start: 0.05, stop: 0.65, rate: 28, depth: 0.12 });
  return render(ctx);
}

// ---------- real animal-sound sample loader ----------
//
// Animal sounds are real recordings, NOT synthesized - loaded from
// audio/samples/*.mp3 (sourced from Wikimedia Commons under CC/PD
// licenses; see audio/samples/CREDITS.md for the exact source, author,
// and license per file). The raw file is fetched and cached once, then
// decoded fresh for whatever sampleRate is requested each time - decoding
// resamples automatically, so this works at any AudioContext sample rate.

const rawSampleCache = new Map(); // url -> Promise<ArrayBuffer>

function fetchSampleArrayBuffer(url) {
  if (!rawSampleCache.has(url)) {
    rawSampleCache.set(url, fetch(url).then((res) => {
      if (!res.ok) throw new Error(`Failed to load animal sample: ${url} (${res.status})`);
      return res.arrayBuffer();
    }));
  }
  return rawSampleCache.get(url);
}

async function loadSampleBuffer(sampleRate, url) {
  const original = await fetchSampleArrayBuffer(url);
  // decodeAudioData detaches the buffer it's given, so hand it a fresh
  // copy each time in case this same sample is drawn again later.
  const copy = original.slice(0);
  const decodeCtx = new OfflineAudioContext(1, 1, sampleRate);
  return decodeCtx.decodeAudioData(copy);
}

function sampleEntry(id, name, file) {
  return { id, name, create: (sr) => loadSampleBuffer(sr, `audio/samples/${file}`) };
}

const ANIMAL_SOUND_ENTRIES = [
  sampleEntry('chicken_1', 'Chicken', 'chicken_1.mp3'),
  sampleEntry('chicken_2', 'Chicken', 'chicken_2.mp3'),
  sampleEntry('chicken_3', 'Chicken', 'chicken_al_1.mp3'),
  sampleEntry('chicken_4', 'Chicken', 'chicken_al_2.mp3'),
  sampleEntry('chicken_5', 'Chicken', 'chicken_al_3.mp3'),
  sampleEntry('rooster_1', 'Rooster', 'rooster_al_1.mp3'),
  sampleEntry('horse_1', 'Horse', 'horse_al_1.mp3'),
  sampleEntry('horse_2', 'Horse', 'horse_al_2.mp3'),
  sampleEntry('horse_3', 'Horse', 'horse_al_3.mp3'),
  sampleEntry('dog_1', 'Dog Bark', 'dog_al_1.mp3'),
  sampleEntry('dog_2', 'Dog Bark', 'dog_al_2.mp3'),
  sampleEntry('dog_small_1', 'Small Dog Bark', 'dog_small_al_1.mp3'),
  sampleEntry('dog_small_2', 'Small Dog Bark', 'dog_small_al_2.mp3'),
  sampleEntry('dog_big_1', 'Big Dog Bark', 'dog_big_al_1.mp3'),
  sampleEntry('dog_big_2', 'Big Dog Bark', 'dog_big_al_2.mp3'),
  sampleEntry('dog_howl_1', 'Dog Howl', 'dog_howl_al_1.mp3'),
  sampleEntry('cat_1', 'Cat Meow', 'cat_1.mp3'),
  sampleEntry('cat_2', 'Cat Meow', 'cat_2.mp3'),
  sampleEntry('cat_3', 'Cat Meow', 'cat_3.mp3'),
  sampleEntry('cat_4', 'Cat Meow', 'cat_sb_1.mp3'),
  sampleEntry('cow_1', 'Cow', 'cow_1.mp3'),
  sampleEntry('sheep_1', 'Sheep', 'sheep_al_1.mp3'),
  sampleEntry('sheep_2', 'Sheep', 'sheep_al_2.mp3'),
  sampleEntry('goat_1', 'Goat', 'goat_al_1.mp3'),
  sampleEntry('goat_2', 'Goat', 'goat_al_2.mp3'),
  sampleEntry('duck_1', 'Duck', 'duck_al_1.mp3'),
  sampleEntry('turkey_1', 'Turkey', 'turkey_sb_1.mp3'),
  sampleEntry('turkey_2', 'Turkey', 'turkey_sb_2.mp3'),
  sampleEntry('donkey_1', 'Donkey', 'donkey_al_1.mp3'),
  sampleEntry('frog_1', 'Frog', 'frog_al_1.mp3'),
  sampleEntry('frog_2', 'Frog', 'frog_al_2.mp3'),
  sampleEntry('bird_1', 'Bird', 'bird_al_1.mp3'),
  sampleEntry('bird_2', 'Bird', 'bird_al_2.mp3'),
  sampleEntry('owl_1', 'Owl', 'owl_al_1.mp3'),
  sampleEntry('goose_1', 'Goose', 'goose_sb_1.mp3'),
  sampleEntry('lion_1', 'Lion Roar', 'lion_al_1.mp3'),
  sampleEntry('chimp_1', 'Chimp', 'chimp_al_1.mp3'),
  sampleEntry('elephant_1', 'Elephant', 'elephant_al_1.mp3'),
  sampleEntry('bear_1', 'Bear Growl', 'bear_al_1.mp3'),
  sampleEntry('wolf_1', 'Wolf Howl', 'wolf_al_1.mp3'),
];

// ---------- library registry ----------

const SOUND_LIST = [
  { id: 'boing', name: 'Mystery Boing', create: (sr) => window.REPLICO_SOUND.createReferenceBuffer(sr) },
  { id: 'burp', name: 'Burp', create: createBurp },
  { id: 'sneeze', name: 'Sneeze', create: createSneeze },
  { id: 'fart', name: 'Funny Fart', create: createFunnyFart },
  { id: 'babycry', name: 'Baby Cry', create: createBabyCry },
  { id: 'evillaugh', name: 'Evil Laugh', create: createEvilLaugh },
  { id: 'whistle', name: 'Whistle', create: createWhistle },
  { id: 'doorcreak', name: 'Door Creak', create: createDoorCreak },
  { id: 'carhorn', name: 'Car Horn', create: createCarHorn },
  { id: 'siren', name: 'Siren', create: createSiren },
  { id: 'phonering', name: 'Phone Ring', create: createPhoneRing },
  { id: 'robotbeep', name: 'Robot Beep', create: createRobotBeep },
  { id: 'laser', name: 'Laser', create: createLaser },
  { id: 'monsterroar', name: 'Monster Roar', create: createMonsterRoar },
  { id: 'kazoo', name: 'Kazoo', create: createKazoo },
  ...ANIMAL_SOUND_ENTRIES,
];

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A deck of sound ids that deals without repeats until exhausted, then
 * reshuffles a fresh deck automatically. Safe for matches longer than the
 * library size. Also guards the reshuffle boundary itself so the very
 * next sound after a reshuffle never happens to match the last one dealt
 * from the previous pass.
 */
function createSoundDeck() {
  let deck = [];
  let lastDealt = null;

  function refill() {
    deck = shuffle(SOUND_LIST.map((s) => s.id));
    if (lastDealt !== null && deck.length > 1 && deck[deck.length - 1] === lastDealt) {
      const swapIdx = Math.floor(Math.random() * (deck.length - 1));
      [deck[deck.length - 1], deck[swapIdx]] = [deck[swapIdx], deck[deck.length - 1]];
    }
  }

  refill();

  return {
    next() {
      if (deck.length === 0) refill();
      const id = deck.pop();
      lastDealt = id;
      return id;
    },
    reset() {
      lastDealt = null;
      refill();
    },
  };
}

function getSoundById(id) {
  return SOUND_LIST.find((s) => s.id === id);
}

window.REPLICO_SOUNDS = { list: SOUND_LIST, createSoundDeck, getSoundById };
