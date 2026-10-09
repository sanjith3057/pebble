/**
 * Unit Tests - Intervention scoring (System Design §10, §11)
 */
const { decideIntervention, MAX_INTERRUPTIONS_PER_HOUR } = require('../../core/intervention/engine');

const strong = { helpfulness: 0.9, confidence: 0.9, urgency: 0.5, interruptionCost: 0.1, reason: 'Possible bug' };
const weak = { helpfulness: 0.3, confidence: 0.4, urgency: 0.1, interruptionCost: 0.5 };

describe('decideIntervention', () => {
  test('offers help for a strong, low-cost suggestion', () => {
    const result = decideIntervention(strong);
    expect(result.decision).toBe('offer_help');
    expect(result.reason).toBe('Possible bug');
    expect(['medium', 'high']).toContain(result.priority);
  });

  test('stays quiet for a weak suggestion', () => {
    const result = decideIntervention(weak);
    expect(result.decision).toBe('stay_quiet');
    expect(result.priority).toBe('none');
  });

  test('uses the documented weights', () => {
    // 1*40 + 1*25 + 1*15 - 0 = 80
    expect(decideIntervention({ helpfulness: 1, confidence: 1, urgency: 1, interruptionCost: 0 }).score).toBe(80);
    // focus (-20) and recent dismissal (-25) both subtract
    expect(
      decideIntervention({ helpfulness: 1, confidence: 1, urgency: 1, interruptionCost: 0 }, { focused: true, recentlyDismissed: true }).score,
    ).toBe(35);
  });

  test('focus pushes a borderline suggestion into silence', () => {
    const borderline = { helpfulness: 1, confidence: 0.8, urgency: 0.2, interruptionCost: 0.2 }; // 40+20+3-6 = 57
    expect(decideIntervention(borderline).decision).toBe('offer_help');
    expect(decideIntervention(borderline, { focused: true }).decision).toBe('stay_quiet'); // 57-20 = 37
  });

  test('quiet mode silences even strong suggestions', () => {
    const result = decideIntervention(strong, { quietMode: true });
    expect(result.decision).toBe('stay_quiet');
    expect(result.reason).toMatch(/Quiet mode/);
  });

  test('rate limit silences suggestions after too many interruptions', () => {
    expect(decideIntervention(strong, { interruptionsLastHour: MAX_INTERRUPTIONS_PER_HOUR }).decision).toBe('stay_quiet');
    expect(decideIntervention(strong, { interruptionsLastHour: MAX_INTERRUPTIONS_PER_HOUR - 1 }).decision).toBe('offer_help');
  });

  test('a user request is always answered, even in quiet mode', () => {
    expect(decideIntervention(weak, { userRequested: true, quietMode: true }).decision).toBe('offer_help');
  });

  test('bad inputs are clamped instead of inflating the score', () => {
    const result = decideIntervention({ helpfulness: 99, confidence: NaN, urgency: -5, interruptionCost: 'x' });
    expect(result.score).toBe(40);
  });
});
