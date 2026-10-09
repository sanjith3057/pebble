/**
 * UX Tests - Is Pebble helpful without being annoying? (System Design §30, §43)
 */
const { computeUxMetrics, MIN_SAMPLE } = require('../../core/intervention/metrics');

const repeat = (n, event) => Array.from({ length: n }, () => ({ ...event }));

describe('computeUxMetrics', () => {
  test('computes acceptance and dismissal rates', () => {
    const events = [...repeat(10, { type: 'shown' }), ...repeat(4, { type: 'accepted' }), ...repeat(3, { type: 'dismissed' })];
    const m = computeUxMetrics(events);
    expect(m.acceptanceRate).toBeCloseTo(0.4);
    expect(m.dismissalRate).toBeCloseTo(0.3);
    expect(m.isHelpful).toBe(true);
    expect(m.isAnnoying).toBe(false);
  });

  test('flags Pebble as annoying when most suggestions are dismissed', () => {
    const events = [...repeat(10, { type: 'shown' }), ...repeat(7, { type: 'dismissed' }), { type: 'accepted' }];
    const m = computeUxMetrics(events);
    expect(m.isAnnoying).toBe(true);
    expect(m.isHelpful).toBe(false);
  });

  test('does not judge with too little data', () => {
    const events = [...repeat(MIN_SAMPLE - 1, { type: 'shown' }), ...repeat(MIN_SAMPLE - 1, { type: 'dismissed' })];
    const m = computeUxMetrics(events);
    expect(m.enoughData).toBe(false);
    expect(m.isAnnoying).toBe(false);
  });

  test('sums time saved from accepted suggestions only', () => {
    const events = [
      { type: 'accepted', timeSavedSeconds: 30 },
      { type: 'accepted', timeSavedSeconds: 90 },
      { type: 'dismissed', timeSavedSeconds: 999 },
      { type: 'accepted' },
    ];
    expect(computeUxMetrics(events).timeSavedSeconds).toBe(120);
  });

  test('measures how often Pebble chose to speak versus stay quiet', () => {
    const events = [...repeat(2, { type: 'shown' }), ...repeat(8, { type: 'stayed_quiet' })];
    expect(computeUxMetrics(events).proactiveRatio).toBeCloseTo(0.2);
  });

  test('handles no data without dividing by zero', () => {
    expect(computeUxMetrics([])).toMatchObject({ acceptanceRate: 0, dismissalRate: 0, proactiveRatio: 0, timeSavedSeconds: 0 });
  });
});
