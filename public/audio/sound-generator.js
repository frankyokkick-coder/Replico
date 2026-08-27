// Generates the REPLICO test sound entirely from synthesized audio.
// No external sound files -> no copyright concerns, and fully deterministic
// so the same reference audio is used both for playback and for scoring.

const REFERENCE_DURATION_SEC = 1.4;

/**
 * Renders the test sound into an AudioBuffer at the given sample rate.
 * The sound is a cartoon "boing-wobble": a short percussive click,
 * an upward pitch sweep, then a vibrato wobble that fades out.
 */
async function createReferenceBuffer(sampleRate) {
  const duration = REFERENCE_DURATION_SEC;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(sampleRate * duration), sampleRate);

  // --- Percussive click (0 - 0.05s): short decaying noise burst ---
  const clickDuration = 0.05;
  const clickBuffer = offlineCtx.createBuffer(1, Math.ceil(sampleRate * clickDuration), sampleRate);
  const clickData = clickBuffer.getChannelData(0);
  for (let i = 0; i < clickData.length; i++) {
    const t = i / clickData.length;
    clickData[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3);
  }
  const clickSource = offlineCtx.createBufferSource();
  clickSource.buffer = clickBuffer;
  const clickGain = offlineCtx.createGain();
  clickGain.gain.value = 0.5;
  clickSource.connect(clickGain).connect(offlineCtx.destination);
  clickSource.start(0);

  // --- Upward sweep "boing" (0.05 - 0.9s) ---
  const sweepStart = 0.05;
  const sweepEnd = 0.9;
  const sweepOsc = offlineCtx.createOscillator();
  sweepOsc.type = 'sine';
  sweepOsc.frequency.setValueAtTime(280, sweepStart);
  sweepOsc.frequency.exponentialRampToValueAtTime(900, sweepEnd);

  const sweepGain = offlineCtx.createGain();
  sweepGain.gain.setValueAtTime(0, sweepStart);
  sweepGain.gain.linearRampToValueAtTime(0.6, sweepStart + 0.08);
  sweepGain.gain.linearRampToValueAtTime(0.35, sweepEnd - 0.1);
  sweepGain.gain.linearRampToValueAtTime(0.0001, sweepEnd);

  sweepOsc.connect(sweepGain).connect(offlineCtx.destination);
  sweepOsc.start(sweepStart);
  sweepOsc.stop(sweepEnd + 0.02);

  // --- Vibrato wobble (0.9 - 1.4s): holds near 750Hz with an LFO wobble ---
  const wobbleStart = 0.9;
  const wobbleEnd = duration;
  const wobbleOsc = offlineCtx.createOscillator();
  wobbleOsc.type = 'sine';
  wobbleOsc.frequency.setValueAtTime(750, wobbleStart);

  const lfo = offlineCtx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 8; // 8 Hz wobble rate
  const lfoGain = offlineCtx.createGain();
  lfoGain.gain.value = 40; // +/- 40 Hz depth
  lfo.connect(lfoGain).connect(wobbleOsc.frequency);
  lfo.start(wobbleStart);
  lfo.stop(wobbleEnd);

  const wobbleGain = offlineCtx.createGain();
  wobbleGain.gain.setValueAtTime(0.45, wobbleStart);
  wobbleGain.gain.linearRampToValueAtTime(0.0001, wobbleEnd);

  wobbleOsc.connect(wobbleGain).connect(offlineCtx.destination);
  wobbleOsc.start(wobbleStart);
  wobbleOsc.stop(wobbleEnd);

  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer;
}

window.REPLICO_SOUND = { createReferenceBuffer, REFERENCE_DURATION_SEC };
