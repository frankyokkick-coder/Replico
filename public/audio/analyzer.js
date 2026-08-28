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
 * detected voiced-frame pitches (Hz) alongside the time each one occurred
 * at, so the *contour* (how pitch moves over time), not just its overall
 * median, can be compared later.
 */
function getPitchContour(buffer, startTime, endTime, frameSizeSec = 0.04, hopSec = 0.02) {
  const samples = getMonoSamples(buffer);
  const sr = buffer.sampleRate;
  const frameSize = Math.round(frameSizeSec * sr);
  const hop = Math.round(hopSec * sr);

  const startSample = Math.max(0, Math.floor(startTime * sr));
  const endSample = Math.min(samples.length, Math.ceil(endTime * sr));

  const times = [];
  const hzValues = [];
  let totalFrames = 0;
  for (let pos = startSample; pos + frameSize <= endSample; pos += hop) {
    totalFrames++;
    const frame = samples.subarray(pos, pos + frameSize);
    const hz = detectPitchInFrame(frame, sr);
    if (hz !== null) {
      times.push((pos + frameSize / 2) / sr);
      hzValues.push(hz);
    }
  }
  return { times, hzValues, voicedRatio: totalFrames > 0 ? hzValues.length / totalFrames : 0 };
}

/**
 * Resamples a pitch contour to `numPoints` points spanning [startTime,
 * endTime], expressed as semitones relative to the contour's own median
 * (so it captures the *shape* of pitch movement, independent of overall
 * register - absolute pitch is already covered by the separate pitch
 * score). Points too far from any actually-voiced sample are marked
 * unvoiced rather than guessed at, so silent/unpitched stretches don't
 * get compared as if they were meaningful pitch.
 */
function resamplePitchContourShape(contour, startTime, endTime, numPoints = 20) {
  const { times, hzValues } = contour;
  const shape = new Float64Array(numPoints);
  const voiced = new Uint8Array(numPoints);
  if (times.length === 0 || endTime <= startTime) return { shape, voiced };

  const medianHz = median(hzValues);
  const pointGap = (endTime - startTime) / numPoints;
  const maxGap = Math.max(pointGap * 1.5, 0.05);

  for (let p = 0; p < numPoints; p++) {
    const t = startTime + (p / Math.max(1, numPoints - 1)) * (endTime - startTime);
    let nearestIdx = 0, nearestDist = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(times[i] - t);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    }
    if (nearestDist <= maxGap) {
      shape[p] = 12 * Math.log2(hzValues[nearestIdx] / medianHz);
      voiced[p] = 1;
    }
  }
  return { shape, voiced };
}

/**
 * Compares two resampled pitch-contour shapes and returns 0..1 similarity,
 * or null if there isn't enough overlapping voiced content to compare
 * meaningfully (e.g. one or both sides are largely unpitched, like a growl
 * or noisy bark) - in that case the caller should not let pitch contour
 * affect the result either way.
 *
 * Uses correlation (does pitch rise/fall together over time) rather than
 * point-by-point distance: a single-frame autocorrelation pitch estimate
 * is prone to octave errors, and a raw distance measure lets one or two
 * such outlier frames dominate the whole comparison. Correlation is far
 * more tolerant of a few bad frames while still capturing whether the
 * overall melodic movement matches.
 */
function pitchContourSimilarity(shapeA, shapeB) {
  const n = Math.min(shapeA.shape.length, shapeB.shape.length);
  const a = [], b = [];
  for (let i = 0; i < n; i++) {
    if (shapeA.voiced[i] && shapeB.voiced[i]) {
      a.push(shapeA.shape[i]);
      b.push(shapeB.shape[i]);
    }
  }
  if (a.length < Math.max(4, n * 0.3)) return null;

  let meanA = 0, meanB = 0;
  for (let i = 0; i < a.length; i++) { meanA += a[i]; meanB += b[i]; }
  meanA /= a.length; meanB /= a.length;

  let num = 0, denomA = 0, denomB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  // if either contour is essentially flat (near-monotone pitch), correlation
  // is undefined - treat a flat-vs-flat pair as a match, flat-vs-moving as not
  if (denomA < 1e-6 && denomB < 1e-6) return 1;
  if (denomA < 1e-6 || denomB < 1e-6) return 0.5;

  const corr = num / Math.sqrt(denomA * denomB);
  return Math.max(0, Math.min(1, (corr + 1) / 2));
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---------- spectral shape (what the scoring gate actually compares) ----------
//
// Duration, loudness envelope, and average pitch can all coincidentally
// match between a spoken sentence and a target animal sound. The actual
// timbre - the shape of the frequency spectrum, and how that shape moves
// over time - is what's genuinely different between "said some words" and
// "imitated a rooster." So this section computes a compact spectrogram
// (real FFT per frame, binned into log-spaced frequency bands, one
// direction-normalized vector per frame) and a way to compare two of them
// even when their lengths/durations differ.

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// In-place iterative radix-2 Cooley-Tukey FFT (forward only - that's all
// spectral analysis needs here). `re`/`im` must have a power-of-two length.
function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len / 2;
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
        const nextCurRe = curRe * wRe - curIm * wIm;
        const nextCurIm = curRe * wIm + curIm * wRe;
        curRe = nextCurRe; curIm = nextCurIm;
      }
    }
  }
}

function hannWindow(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

// Type-II DCT, used to turn a log-band-energy vector into cepstral
// coefficients (MFCC-style). Almost any voiced/broadband sound has a
// similar coarse "more energy low, less energy high" tilt, which by itself
// makes raw log-band vectors look deceptively similar by cosine distance.
// The DCT decorrelates that shape into coefficients ordered by how coarse
// vs. fine the spectral detail is - dropping coefficient 0 (overall level,
// already covered by the separate energy score) leaves the coefficients
// that actually capture formant/timbre shape, which is what should
// distinguish "said a sentence" from "imitated a rooster."
function dct2(input, numCoeffs) {
  const N = input.length;
  const out = new Float64Array(numCoeffs);
  for (let k = 0; k < numCoeffs; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += input[n] * Math.cos((Math.PI / N) * (n + 0.5) * k);
    }
    out[k] = sum;
  }
  return out;
}

/**
 * Raw log-spaced-band magnitude spectrum of one Hann-windowed frame
 * starting at sample `pos`. Returns null if the frame runs past `samples`.
 */
function computeBandMagnitudes(samples, pos, frameSize, fftSize, window, numBands, binHz, minHz, maxHz, logMin, logMax, re, im) {
  if (pos + frameSize > samples.length) return null;
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < frameSize; i++) re[i] = samples[pos + i] * window[i];
  fftInPlace(re, im);

  const bandSum = new Float64Array(numBands);
  const bandCount = new Float64Array(numBands);
  const halfN = fftSize / 2;
  for (let k = 1; k <= halfN; k++) {
    const freq = k * binHz;
    if (freq < minHz || freq > maxHz) continue;
    let b = Math.floor((numBands * (Math.log(freq) - logMin)) / (logMax - logMin));
    b = Math.max(0, Math.min(numBands - 1, b));
    bandSum[b] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    bandCount[b] += 1;
  }

  const bands = new Float64Array(numBands);
  for (let b = 0; b < numBands; b++) bands[b] = bandCount[b] > 0 ? bandSum[b] / bandCount[b] : 0;
  return bands;
}

/**
 * Divides [startTime, endTime] into a small, fixed number of equal-duration
 * time segments (so a reference and a player recording of different total
 * lengths still produce the same number of directly-comparable segments),
 * and returns one L2-normalized cepstral-shape vector per segment (loudness
 * is scored separately by the existing energy metric, so only *shape*
 * matters here).
 *
 * Each segment's vector is the *average* of many overlapping sub-frame
 * spectra within it (Welch's method), not a single FFT window. A single
 * ~20ms FFT frame is a very noisy estimate of a sound's spectrum (its
 * variance is on the order of the signal itself); averaging many
 * overlapping sub-frames cancels most of that estimation noise out while
 * still tracking how the timbre evolves across the sound; comparing raw
 * single frames (even time-aligned via DTW) turned out not to leave enough
 * of a gap between "different sound entirely" and "the right sound, badly
 * imitated" to gate on reliably.
 */
function computeSpectralFrames(buffer, startTime, endTime, opts = {}) {
  const numSegments = opts.numSegments || 10;
  const subFrameSize = opts.subFrameSize || 512;
  const subHop = opts.subHop || 128;
  const numBands = opts.numBands || 28;
  const numCepstral = opts.numCepstral || 14; // + dropped c0 = 15 DCT coeffs computed

  const samples = getMonoSamples(buffer);
  const sr = buffer.sampleRate;
  const totalDur = endTime - startTime;
  if (totalDur <= 0) return [];

  const fftSize = nextPow2(subFrameSize);
  const window = hannWindow(subFrameSize);
  const minHz = 60;
  const maxHz = Math.min(8000, sr / 2 - 1);
  const logMin = Math.log(minHz), logMax = Math.log(maxHz);
  const binHz = sr / fftSize;
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  const frames = [];
  const segDur = totalDur / numSegments;

  for (let s = 0; s < numSegments; s++) {
    const segStartSample = Math.max(0, Math.floor((startTime + s * segDur) * sr));
    const segEndSample = Math.min(samples.length, Math.ceil((startTime + (s + 1) * segDur) * sr));

    const bandAccum = new Float64Array(numBands);
    let subFrameCount = 0;
    for (let pos = segStartSample; pos + subFrameSize <= segEndSample; pos += subHop) {
      const bands = computeBandMagnitudes(samples, pos, subFrameSize, fftSize, window, numBands, binHz, minHz, maxHz, logMin, logMax, re, im);
      if (!bands) break;
      for (let b = 0; b < numBands; b++) bandAccum[b] += bands[b];
      subFrameCount++;
    }
    if (subFrameCount === 0) {
      // segment too short for even one sub-frame (very short recording) -
      // fall back to a single window centered on the segment.
      const center = Math.max(0, Math.min(samples.length - subFrameSize, Math.round((segStartSample + segEndSample) / 2 - subFrameSize / 2)));
      const bands = computeBandMagnitudes(samples, center, subFrameSize, fftSize, window, numBands, binHz, minHz, maxHz, logMin, logMax, re, im);
      if (bands) {
        for (let b = 0; b < numBands; b++) bandAccum[b] += bands[b];
        subFrameCount = 1;
      }
    }

    const logBands = new Float64Array(numBands);
    for (let b = 0; b < numBands; b++) {
      const avg = subFrameCount > 0 ? bandAccum[b] / subFrameCount : 0;
      logBands[b] = Math.log1p(avg);
    }

    // cepstral coefficients 1..numCepstral (c0 = overall level, dropped)
    const cepstral = dct2(logBands, numCepstral + 1);
    const vec = cepstral.slice(1);

    let normSq = 0;
    for (let i = 0; i < vec.length; i++) normSq += vec[i] * vec[i];
    const norm = Math.sqrt(normSq);
    if (norm > 1e-9) {
      for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    }
    frames.push(vec);
  }

  return frames;
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na < 1e-12 || nb < 1e-12) return 0;
  return dot / Math.sqrt(na * nb);
}

function frameDistance(a, b) {
  // cepstral coefficients can be negative, so cosine similarity spans
  // -1..1; rescale to a 0..1 distance (-1 similarity = max distance).
  return 1 - (cosineSim(a, b) + 1) / 2;
}

// Sakoe-Chiba band: without this, DTW is free to match ANY frame of one
// recording against ANY frame of the other, however far apart in time -
// which means it can cherry-pick a handful of coincidentally-similar
// frame pairs anywhere in two completely unrelated recordings and hide
// behind them. Restricting alignment to roughly-proportional timing (a
// player frame near the start can only align near the reference's start,
// etc.) is standard DTW practice and forces the *whole* time course to
// correspond, not just isolated lucky matches.
const DTW_BAND_RADIUS = 0.25;

/**
 * Dynamic-time-warping similarity between two spectral-frame sequences of
 * possibly different lengths - so a genuine imitation that's a bit faster
 * or slower than the reference still aligns and compares fairly. Returns
 * 0..1 (1 = identical spectral shape all the way through).
 */
function spectralSimilarity(framesA, framesB) {
  const n = framesA.length, m = framesB.length;
  if (n === 0 || m === 0) return 0;

  const band = Math.max(2, Math.round(DTW_BAND_RADIUS * Math.max(n, m)));
  const dtw = [];
  for (let i = 0; i <= n; i++) dtw.push(new Float64Array(m + 1).fill(Infinity));
  dtw[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    const row = dtw[i], prevRow = dtw[i - 1];
    const center = (i * m) / n;
    const jLo = Math.max(1, Math.floor(center - band));
    const jHi = Math.min(m, Math.ceil(center + band));
    for (let j = jLo; j <= jHi; j++) {
      const dist = frameDistance(framesA[i - 1], framesB[j - 1]);
      const best = Math.min(prevRow[j], row[j - 1], prevRow[j - 1]);
      row[j] = dist + best;
    }
  }

  const pathLen = Math.max(n, m);
  const avgDist = dtw[n][m] / pathLen;
  return Math.max(0, Math.min(1, 1 - avgDist));
}

/**
 * Full analysis of an AudioBuffer: active region, duration, envelope shape,
 * median pitch, and spectral-shape frames. This is the single entry point
 * used for both the reference sound and the player's recording so they're
 * scored identically.
 */
function analyzeBuffer(buffer) {
  const envelope = computeRmsEnvelope(buffer);
  const active = findActiveRegion(envelope);
  const shape = resampleEnvelopeShape(envelope, active.startTime, active.endTime);
  const pitchContour = getPitchContour(buffer, active.startTime, active.endTime);
  const medianPitchHz = median(pitchContour.hzValues);
  const pitchContourShape = resamplePitchContourShape(pitchContour, active.startTime, active.endTime);
  const spectralFrames = computeSpectralFrames(buffer, active.startTime, active.endTime);

  return {
    duration: active.duration,
    startTime: active.startTime,
    endTime: active.endTime,
    envelopeShape: shape,
    medianPitchHz,
    voicedFrameCount: pitchContour.hzValues.length,
    voicedRatio: pitchContour.voicedRatio,
    pitchContourShape,
    spectralFrames,
  };
}

window.REPLICO_ANALYZER = {
  analyzeBuffer,
  computeRmsEnvelope,
  findActiveRegion,
  spectralSimilarity,
  pitchContourSimilarity,
};
