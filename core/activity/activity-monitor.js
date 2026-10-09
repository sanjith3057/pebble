const { classifyWindow } = require('./classifier');

const UNSAVED_MIN_MS = 2 * 60 * 1000;     // unsaved for at least this long before we mention it
const UNSAVED_COOLDOWN_MS = 30 * 60 * 1000; // per app, so we never nag
const MUSIC_STOP_POLLS = 2;                 // ignore one-poll gaps between songs

// Processes that open and close windows constantly; never report them.
const IGNORED = /^(explorer|searchhost|searchapp|shellexperiencehost|startmenuexperiencehost|textinputhost|applicationframehost|systemsettings|lockapp|electron|pebble.*|clippy.*)\.exe$/i;

/**
 * Watches activity signals from a window reader and emits coarse events.
 *
 * PRIVACY: titles go straight into the classifier and are dropped. This class
 * only keeps process names and booleans in memory, never writes anything to
 * disk, and its events contain only an event type and a friendly app name.
 *
 * Events: search-started, search-ended, music-started, music-stopped,
 *         unsaved-left { app }, app-closed { app }
 */
class ActivityMonitor {
  /**
   * @param {object} deps
   * @param {{ foreground(): { exe: string, title: string } | null, windows(): Array<{ exe: string, title: string }> }} deps.reader
   * @param {() => number} [deps.now]
   * @param {() => { search?: boolean, music?: boolean, unsaved?: boolean, appClose?: boolean }} [deps.getSignals]
   */
  constructor({ reader, now = () => Date.now(), getSignals = () => ({ search: true, music: true, unsaved: true, appClose: true }) }) {
    this.reader = reader;
    this.now = now;
    this.getSignals = getSignals;
    this.searching = false;
    this.music = false;
    this.musicMisses = 0;
    this.foreground = null;        // exe of the current foreground app
    this.unsavedSince = new Map(); // exe -> first time seen unsaved in the foreground
    this.cooldownUntil = new Map(); // exe -> time
    this.usedApps = new Set();     // apps the user actually brought to the front
    this.openApps = null;          // exes with visible windows at the last poll
  }

  /** Read once and return the events since the last poll. */
  poll() {
    const signals = this.getSignals();
    const now = this.now();
    const events = [];
    const fg = this.reader.foreground();
    const fgInfo = fg ? classifyWindow(fg) : null;
    const fgExe = fg && !fgInfo.private ? String(fg.exe).toLowerCase() : null;

    // Searching (foreground only)
    const searching = Boolean(signals.search && fgInfo && !fgInfo.private && fgInfo.searching);
    if (searching !== this.searching) events.push({ type: searching ? 'search-started' : 'search-ended' });
    this.searching = searching;

    // Unsaved work left behind when switching to another app
    if (signals.unsaved && fgExe !== this.foreground && this.foreground) {
      const since = this.unsavedSince.get(this.foreground);
      if (since !== undefined && now - since >= UNSAVED_MIN_MS && now >= (this.cooldownUntil.get(this.foreground) || 0)) {
        events.push({ type: 'unsaved-left', app: classifyWindow({ exe: this.foreground, title: '' }).app });
        this.cooldownUntil.set(this.foreground, now + UNSAVED_COOLDOWN_MS);
      }
      this.unsavedSince.delete(this.foreground);
    }
    if (fgExe) {
      if (fgInfo.unsaved) {
        if (!this.unsavedSince.has(fgExe)) this.unsavedSince.set(fgExe, now);
      } else {
        this.unsavedSince.delete(fgExe);
      }
      this.usedApps.add(fgExe);
    }
    this.foreground = fgExe;

    // Music and closed apps need every visible window.
    if (signals.music || signals.appClose) {
      const windows = this.reader.windows();
      const visible = windows.map((w) => ({ exe: String(w.exe).toLowerCase(), info: classifyWindow(w) })).filter((w) => !w.info.private);

      if (signals.music) {
        const playing = visible.some((w) => w.info.music);
        this.musicMisses = playing ? 0 : this.musicMisses + 1;
        if (playing && !this.music) {
          this.music = true;
          events.push({ type: 'music-started' });
        } else if (!playing && this.music && this.musicMisses >= MUSIC_STOP_POLLS) {
          this.music = false;
          events.push({ type: 'music-stopped' });
        }
      }

      const open = new Set(visible.map((w) => w.exe).filter((exe) => !IGNORED.test(exe)));
      if (signals.appClose && this.openApps) {
        for (const exe of this.openApps) {
          if (!open.has(exe) && this.usedApps.has(exe)) {
            events.push({ type: 'app-closed', app: classifyWindow({ exe, title: '' }).app });
            this.usedApps.delete(exe);
          }
        }
      }
      this.openApps = open;
    }

    if (!signals.music && this.music) {
      this.music = false;
      events.push({ type: 'music-stopped' });
    }
    return events;
  }

  /** Forget everything (when the user turns activity awareness off). */
  reset() {
    this.searching = false;
    this.music = false;
    this.musicMisses = 0;
    this.foreground = null;
    this.unsavedSince.clear();
    this.cooldownUntil.clear();
    this.usedApps.clear();
    this.openApps = null;
  }
}

module.exports = { ActivityMonitor, UNSAVED_MIN_MS, UNSAVED_COOLDOWN_MS };
