/**
 * Unit Tests - Character animation & switching (System Design §6.2, §46)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CharacterAnimator, pickPose, TIMED_STATES } = require('../../apps/desktop/character-state');
const { listCharacters, loadCharacter, REQUIRED_STATES } = require('../../apps/desktop/characters');
const { loadSettings, saveSettings, applyPatch, newCustomReminder, DEFAULTS } = require('../../apps/desktop/settings');

const CHARACTERS_DIR = path.join(__dirname, '..', '..', 'apps', 'desktop', 'assets', 'characters');

/** Fake timers we control by hand, so tests never actually wait. */
function manualTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => (pending.set(next, { fn, ms }), next++),
    clearTimeout: (id) => pending.delete(id),
    pending: () => [...pending.values()],
    fire() {
      const [[id, { fn }]] = pending.entries();
      pending.delete(id);
      fn();
    },
  };
}

const testCharacter = {
  poses: { a: 'a.png', b: 'b.png', wave: 'wave.png', zzz: 'zzz.png', think: 'think.png', yay: 'yay.png', fid: 'fid.png' },
  states: { idle: ['a'], greet: ['wave'], curious: ['a'], thinking: ['think'], talking: ['a', 'b'], success: ['yay'], warning: ['a'], error: ['b'], sleep: ['zzz'] },
  fidgets: ['fid'],
};

function makeAnimator() {
  const frames = [];
  const timers = manualTimers();
  const animator = new CharacterAnimator({ render: (f) => frames.push(f), random: () => 0, timers, fidgetDelay: [1000, 1000], fidgetLength: 500 });
  return { animator, frames, timers, last: () => frames[frames.length - 1] };
}

describe('CharacterAnimator', () => {
  test('greets when a character is loaded, then rests in idle', () => {
    const { animator, timers, last } = makeAnimator();
    animator.setCharacter(testCharacter);
    expect(last()).toEqual({ state: 'greet', pose: 'wave', src: 'wave.png' });
    expect(timers.pending()[0].ms).toBe(TIMED_STATES.greet);
    timers.fire();
    expect(last().state).toBe('idle');
  });

  test('plays a fidget while idle, then returns to idle', () => {
    const { animator, timers, last } = makeAnimator();
    animator.setCharacter(testCharacter);
    timers.fire(); // greet -> idle
    timers.fire(); // idle -> fidget
    expect(last()).toMatchObject({ state: 'fidget', pose: 'fid' });
    timers.fire(); // fidget -> idle
    expect(last().state).toBe('idle');
  });

  test('a new state cancels the pending one', () => {
    const { animator, timers, last } = makeAnimator();
    animator.setCharacter(testCharacter);
    animator.play('thinking');
    expect(last().state).toBe('thinking');
    expect(timers.pending()).toHaveLength(0); // thinking lasts until told otherwise
  });

  test('custom duration returns to rest afterwards', () => {
    const { animator, timers, last } = makeAnimator();
    animator.setCharacter(testCharacter);
    animator.play('talking', { duration: 3000 });
    expect(timers.pending()).toEqual([expect.objectContaining({ ms: 3000 })]);
    timers.fire();
    expect(last().state).toBe('idle');
  });

  test('quiet mode sleeps, and rests in sleep instead of idle', () => {
    const { animator, timers, last } = makeAnimator();
    animator.setCharacter(testCharacter);
    animator.setQuiet(true);
    expect(last().state).toBe('sleep');
    animator.play('success');
    timers.fire();
    expect(last().state).toBe('sleep');
    animator.setQuiet(false);
    expect(last().state).toBe('greet');
  });

  test('loading a character during quiet mode keeps it asleep', () => {
    const { animator, last } = makeAnimator();
    animator.quiet = true;
    animator.setCharacter(testCharacter);
    expect(last().state).toBe('sleep');
  });

  test('unknown states fall back to idle', () => {
    const { animator, last } = makeAnimator();
    animator.setCharacter(testCharacter);
    animator.play('dance');
    expect(last().state).toBe('idle');
  });

  test('does nothing before a character is loaded', () => {
    const { animator, frames } = makeAnimator();
    animator.play('greet');
    expect(frames).toEqual([]);
  });
});

describe('CharacterAnimator - entrance, reminders, fidgets', () => {
  const withEnter = { ...testCharacter, states: { ...testCharacter.states, enter: ['b'] }, reminders: { water: ['zzz'] } };

  test('runs in with the enter pose, then greets', () => {
    const { animator, timers, last } = makeAnimator();
    animator.setCharacter(withEnter);
    expect(last()).toMatchObject({ state: 'enter', pose: 'b' });
    timers.fire();
    expect(last().state).toBe('greet');
    timers.fire();
    expect(last().state).toBe('idle');
  });

  test('reminders show the matching pose and wait for the user', () => {
    const { animator, timers, last } = makeAnimator();
    animator.setCharacter(withEnter);
    animator.playReminder('water');
    expect(last()).toMatchObject({ state: 'reminder', pose: 'zzz' });
    expect(timers.pending()).toHaveLength(0);
  });

  test('unknown reminder types fall back to the warning pose', () => {
    const { animator, last } = makeAnimator();
    animator.setCharacter(testCharacter);
    animator.playReminder('meeting');
    expect(last().pose).toBe('a');
  });

  test('fidgets can be switched off', () => {
    const { animator, timers } = makeAnimator();
    animator.setFidgets(false);
    animator.setCharacter(testCharacter);
    timers.fire(); // greet -> idle
    expect(timers.pending()).toHaveLength(0); // no fidget scheduled
  });
});

describe('CharacterAnimator - activity moods', () => {
  const moodCharacter = { ...testCharacter, states: { ...testCharacter.states, music: ['b'], search: ['think'] } };

  test('resting state follows the mood', () => {
    const { animator, timers, last } = makeAnimator();
    animator.setCharacter(moodCharacter);
    timers.fire(); // greet -> idle
    animator.setMood('music');
    expect(last()).toMatchObject({ state: 'music', pose: 'b' });
    animator.setMood('search');
    expect(last().state).toBe('search');
    animator.setMood('away');
    expect(last().state).toBe('sleep');
    animator.setMood(null);
    expect(last().state).toBe('idle');
  });

  test('a mood change never interrupts a reminder', () => {
    const { animator, last } = makeAnimator();
    animator.setCharacter(moodCharacter);
    animator.playReminder('water');
    animator.setMood('music');
    expect(last().state).toBe('reminder');
    animator.rest(); // after the user answers
    expect(last().state).toBe('music');
  });

  test('timed reactions return to the current mood', () => {
    const { animator, timers, last } = makeAnimator();
    animator.setCharacter(moodCharacter);
    animator.setMood('music');
    animator.play('success');
    timers.fire();
    expect(last().state).toBe('music');
  });

  test('quiet mode wins over moods', () => {
    const { animator, last } = makeAnimator();
    animator.setCharacter(moodCharacter);
    animator.setQuiet(true);
    animator.setMood('music');
    animator.rest();
    expect(last().state).toBe('sleep');
  });
});

describe('pickPose', () => {
  test('avoids repeating the previous pose when there is a choice', () => {
    expect(pickPose(['a', 'b'], 'a', () => 0)).toBe('b');
    expect(pickPose(['a', 'b'], 'b', () => 0.99)).toBe('a');
  });

  test('repeats when there is only one pose', () => {
    expect(pickPose(['a'], 'a', () => 0.5)).toBe('a');
  });

  test('never goes out of range even if random() returns 1', () => {
    expect(pickPose(['a', 'b', 'c'], null, () => 1)).toBe('c');
  });
});

describe('Character packs', () => {
  test('bundled characters have an entrance and a pose for every reminder type', () => {
    for (const id of ['chibi', 'cat']) {
      const character = loadCharacter(CHARACTERS_DIR, id);
      expect(character.states.enter).toHaveLength(1);
      expect(Object.keys(character.reminders).sort()).toEqual(['break', 'meeting', 'save', 'water', 'work']);
    }
  });

  test('both bundled characters load and cover every state', () => {
    const ids = listCharacters(CHARACTERS_DIR).map((c) => c.id).sort();
    expect(ids).toEqual(['cat', 'chibi']);
    for (const id of ids) {
      const character = loadCharacter(CHARACTERS_DIR, id);
      expect(Object.keys(character.states).filter((s) => !['enter', 'search', 'music'].includes(s)).sort()).toEqual([...REQUIRED_STATES].sort());
      for (const src of Object.values(character.poses)) {
        expect(src).toMatch(new RegExp(`^assets/characters/${id}/poses/[a-z0-9_]+\\.(png|webp)$`));
      }
    }
  });

  describe('rejects bad or malicious packs', () => {
    let dir;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pebble-chars-'));
      fs.mkdirSync(path.join(dir, 'evil', 'poses'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'evil', 'poses', 'ok.png'), '');
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const allStates = (pose) => Object.fromEntries(REQUIRED_STATES.map((s) => [s, [pose]]));
    const write = (manifest) => fs.writeFileSync(path.join(dir, 'evil', 'manifest.json'), JSON.stringify(manifest));

    test.each(['../evil', '..\\evil', 'C:/Windows', 'Evil', ''])('invalid id "%s"', (id) => {
      expect(() => loadCharacter(dir, id)).toThrow();
    });

    test('pose file outside the poses folder', () => {
      write({ poses: { ok: '../../../secret.png' }, states: allStates('ok') });
      expect(() => loadCharacter(dir, 'evil')).toThrow(/invalid pose file/);
    });

    test('pose file that is not a PNG', () => {
      write({ poses: { ok: 'poses/ok.js' }, states: allStates('ok') });
      expect(() => loadCharacter(dir, 'evil')).toThrow(/invalid pose file/);
    });

    test('missing pose file', () => {
      write({ poses: { ok: 'poses/missing.png' }, states: allStates('ok') });
      expect(() => loadCharacter(dir, 'evil')).toThrow(/missing file/);
    });

    test('missing required state', () => {
      const states = allStates('ok');
      delete states.thinking;
      write({ poses: { ok: 'poses/ok.png' }, states });
      expect(() => loadCharacter(dir, 'evil')).toThrow(/thinking/);
    });

    test('state that points at a built-in object name', () => {
      write({ poses: { ok: 'poses/ok.png' }, states: { ...allStates('ok'), idle: ['constructor'] } });
      expect(() => loadCharacter(dir, 'evil')).toThrow(/idle/);
    });

    test('a valid minimal pack loads', () => {
      write({ name: 'Tester', poses: { ok: 'poses/ok.png' }, states: allStates('ok') });
      expect(loadCharacter(dir, 'evil', 'chars')).toMatchObject({ id: 'evil', name: 'Tester', poses: { ok: 'chars/evil/poses/ok.png' }, fidgets: [] });
    });
  });
});

describe('Settings', () => {
  let dir;
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pebble-settings-'))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('defaults when no file exists', () => {
    expect(loadSettings(path.join(dir, 'settings.json'))).toEqual(DEFAULTS);
  });

  test('saves and loads', () => {
    const file = path.join(dir, 'sub', 'settings.json');
    saveSettings(file, applyPatch(DEFAULTS, { characterId: 'cat', quietMode: true }));
    expect(loadSettings(file)).toMatchObject({ characterId: 'cat', quietMode: true });
  });

  test('ignores corrupted files and wrongly typed values', () => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{not json');
    expect(loadSettings(file)).toEqual(DEFAULTS);
    fs.writeFileSync(file, JSON.stringify({ characterId: 42, quietMode: 'yes', extra: true, animation: { level: 'crazy' } }));
    expect(loadSettings(file)).toEqual(DEFAULTS);
  });

  test('patches merge deeply and are re-validated', () => {
    const s = applyPatch(DEFAULTS, { reminders: { hydration: { everyMin: 1 } }, animation: { level: 'reduced' } });
    expect(s.reminders.hydration).toEqual({ enabled: true, everyMin: 5 }); // clamped to the 5 minute minimum
    expect(s.reminders.stretch).toEqual(DEFAULTS.reminders.stretch); // untouched
    expect(s.animation).toEqual({ level: 'reduced', fidgets: true });
  });

  test('patches cannot inject unknown keys or pollute prototypes', () => {
    const s = applyPatch(DEFAULTS, JSON.parse('{"__proto__": {"admin": true}, "secretMode": true, "ai": {"provider": "evil"}}'));
    expect(s).not.toHaveProperty('secretMode');
    expect(s.ai.provider).toBe('anthropic');
    expect({}.admin).toBeUndefined();
  });

  test('custom reminders are validated and trimmed', () => {
    const ok = newCustomReminder('  Team meeting  ', 123);
    expect(ok).toMatchObject({ text: 'Team meeting', at: 123 });
    expect(() => newCustomReminder('', 1)).toThrow();
    expect(() => newCustomReminder('x', NaN)).toThrow();
    const s = applyPatch(DEFAULTS, { customReminders: [ok, { id: 'bad' }, { id: 'x', text: 'y'.repeat(500), at: 5 }] });
    expect(s.customReminders).toHaveLength(2);
    expect(s.customReminders[1].text).toHaveLength(140);
  });
});
