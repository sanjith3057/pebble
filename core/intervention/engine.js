// Scoring weights from System Design §10. Tune these with real usage data.
const WEIGHTS = Object.freeze({
  helpfulness: 40,
  confidence: 25,
  urgency: 15,
  userRequested: 30,
  interruptionCost: -30,
  recentDismissal: -25,
  focusDetected: -20,
});

const OFFER_THRESHOLD = 50;
const HIGH_PRIORITY_THRESHOLD = 75;
const MAX_INTERRUPTIONS_PER_HOUR = 3;

function clamp01(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Decide whether Pebble should interrupt right now.
 *
 * @param {object} candidate
 * @param {number} candidate.helpfulness       0..1
 * @param {number} candidate.confidence        0..1
 * @param {number} candidate.urgency           0..1
 * @param {number} candidate.interruptionCost  0..1
 * @param {string} candidate.reason
 * @param {object} state
 * @param {boolean} [state.userRequested]       The user asked; always answer.
 * @param {boolean} [state.quietMode]
 * @param {boolean} [state.focused]             Typing, full-screen, presenting, gaming, DND...
 * @param {boolean} [state.recentlyDismissed]   A similar suggestion was dismissed recently.
 * @param {number}  [state.interruptionsLastHour]
 */
function decideIntervention(candidate, state = {}) {
  const c = {
    helpfulness: clamp01(candidate.helpfulness),
    confidence: clamp01(candidate.confidence),
    urgency: clamp01(candidate.urgency),
    interruptionCost: clamp01(candidate.interruptionCost),
  };
  const result = (decision, score, reason) => ({
    decision,
    score,
    confidence: c.confidence,
    priority: decision === 'stay_quiet' ? 'none' : score >= HIGH_PRIORITY_THRESHOLD ? 'high' : 'medium',
    reason,
  });

  const score = Math.round(
    c.helpfulness * WEIGHTS.helpfulness +
      c.confidence * WEIGHTS.confidence +
      c.urgency * WEIGHTS.urgency +
      (state.userRequested ? WEIGHTS.userRequested : 0) +
      c.interruptionCost * WEIGHTS.interruptionCost +
      (state.recentlyDismissed ? WEIGHTS.recentDismissal : 0) +
      (state.focused ? WEIGHTS.focusDetected : 0),
  );

  // Hard rules come before the score.
  if (state.userRequested) return result('offer_help', Math.max(score, OFFER_THRESHOLD), 'User asked for help');
  if (state.quietMode) return result('stay_quiet', score, 'Quiet mode is on');
  if ((state.interruptionsLastHour || 0) >= MAX_INTERRUPTIONS_PER_HOUR) {
    return result('stay_quiet', score, 'Interruption limit reached for this hour');
  }

  if (score >= OFFER_THRESHOLD) return result('offer_help', score, candidate.reason || 'Likely helpful');
  return result('stay_quiet', score, 'Not helpful enough to interrupt');
}

module.exports = { WEIGHTS, OFFER_THRESHOLD, MAX_INTERRUPTIONS_PER_HOUR, decideIntervention };
