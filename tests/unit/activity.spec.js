/**
 * Unit Tests - Activity awareness (System Design §7, §11): classifier and monitor
 */
const { classifyWindow, friendlyName } = require('../../core/activity/classifier');
const { ActivityMonitor, UNSAVED_MIN_MS, UNSAVED_COOLDOWN_MS } = require('../../core/activity/activity-monitor');

describe('classifyWindow', () => {
  test.each([
    ['chrome.exe', 'how to bake bread - Google Search - Google Chrome'],
    ['msedge.exe', 'electron ipc - Search - Microsoft Edge'],
    ['firefox.exe', 'privacy laws at DuckDuckGo — Mozilla Firefox'],
    ['SearchHost.exe', 'Search'],
  ])('detects searching in %s', (exe, title) => {
    expect(classifyWindow({ exe, title }).searching).toBe(true);
  });

  test.each([
    ['Spotify.exe', 'Daft Punk - One More Time'],
    ['vlc.exe', 'song.mp3 - VLC media player'],
    ['chrome.exe', 'Lo-fi beats - YouTube Music - Google Chrome'],
  ])('detects music in %s', (exe, title) => {
    expect(classifyWindow({ exe, title }).music).toBe(true);
  });

  test.each([
    ['Spotify.exe', 'Spotify Premium'],
    ['Spotify.exe', 'Spotify'],
    ['vlc.exe', 'VLC media player'],
  ])('a paused player is not music (%s "%s")', (exe, title) => {
    expect(classifyWindow({ exe, title }).music).toBe(false);
  });

  test.each([
    ['notepad.exe', '*Untitled - Notepad'],
    ['Code.exe', '● main.js - clippy - Visual Studio Code'],
    ['WINWORD.EXE', 'Report.docx (modified) - Word'],
  ])('detects unsaved work in %s', (exe, title) => {
    expect(classifyWindow({ exe, title }).unsaved).toBe(true);
  });

  test('pages that merely mention "search" are not searches', () => {
    expect(classifyWindow({ exe: 'msedge.exe', title: 'Search engine history - Wikipedia - Microsoft Edge' }).searching).toBe(false);
  });

  test('saved documents and browser tabs are not "unsaved"', () => {
    expect(classifyWindow({ exe: 'notepad.exe', title: 'notes.txt - Notepad' }).unsaved).toBe(false);
    expect(classifyWindow({ exe: 'chrome.exe', title: '*New* deals - Google Chrome' }).unsaved).toBe(false);
  });

  test.each([
    ['chrome.exe', 'Bank - Google Chrome (Incognito)'],
    ['msedge.exe', 'Search - [InPrivate] - Microsoft Edge'],
    ['firefox.exe', 'Mozilla Firefox Private Browsing'],
    ['1Password.exe', '1Password'],
    ['KeePassXC.exe', 'Passwords.kdbx - KeePassXC'],
  ])('private windows and password managers are marked private and nothing else (%s)', (exe, title) => {
    expect(classifyWindow({ exe, title })).toMatchObject({ private: true, searching: false, music: false, unsaved: false });
  });

  test('the result never contains the window title', () => {
    const title = 'Secret project plans - Google Search - Google Chrome';
    expect(JSON.stringify(classifyWindow({ exe: 'chrome.exe', title }))).not.toMatch(/Secret|project|plans/);
  });

  test('friendly app names', () => {
    expect(friendlyName('WINWORD.EXE')).toBe('Word');
    expect(friendlyName('obsidian.exe')).toBe('Obsidian');
    expect(friendlyName('')).toBe('this app');
  });
});

describe('ActivityMonitor', () => {
  function setup(signals = { search: true, music: true, unsaved: true, appClose: true }) {
    let now = 1_000_000;
    let fg = null;
    let windows = [];
    const reader = { foreground: () => fg, windows: () => windows };
    const monitor = new ActivityMonitor({ reader, now: () => now, getSignals: () => signals });
    return {
      monitor,
      setForeground: (w) => (fg = w),
      setWindows: (w) => (windows = w),
      advance: (ms) => (now += ms),
    };
  }

  test('search started and ended', () => {
    const t = setup();
    t.setForeground({ exe: 'chrome.exe', title: 'cats - Google Search - Google Chrome' });
    expect(t.monitor.poll()).toEqual([{ type: 'search-started' }]);
    expect(t.monitor.poll()).toEqual([]);
    t.setForeground({ exe: 'notepad.exe', title: 'notes.txt - Notepad' });
    expect(t.monitor.poll()).toEqual([{ type: 'search-ended' }]);
  });

  test('searching in a private window is ignored', () => {
    const t = setup();
    t.setForeground({ exe: 'chrome.exe', title: 'cats - Google Search - Google Chrome (Incognito)' });
    expect(t.monitor.poll()).toEqual([]);
  });

  test('music from a background player, with a grace period between songs', () => {
    const t = setup();
    const playing = [{ exe: 'Spotify.exe', title: 'Artist - Song' }];
    t.setWindows(playing);
    expect(t.monitor.poll()).toEqual([{ type: 'music-started' }]);
    t.setWindows([{ exe: 'Spotify.exe', title: 'Spotify Premium' }]);
    expect(t.monitor.poll()).toEqual([]); // one gap is ignored
    expect(t.monitor.poll()).toEqual([{ type: 'music-stopped' }]);
  });

  test('asks about unsaved work only after a while, then waits before asking again', () => {
    const t = setup();
    const unsaved = { exe: 'notepad.exe', title: '*Untitled - Notepad' };
    const other = { exe: 'chrome.exe', title: 'News - Google Chrome' };

    t.setForeground(unsaved);
    t.monitor.poll();
    t.advance(30 * 1000);
    t.setForeground(other);
    expect(t.monitor.poll()).toEqual([]); // too soon to nag

    t.setForeground(unsaved);
    t.monitor.poll();
    t.advance(UNSAVED_MIN_MS);
    t.setForeground(other);
    expect(t.monitor.poll()).toEqual([{ type: 'unsaved-left', app: 'Notepad' }]);

    t.setForeground(unsaved);
    t.monitor.poll();
    t.advance(UNSAVED_MIN_MS);
    t.setForeground(other);
    expect(t.monitor.poll()).toEqual([]); // cooldown

    t.advance(UNSAVED_COOLDOWN_MS);
    t.setForeground(unsaved);
    t.monitor.poll();
    t.advance(UNSAVED_MIN_MS);
    t.setForeground(other);
    expect(t.monitor.poll()).toEqual([{ type: 'unsaved-left', app: 'Notepad' }]);
  });

  test('saving clears the unsaved timer', () => {
    const t = setup();
    t.setForeground({ exe: 'notepad.exe', title: '*Untitled - Notepad' });
    t.monitor.poll();
    t.advance(UNSAVED_MIN_MS);
    t.setForeground({ exe: 'notepad.exe', title: 'notes.txt - Notepad' });
    t.monitor.poll();
    t.setForeground({ exe: 'chrome.exe', title: 'x - Google Chrome' });
    expect(t.monitor.poll()).toEqual([]);
  });

  test('reports closed apps only if the user actually used them', () => {
    const t = setup();
    t.setWindows([
      { exe: 'notepad.exe', title: 'notes.txt - Notepad' },
      { exe: 'OneDrive.exe', title: 'OneDrive' },
    ]);
    t.setForeground({ exe: 'notepad.exe', title: 'notes.txt - Notepad' });
    t.monitor.poll();
    t.setWindows([]);
    expect(t.monitor.poll()).toEqual([{ type: 'app-closed', app: 'Notepad' }]); // not OneDrive
  });

  test('switched-off signals produce no events', () => {
    const t = setup({ search: false, music: false, unsaved: false, appClose: false });
    t.setForeground({ exe: 'chrome.exe', title: 'a - Google Search - Google Chrome' });
    t.setWindows([{ exe: 'Spotify.exe', title: 'Artist - Song' }]);
    expect(t.monitor.poll()).toEqual([]);
  });

  test('turning music off while playing sends music-stopped', () => {
    const signals = { search: true, music: true, unsaved: true, appClose: true };
    const t = setup(signals);
    t.setWindows([{ exe: 'Spotify.exe', title: 'Artist - Song' }]);
    t.monitor.poll();
    signals.music = false;
    expect(t.monitor.poll()).toEqual([{ type: 'music-stopped' }]);
  });

  test('events never contain window titles', () => {
    const t = setup();
    t.setForeground({ exe: 'chrome.exe', title: 'TOPSECRET - Google Search - Google Chrome' });
    t.setWindows([{ exe: 'Spotify.exe', title: 'TOPSECRET song' }]);
    expect(JSON.stringify(t.monitor.poll())).not.toContain('TOPSECRET');
  });

  test('reset forgets everything', () => {
    const t = setup();
    t.setWindows([{ exe: 'Spotify.exe', title: 'Artist - Song' }]);
    t.monitor.poll();
    t.monitor.reset();
    expect(t.monitor.music).toBe(false);
    expect(t.monitor.usedApps.size).toBe(0);
  });
});
