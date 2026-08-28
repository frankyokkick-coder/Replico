// Turns two analyzeBuffer() results (reference vs. player recording) into
// the four displayed scores. Weights and curves live here so scoring can be
// tuned or replaced later without touching game flow or the analyzer.

const SEMITONE_PENALTY = 8; // points lost per semitone of pitch deviation

// Gate: below this raw spectral-shape similarity (0..1, from
// REPLICO_ANALYZER.spectralSimilarity - DTW-aligned cosine similarity of
// segment-averaged frequency-band shape), the recording doesn't
// acoustically resemble the target at all, and the final score is forced
// to 0 no matter what pitch/timing/energy say. This is what stops "said a
// normal sentence with about the right pitch/length/loudness" from
// scoring well. Calibrated empirically against real animal-sound samples:
// a genuine (even rough) re-recording of the same sound consistently
// scored above ~0.75, while different real animal sounds, unrelated
// noise, and pitch/loudness-matched non-target audio topped out around
// ~0.74 - so 0.75 sits right at that gap.
const SIMILARITY_THRESHOLD = 0.75;

// Once a recording clears the gate, the final score is dominated by *how
// close* the spectral match is (not just that it passed), with pitch
// contour, pitch, timing, and energy only contributing a minor supporting
// share.
const OVERALL_WEIGHTS = { similarity: 0.6, pitchContour: 0.1, pitch: 0.1, timing: 0.1, energy: 0.1 };

// Second, independent gate: even a recording that clears the spectral-shape
// threshold gets rejected if its median pitch is in a completely different
// register from the target (more than an octave off). Testing against real
// animal-sound pairs found a few (e.g. a dog bark vs. a duck quack) whose
// coarse spectral *shape* was, awkwardly, close enough to slip past the
// threshold on its own - but their actual pitch register was wildly
// different (17-24 semitones, well over an octave), which the existing
// pitch comparison already reliably catches. A full octave of headroom
// (rather than the ~1-2 semitones a good match usually lands within) is
// deliberately generous so it only screens out register-level mismatches,
// not genuine imitations sung/spoken a bit high or low.
const MAX_REGISTER_MISMATCH_SEMITONES = 12;

// Third gate: if the target has real periodic/tonal content (most animal
// calls do) but the recording has essentially none, that's not an
// imitation attempt at all - it's unstructured noise (or silence past the
// active-region trim). Pure noise reliably measured a 0.0 voiced ratio in
// testing against every real animal sample, while every real animal
// sample measured well above this - so a low bar here only screens out
// "not even trying to be tonal," not genuine imitations.
const MIN_VOICED_RATIO_FOR_TONAL_TARGET = 0.15;
const VOICED_RATIO_FLOOR = 0.05;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pearsonCorrelation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;

  let meanA = 0, meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;

  let num = 0, denomA = 0, denomB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }

  const denom = Math.sqrt(denomA * denomB);
  if (denom < 1e-9) return 0;
  return num / denom;
}

function computeEnergyScore(refAnalysis, playerAnalysis) {
  const corr = pearsonCorrelation(refAnalysis.envelopeShape, playerAnalysis.envelopeShape);
  // map correlation [-1, 1] -> [0, 100]
  return clamp(((corr + 1) / 2) * 100, 0, 100);
}

function computeTimingScore(refAnalysis, playerAnalysis) {
  const refDur = refAnalysis.duration;
  const playerDur = playerAnalysis.duration;
  if (refDur <= 0) return 0;
  const diffRatio = Math.abs(refDur - playerDur) / Math.max(refDur, playerDur, 0.001);
  return clamp(100 * (1 - diffRatio), 0, 100);
}

function computePitchScore(refAnalysis, playerAnalysis) {
  if (refAnalysis.medianPitchHz === null || playerAnalysis.medianPitchHz === null) {
    return 0;
  }
  const semitoneDiff = Math.abs(
    12 * Math.log2(playerAnalysis.medianPitchHz / refAnalysis.medianPitchHz)
  );
  return clamp(100 - semitoneDiff * SEMITONE_PENALTY, 0, 100);
}

// Maps raw similarity in [threshold..1] to a 0..100 score: right at the
// gate it's ~0, and it only approaches 100 as the spectral match becomes
// genuinely close to the target.
function computeSimilarityScore(similarity) {
  if (similarity < SIMILARITY_THRESHOLD) return 0;
  const t = (similarity - SIMILARITY_THRESHOLD) / (1 - SIMILARITY_THRESHOLD);
  return clamp(t * 100, 0, 100);
}

/**
 * Compares the reference analysis against the player's recording analysis
 * and returns { pitch, timing, energy, overall }, all 0-100 integers.
 *
 * Sound-similarity is the gatekeeper: a recording that fails any of three
 * independent acoustic-resemblance checks against the target - spectral
 * shape (timbre, across the whole time course), pitch register (not off
 * by more than an octave), and having actual tonal/periodic content at
 * all when the target does - gets `overall: 0` regardless of how well its
 * duration, loudness, or average pitch happen to line up (which is what
 * let a normal spoken sentence score well before). Pitch/timing/energy
 * are still computed and returned for display either way, but only
 * recordings that clear all three gates get a non-zero overall score, and
 * that score is dominated by how close the spectral match actually is.
 */
function scoreAttempt(refAnalysis, playerAnalysis) {
  const pitch = computePitchScore(refAnalysis, playerAnalysis);
  const timing = computeTimingScore(refAnalysis, playerAnalysis);
  const energy = computeEnergyScore(refAnalysis, playerAnalysis);

  const spectralSim = window.REPLICO_ANALYZER.spectralSimilarity(
    refAnalysis.spectralFrames,
    playerAnalysis.spectralFrames
  );
  const registerMismatch =
    refAnalysis.medianPitchHz !== null && playerAnalysis.medianPitchHz !== null
      ? Math.abs(12 * Math.log2(playerAnalysis.medianPitchHz / refAnalysis.medianPitchHz))
      : null;
  const targetIsTonal = refAnalysis.voicedRatio >= MIN_VOICED_RATIO_FOR_TONAL_TARGET;
  const recordingHasNoTone = playerAnalysis.voicedRatio < VOICED_RATIO_FLOOR;

  if (
    spectralSim < SIMILARITY_THRESHOLD ||
    (registerMismatch !== null && registerMismatch > MAX_REGISTER_MISMATCH_SEMITONES) ||
    (targetIsTonal && recordingHasNoTone)
  ) {
    return { pitch: Math.round(pitch), timing: Math.round(timing), energy: Math.round(energy), overall: 0 };
  }

  // Pitch *contour* (melodic movement over time, not just the median used
  // above) is a single-frame-autocorrelation-based signal, which is prone
  // to octave errors and frame-alignment noise - too unreliable to gate
  // pass/fail on (testing showed it could occasionally rate a worse
  // imitation higher than a better one). So it only contributes a small
  // supporting share to the final score once the spectral-shape gate has
  // already confirmed the recording actually resembles the target, same
  // as pitch/timing/energy - it can nudge a passing score up or down, but
  // never zero one out or rescue one that shouldn't have passed.
  const pitchContourSim = window.REPLICO_ANALYZER.pitchContourSimilarity(
    refAnalysis.pitchContourShape,
    playerAnalysis.pitchContourShape
  );

  const similarityScore = computeSimilarityScore(spectralSim);
  const w = { ...OVERALL_WEIGHTS };
  let pitchContourScore = 0;
  if (pitchContourSim === null) {
    w.similarity += w.pitchContour; // not meaningful here - fold its share back into similarity
    w.pitchContour = 0;
  } else {
    pitchContourScore = pitchContourSim * 100;
  }

  const overall =
    similarityScore * w.similarity +
    pitchContourScore * w.pitchContour +
    pitch * w.pitch +
    timing * w.timing +
    energy * w.energy;

  return {
    pitch: Math.round(pitch),
    timing: Math.round(timing),
    energy: Math.round(energy),
    overall: Math.round(clamp(overall, 0, 100)),
  };
}

window.REPLICO_SCORING = { scoreAttempt };
