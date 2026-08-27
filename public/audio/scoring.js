// Turns two analyzeBuffer() results (reference vs. player recording) into
// the four displayed scores. Weights and curves live here so scoring can be
// tuned or replaced later without touching game flow or the analyzer.

const WEIGHTS = { pitch: 0.4, timing: 0.3, energy: 0.3 };
const SEMITONE_PENALTY = 8; // points lost per semitone of pitch deviation

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

/**
 * Compares the reference analysis against the player's recording analysis
 * and returns { pitch, timing, energy, overall }, all 0-100 integers.
 */
function scoreAttempt(refAnalysis, playerAnalysis) {
  const pitch = computePitchScore(refAnalysis, playerAnalysis);
  const timing = computeTimingScore(refAnalysis, playerAnalysis);
  const energy = computeEnergyScore(refAnalysis, playerAnalysis);

  const overall =
    pitch * WEIGHTS.pitch + timing * WEIGHTS.timing + energy * WEIGHTS.energy;

  return {
    pitch: Math.round(pitch),
    timing: Math.round(timing),
    energy: Math.round(energy),
    overall: Math.round(overall),
  };
}

window.REPLICO_SCORING = { scoreAttempt };
