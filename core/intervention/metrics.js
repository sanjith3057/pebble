// UX health thresholds (System Design §30 UX Tests, §43 Success Criteria).
const MIN_ACCEPTANCE_RATE = 0.3;
const MAX_DISMISSAL_RATE = 0.5;
const MIN_SAMPLE = 10;

/**
 * Summarise how proactive suggestions are being received.
 * @param {Array<{ type: 'shown'|'accepted'|'dismissed'|'stayed_quiet', timeSavedSeconds?: number }>} events
 */
function computeUxMetrics(events) {
  const count = (type) => events.filter((e) => e.type === type).length;
  const shown = count('shown');
  const accepted = count('accepted');
  const dismissed = count('dismissed');
  const stayedQuiet = count('stayed_quiet');
  const decisions = shown + stayedQuiet;

  const acceptanceRate = shown ? accepted / shown : 0;
  const dismissalRate = shown ? dismissed / shown : 0;
  const timeSavedSeconds = events
    .filter((e) => e.type === 'accepted' && Number.isFinite(e.timeSavedSeconds))
    .reduce((sum, e) => sum + e.timeSavedSeconds, 0);

  const enoughData = shown >= MIN_SAMPLE;
  return {
    shown,
    accepted,
    dismissed,
    acceptanceRate,
    dismissalRate,
    proactiveRatio: decisions ? shown / decisions : 0,
    timeSavedSeconds,
    enoughData,
    isAnnoying: enoughData && dismissalRate > MAX_DISMISSAL_RATE,
    isHelpful: enoughData && acceptanceRate >= MIN_ACCEPTANCE_RATE,
  };
}

module.exports = { MIN_ACCEPTANCE_RATE, MAX_DISMISSAL_RATE, MIN_SAMPLE, computeUxMetrics };
