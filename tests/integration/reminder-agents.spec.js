/**
 * Integration Tests - Reminder agents → coordinator → Intervention Engine (System Design §10, §33)
 */
const { AgentCoordinator } = require('../../core/agents/coordinator');
const { BUILTIN_AGENTS } = require('../../core/agents/reminder-agents');
const { decideIntervention } = require('../../core/intervention/engine');
const { defaultSettings, applyPatch } = require('../../apps/desktop/settings');

const MIN = 60 * 1000;

function setup(patch = {}, state = {}) {
  let now = 1_000_000_000;
  let settings = applyPatch(defaultSettings(), patch);
  const coordinator = new AgentCoordinator({ now: () => now, getConfig: () => settings, getState: () => state });
  return {
    coordinator,
    advance: (ms) => (now += ms),
    now: () => now,
    setSettings: (p) => (settings = applyPatch(settings, p)),
  };
}

// Only hydration on, every 10 minutes, to keep timing simple.
const onlyHydration = {
  reminders: { hydration: { enabled: true, everyMin: 10 }, stretch: { enabled: false }, eyes: { enabled: false }, focus: { enabled: false } },
};

describe('AgentCoordinator', () => {
  test('every built-in agent clears the threshold normally but not while focused', () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(decideIntervention(agent.scores).decision).toBe('offer_help');
      expect(decideIntervention(agent.scores, { focused: true }).decision).toBe('stay_quiet');
    }
  });

  test('stays quiet until an agent is due, then reminds', () => {
    const t = setup(onlyHydration);
    expect(t.coordinator.tick()).toBeNull();
    t.advance(9 * MIN);
    expect(t.coordinator.tick()).toBeNull();
    t.advance(1 * MIN);
    expect(t.coordinator.tick()).toMatchObject({ agentId: 'hydration', type: 'water' });
  });

  test('only one reminder at a time', () => {
    const t = setup({ reminders: { hydration: { enabled: true, everyMin: 10 }, stretch: { enabled: true, everyMin: 10 } } });
    t.advance(10 * MIN);
    expect(t.coordinator.tick()).not.toBeNull();
    expect(t.coordinator.tick()).toBeNull();
  });

  test('"done" restarts the interval', () => {
    const t = setup(onlyHydration);
    t.advance(10 * MIN);
    const r = t.coordinator.tick();
    expect(t.coordinator.respond(r.id, 'done')).toBe(true);
    t.advance(5 * MIN);
    expect(t.coordinator.tick()).toBeNull();
    t.advance(5 * MIN);
    expect(t.coordinator.tick()).not.toBeNull();
  });

  test('snooze delays by 10 minutes', () => {
    const t = setup({ reminders: { hydration: { enabled: true, everyMin: 5 }, stretch: { enabled: false } } });
    t.advance(5 * MIN);
    const r = t.coordinator.tick();
    t.coordinator.respond(r.id, 'snooze');
    t.advance(9 * MIN);
    expect(t.coordinator.tick()).toBeNull();
    t.advance(1 * MIN);
    expect(t.coordinator.tick()).toMatchObject({ agentId: 'hydration' });
  });

  test('answers for a stale or unknown reminder are ignored', () => {
    const t = setup(onlyHydration);
    expect(t.coordinator.respond('nope', 'done')).toBe(false);
  });

  test('quiet mode silences agents', () => {
    const t = setup(onlyHydration, { quietMode: true });
    t.advance(60 * MIN);
    expect(t.coordinator.tick()).toBeNull();
  });

  test('the master switch turns all agents off', () => {
    const t = setup({ ...onlyHydration, reminders: { ...onlyHydration.reminders, enabled: false } });
    t.advance(60 * MIN);
    expect(t.coordinator.tick()).toBeNull();
  });

  test('at most 3 reminders per hour', () => {
    const t = setup({ reminders: { hydration: { enabled: true, everyMin: 5 }, stretch: { enabled: false } } });
    let shown = 0;
    for (let i = 0; i < 12; i++) {
      t.advance(5 * MIN);
      const r = t.coordinator.tick();
      if (r) {
        shown++;
        t.coordinator.respond(r.id, 'done');
      }
    }
    expect(shown).toBe(3 + 0); // the 4th..12th within the same hour are held back
  });

  test('custom reminders fire at their time, even in quiet mode, and only once', () => {
    const t = setup({ ...onlyHydration, reminders: { ...onlyHydration.reminders, enabled: false } }, { quietMode: true });
    t.setSettings({ customReminders: [{ id: 'm1', text: 'Team meeting', at: t.now() + 30 * MIN }] });
    t.advance(29 * MIN);
    expect(t.coordinator.tick()).toBeNull();
    t.advance(1 * MIN);
    const r = t.coordinator.tick();
    expect(r).toMatchObject({ type: 'meeting', text: 'Team meeting' });
    t.coordinator.respond(r.id, 'done');
    t.advance(5 * MIN);
    expect(t.coordinator.tick()).toBeNull();
  });

  test('test button shows a reminder immediately', () => {
    const t = setup(onlyHydration);
    expect(t.coordinator.trigger('eyes')).toMatchObject({ agentId: 'eyes', type: 'break' });
    expect(t.coordinator.trigger('stretch')).toBeNull(); // one at a time
    expect(setup().coordinator.trigger('unknown')).toBeNull();
  });

  test('status lists every agent with its next due time', () => {
    const t = setup(onlyHydration);
    const status = t.coordinator.status();
    expect(status.map((s) => s.id)).toEqual(BUILTIN_AGENTS.map((a) => a.id));
    expect(status.find((s) => s.id === 'hydration')).toMatchObject({ enabled: true, nextAt: t.now() + 10 * MIN });
    expect(status.find((s) => s.id === 'stretch')).toMatchObject({ enabled: false, nextAt: null });
  });
});
