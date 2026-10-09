/**
 * Integration Tests - Context → Gateway → Prompt / Intervention → Suggestion
 * (System Design §8, §10, §26)
 */
const { processContextEvent } = require('../../core/context/gateway');
const { decideIntervention } = require('../../core/intervention/engine');
const { buildMessages } = require('../../core/conversation/prompt-builder');
const { PermissionStore } = require('../../security/permissions/permissions');

const errorInClipboard = {
  type: 'clipboard',
  source: 'desktop',
  timestamp: '2026-10-09T12:00:00Z',
  data: { text: 'TypeError: Cannot read properties of undefined (reading "map")\n  token=sk-live_abcdefghijklmnopqrstuvwx' },
};

// Stand-in for the AI's suggestion; the real one will come from the orchestrator.
const candidate = { helpfulness: 0.9, confidence: 0.85, urgency: 0.4, interruptionCost: 0.2, reason: 'Possible debugging issue detected' };

describe('Context to suggestion flow', () => {
  test('granted context is redacted, wrapped as data, and can lead to a suggestion', () => {
    const permissions = new PermissionStore();
    permissions.grant('context.clipboard');

    const ctx = processContextEvent(errorInClipboard, { permissions });
    expect(ctx.allowed).toBe(true);

    const prompt = buildMessages({ system: 'You are Pebble.', userMessage: 'Explain this error', context: [ctx.package] });
    expect(prompt.messages[0].content).toContain('TypeError');
    expect(prompt.messages[0].content).not.toContain('sk-live_abcdefghij'); // secret never reaches the AI
    expect(prompt.messages[0].content).toContain('[REDACTED');

    const decision = decideIntervention(candidate, {});
    expect(decision).toMatchObject({ decision: 'offer_help', reason: 'Possible debugging issue detected' });
  });

  test('without permission, nothing reaches the AI', () => {
    const ctx = processContextEvent(errorInClipboard, { permissions: new PermissionStore() });
    expect(ctx.allowed).toBe(false);
    expect(ctx).not.toHaveProperty('package');
  });

  test('a good suggestion still waits while the user is focused', () => {
    expect(decideIntervention(candidate, {}).decision).toBe('offer_help');
    expect(decideIntervention(candidate, { focused: true }).decision).toBe('stay_quiet');
  });

  test('a recently dismissed suggestion is not repeated straight away', () => {
    expect(decideIntervention(candidate, {}).decision).toBe('offer_help');
    expect(decideIntervention(candidate, { recentlyDismissed: true }).decision).toBe('stay_quiet');
  });

  test('quiet mode silences proactive help but the user can still ask', () => {
    expect(decideIntervention(candidate, { quietMode: true }).decision).toBe('stay_quiet');
    expect(decideIntervention(candidate, { quietMode: true, userRequested: true }).decision).toBe('offer_help');
  });
});
