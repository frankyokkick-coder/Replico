// Real signal analysis of AudioBuffers: amplitude envelope, active-region
// (silence trimming), and autocorrelation-based pitch detection.
// No randomness anywhere here - every number comes from the actual samples.

function getMonoSamples(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  // Downmix to mono by averaging channels.
  const length = buffer.length;
  const out = new Float32Array(length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

/**
 * Computes RMS energy per frame across the whole buffer.
 * Returns { rms: Float32Array, frameTimes: Float32Array, hopSec }
 */
function computeRmsEnvelope(buffer, frameSizeSec = 0.02, hopSec = 0.01) {
  const samples = getMonoSamples(buffer);
  const sr = buffer.sampleRate;
  const frameSize = Math.max(1, Math.round(frameSizeSec * sr));
  const hop = Math.max(1, Math.round(hopSec * sr));

  const numFrames = Math.max(0, Math.floor((samples.length - frameSize) / hop) + 1);
  const rms = new Float32Array(numFrames);
  const frameTimes = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hop;
    let sumSq = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = samples[start + i] || 0;
      sumSq += s * s;
    }
    rms[f] = Math.sqrt(sumSq / frameSize);
    frameTimes[f] = (start + frameSize / 2) / sr;
  }

  return { rms, frameTimes, hopSec, frameSizeSec };
}

/**
 * Finds the [startTime, endTime] window that contains the "active" sound,
 * based on an RMS threshold relative to the loudest frame in the buffer.
 */
function findActiveRegion(envelope, thresholdRatio = 0.15) {
  const { rms, frameTimes } = envelope;
  if (rms.length === 0) return { startTime: 0, endTime: 0, duration: 0 };

  let maxRms = 0;
  for (let i = 0; i < rms.length; i++) maxRms = Math.max(maxRms, rms[i]);
  const threshold = maxRms * thresholdRatio;

  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] >= threshold) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
    }
  }

  if (firstIdx === -1) return { startTime: 0, endTime: 0, duration: 0 };

  const startTime = frameTimes[firstIdx];
  const endTime = frameTimes[lastIdx];
  return { startTime, endTime, duration: Math.max(0, endTime - startTime) };
}

/**
 * Resamples the RMS envelope within [startTime, endTime] to `numPoints`
 * values, min-max normalized to 0..1. Used to compare the "shape" of two
 * different-length recordings on equal footing.
 */
function resampleEnvelopeShape(envelope, startTime, endTime, numPoints = 40) {
  const { rms, frameTimes } = envelope;
  const out = new Float32Array(numPoints);
  if (rms.length === 0 || endTime <= startTime) return out;

  for (let p = 0; p < numPoints; p++) {
    const t = startTime + (p / (numPoints - 1)) * (endTime - startTime);
    // find nearest frame
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < frameTimes.length; i++) {
      const d = Math.abs(frameTimes[i] - t);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    out[p] = rms[nearestIdx];
  }

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < out.length; i++) {
    min = Math.min(min, out[i]);
    max = Math.max(max, out[i]);
  }
  const range = max - min || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / range;

  return out;
}

/**
 * Autocorrelation pitch detector for a single frame of samples.
 * Returns frequency in Hz, or null if the frame doesn't look voiced/periodic.
 */
function detectPitchInFrame(samples, sampleRate, minHz = 70, maxHz = 1000) {
  const n = samples.length;

  // Normalize / remove DC offset
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;

  let energy = 0;
  const centered = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    centered[i] = samples[i] - mean;
    energy += centered[i] * centered[i];
  }
  if (energy < 1e-6) return null; // essentially silence

  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);

  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    let corr = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += centered[i] * centered[i + lag];
    }
    corr /= (n - lag);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  const normalizedCorr = bestCorr / (energy / n);
  if (bestLag <= 0 || normalizedCorr < 0.3) return null; // not periodic enough

  return sampleRate / bestLag;
}

/**
 * Walks the buffer in frames across [startTime, endTime] and returns the
 * list of detected voiced-frame pitches (Hz).
 */
function getPitchContour(buffer, startTime, endTime, frameSizeSec = 0.04, hopSec = 0.02) {
  const samples = getMonoSamples(buffer);
  const sr = buffer.sampleRate;
  const frameSize = Math.round(frameSizeSec * sr);
  const hop = Math.round(hopSec * sr);

  const startSample = Math.max(0, Math.floor(startTime * sr));
  const endSample = Math.min(samples.length, Math.ceil(endTime * sr));

  const pitches = [];
  for (let pos = startSample; pos + frameSize <= endSample; pos += hop) {
    const frame = samples.subarray(pos, pos + frameSize);
    const hz = detectPitchInFrame(frame, sr);
    if (hz !== null) pitches.push(hz);
  }
  return pitches;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Full analysis of an AudioBuffer: active region, duration, envelope shape,
 * and median pitch. This is the single entry point used for both the
 * reference sound and the player's recording so they're scored identically.
 */
function analyzeBuffer(buffer) {
  const envelope = computeRmsEnvelope(buffer);
  const active = findActiveRegion(envelope);
  const shape = resampleEnvelopeShape(envelope, active.startTime, active.endTime);
  const pitchContour = getPitchContour(buffer, active.startTime, active.endTime);
  const medianPitchHz = median(pitchContour);

  return {
    duration: active.duration,
    startTime: active.startTime,
    endTime: active.endTime,
    envelopeShape: shape,
    medianPitchHz,
    voicedFrameCount: pitchContour.length,
  };
}

window.REPLICO_ANALYZER = { analyzeBuffer, computeRmsEnvelope, findActiveRegion };
