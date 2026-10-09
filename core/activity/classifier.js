/**
 * Turns a window (process name + title) into coarse activity labels.
 *
 * PRIVACY: the title is read here and nowhere else. The result contains only
 * labels and a friendly app name, never the title itself, so what you are
 * searching for, listening to or editing never leaves this function.
 */

// Windows where Pebble must look away completely.
const PRIVATE_TITLE = /\b(InPrivate|Incognito|Private Browsing|Private window)\b/i;
const PRIVATE_APPS = /^(1password|bitwarden|keepass\w*|lastpass|dashlane|keeper|credentialuibroker|consent|logonui)\.exe$/i;

const BROWSERS = /^(chrome|msedge|firefox|brave|opera|opera_gx|vivaldi|arc|zen|librewolf|waterfox)\.exe$/i;
const OS_SEARCH = /^(searchhost|searchapp|searchui)\.exe$/i;
// Browsers append their own name ("... - Search - Microsoft Edge"), so match " - Search" before " - " or the end.
const SEARCH_TITLE = /( - Google Search| - Search( - |$)| - Bing( - |$)| at DuckDuckGo| - Brave Search| - Startpage| - Ecosia| - Perplexity)/i;

// Music: a desktop player whose title shows a track, or a music site in a browser.
const MUSIC_APPS = {
  'spotify.exe': (t) => t !== '' && !/^Spotify( Premium| Free)?$/i.test(t),
  'vlc.exe': (t) => / - VLC media player$/i.test(t),
  'foobar2000.exe': (t) => /\[foobar2000\]/i.test(t) && !/^foobar2000/i.test(t),
  'aimp.exe': (t) => t !== '' && !/^AIMP$/i.test(t),
  'musicbee.exe': (t) => / - MusicBee$/i.test(t),
  'tidal.exe': (t) => t !== '' && !/^TIDAL$/i.test(t),
  'deezer.exe': (t) => / - Deezer$/i.test(t),
};
const MUSIC_SITES = /( - YouTube Music| - SoundCloud|Spotify – Web Player| \| Spotify|Apple Music| - Deezer| - TIDAL)/i;

// Unsaved-changes markers used by common editors: "*Untitled - Notepad", "● file.js - VS Code".
const UNSAVED = /(^\*|\*$|\* - |●|\bUnsaved\b|\(modified\))/i;

const FRIENDLY_NAMES = {
  'code.exe': 'VS Code',
  'notepad.exe': 'Notepad',
  'winword.exe': 'Word',
  'excel.exe': 'Excel',
  'powerpnt.exe': 'PowerPoint',
  'msedge.exe': 'Edge',
  'chrome.exe': 'Chrome',
  'firefox.exe': 'Firefox',
  'spotify.exe': 'Spotify',
};

function friendlyName(exe) {
  const key = String(exe || '').toLowerCase();
  if (FRIENDLY_NAMES[key]) return FRIENDLY_NAMES[key];
  const base = key.replace(/\.exe$/, '');
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'this app';
}

/**
 * @param {{ exe: string, title: string }} window
 * @returns {{ app: string, private: boolean, searching: boolean, music: boolean, unsaved: boolean }}
 */
function classifyWindow({ exe, title }) {
  const name = String(exe || '').toLowerCase();
  const text = String(title || '');
  const none = { app: friendlyName(name), private: false, searching: false, music: false, unsaved: false };

  if (PRIVATE_APPS.test(name) || PRIVATE_TITLE.test(text)) return { ...none, private: true };

  const isBrowser = BROWSERS.test(name);
  return {
    ...none,
    searching: OS_SEARCH.test(name) || (isBrowser && SEARCH_TITLE.test(text)),
    music: Object.hasOwn(MUSIC_APPS, name) ? MUSIC_APPS[name](text) : isBrowser && MUSIC_SITES.test(text),
    unsaved: !isBrowser && UNSAVED.test(text),
  };
}

module.exports = { classifyWindow, friendlyName };
