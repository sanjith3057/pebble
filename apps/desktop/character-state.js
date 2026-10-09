/**
 * Character animation state machine (System Design §6.2, §46.3).
 *
 * Picks which pose to show for each state, returns to rest after short
 * reactions, and plays random "fidget" poses while idle so the character feels
 * alive. Rendering is done by the `render` callback, so this file has no DOM
 * code and can be unit-tested. Loaded as a plain <script> in the renderer
 * (exposes window.CharacterState) and via require() in tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CharacterState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Reactions that return to the rest state on their own, in ms.
  const TIMED_STATES = Object.freeze({ greet: 2500, curious: 4000, success: 2500, warning: 4000, error: 3000 });

  const DEFAULT_FIDGET_DELAY = Object.freeze([12000, 25000]); // random wait while idle
  const DEFAULT_FIDGET_LENGTH = 4000;
  const ENTER_MS = 1100;
  const RESTING_STATES = ['idle', 'fidget', 'music', 'search', 'sleep'];

  /** Random pose from `list`, avoiding an immediate repeat of `last` when possible. */
  function pickPose(list, last, random) {
    const options = list.length > 1 ? list.filter((pose) => pose !== last) : list;
    return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
  }

  class CharacterAnimator {
    /**
     * @param {object} options
     * @param {(frame: { state: string, pose: string, src: string }) => void} options.render
     * @param {() => number} [options.random]
     * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
     */
    constructor({ render, random = Math.random, timers, fidgetDelay = DEFAULT_FIDGET_DELAY, fidgetLength = DEFAULT_FIDGET_LENGTH }) {
      this.render = render;
      this.random = random;
      this.timers = timers || { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };
      this.fidgetDelay = fidgetDelay;
      this.fidgetLength = fidgetLength;
      this.character = null;
      this.state = null;
      this.pose = null;
      this.quiet = false;
      this.fidgets = true;
      this.mood = null;
      this.timer = null;
    }

    /** Switch character and play its entry animation (§46.2): walk/run in, then wave. */
    setCharacter(character) {
      this.character = character;
      this.pose = null;
      if (this.quiet) this.play('sleep');
      else if (character.states.enter) this.play('enter', { duration: ENTER_MS, then: 'greet' });
      else this.play('greet');
    }

    /**
     * Show a state. Timed reactions return to rest automatically; pass
     * `duration` to time any state (e.g. talking until a reply finishes) and
     * `then` to choose the state that follows.
     */
    play(state, { duration, then } = {}) {
      if (!this.character) return;
      if (!this.character.states[state]) state = 'idle';
      this.cancelTimer();

      this.state = state;
      this.show(state, pickPose(this.character.states[state], this.pose, this.random));

      const ms = duration !== undefined ? duration : TIMED_STATES[state];
      if (ms) this.schedule(() => (then ? this.play(then) : this.rest()), ms);
      else if (state === 'idle') this.scheduleFidget();
    }

    /** Show a reminder pose (water, break, work, meeting) until the user answers. */
    playReminder(type) {
      if (!this.character) return;
      this.cancelTimer();
      const reminders = this.character.reminders || {};
      const poses = reminders[type] || this.character.states.warning;
      this.state = 'reminder';
      this.show('reminder', pickPose(poses, this.pose, this.random));
    }

    /**
     * Rest state follows the user's activity: sleep in quiet mode or while the
     * user is away, the music pose while music plays, the search pose while
     * searching, otherwise idle.
     */
    rest() {
      if (this.quiet || this.mood === 'away') this.play('sleep');
      else if (this.mood === 'music' || this.mood === 'search') this.play(this.mood);
      else this.play('idle');
    }

    /** @param {null|'music'|'search'|'away'} mood */
    setMood(mood) {
      if (mood === this.mood) return;
      this.mood = mood;
      // Only change what's on screen if Pebble is resting; never cut off a reminder or a reply.
      if (RESTING_STATES.includes(this.state)) this.rest();
    }

    setQuiet(quiet) {
      if (quiet === this.quiet) return;
      this.quiet = quiet;
      this.play(quiet ? 'sleep' : 'greet');
    }

    setFidgets(enabled) {
      this.fidgets = enabled;
      if (this.state === 'fidget' || this.state === 'idle') this.play('idle');
    }

    stop() {
      this.cancelTimer();
    }

    // --- internals ---

    show(state, pose) {
      this.pose = pose;
      this.render({ state, pose, src: this.character.poses[pose] });
    }

    scheduleFidget() {
      const fidgets = this.character.fidgets || [];
      if (!this.fidgets || fidgets.length === 0) return;
      const [min, max] = this.fidgetDelay;
      this.schedule(() => {
        this.state = 'fidget';
        this.show('fidget', pickPose(fidgets, this.pose, this.random));
        this.schedule(() => this.play('idle'), this.fidgetLength);
      }, min + this.random() * (max - min));
    }

    schedule(fn, ms) {
      this.cancelTimer();
      this.timer = this.timers.setTimeout(() => {
        this.timer = null;
        fn();
      }, ms);
    }

    cancelTimer() {
      if (this.timer !== null) this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  return { CharacterAnimator, pickPose, TIMED_STATES, ENTER_MS };
});
