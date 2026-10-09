const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, safeStorage, session, shell, dialog, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { listCharacters, loadCharacter } = require('./characters');
const { loadSettings, saveSettings, applyPatch, newCustomReminder, defaultSettings, sanitizeRendererPatch } = require('./settings');
const { EncryptedJsonStore } = require('../../security/secrets/encrypted-store');
const { ApiKeyStore, PROVIDERS } = require('../../security/secrets/key-store');
const { testApiKey } = require('../../security/secrets/key-tester');
const { VectorStore } = require('../../core/memory/vector-store');
const { AgentCoordinator } = require('../../core/agents/coordinator');
const { ActivityMonitor } = require('../../core/activity/activity-monitor');
const { createWindowsReader } = require('../../adapters/operating_system/windows-activity');

const INDEX_FILE = path.join(__dirname, 'index.html');
const SETTINGS_FILE = path.join(__dirname, 'settings.html');
const INDEX_URL = pathToFileURL(INDEX_FILE).href;
const SETTINGS_URL = pathToFileURL(SETTINGS_FILE).href;
const CHARACTERS_DIR = path.join(__dirname, 'assets', 'characters');
const AGENT_TICK_MS = 30 * 1000;
const ACTIVITY_TICK_MS = 2000;
const AWAY_AFTER_S = 10 * 60;
const GOODBYE_MS = 1800;
const HIDE_MS = 700;
const MAX_REMINDER_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

let win = null;
let settingsWin = null;
let tray = null;
let dragTimer = null;
let settingsPath = null;
let settings = null;
let keyStore = null;
let memory = null;
let coordinator = null;
let activityReader = null;
let activityMonitor = null;
let away = false;
let quitting = false;

// SECURE: app-wide lockdown for every window, including ones added later.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));       // no popups
  contents.on('will-navigate', (event) => event.preventDefault()); // no navigating away
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    // SECURE: deny camera, mic, notifications, etc. unless we add them on purpose.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    // PRIVACY: pages never talk to the internet. Only the main process may, and
    // only for features the user turned on (AI keys), never in offline mode.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) =>
      callback({ cancel: true })
    );

    const userData = app.getPath('userData');
    migrateFromOldName(userData);
    settingsPath = path.join(userData, 'settings.json');
    settings = loadSettings(settingsPath);
    ensureValidCharacter();

    // Secrets and memories are encrypted with the OS keychain (DPAPI on Windows).
    keyStore = new ApiKeyStore({ store: new EncryptedJsonStore({ file: path.join(userData, 'secrets.bin'), encryption: safeStorage }) });
    memory = new VectorStore({ persistence: new EncryptedJsonStore({ file: path.join(userData, 'memory.bin'), encryption: safeStorage }) });
    coordinator = new AgentCoordinator({ getConfig: () => settings, getState: () => ({ quietMode: settings.quietMode }) });

    activityReader = createWindowsReader();
    activityMonitor = activityReader ? new ActivityMonitor({ reader: activityReader, getSignals: () => settings.activity.signals }) : null;

    registerIpc();
    createWindow();
    createTray();
    setInterval(runAgents, AGENT_TICK_MS);
    setInterval(runActivity, ACTIVITY_TICK_MS);
    powerMonitor.on('lock-screen', () => setAway(true));
    powerMonitor.on('unlock-screen', () => setAway(false));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// Closing animation: let Pebble wave goodbye before the app exits.
app.on('before-quit', (event) => {
  if (quitting || !win || !win.isVisible()) return;
  event.preventDefault();
  quitting = true;
  win.webContents.send('goodbye', { quit: true });
  setTimeout(() => app.quit(), GOODBYE_MS);
});

/**
 * The app used to be called "Clippy 2.0". Copy its data once so settings, keys
 * and memories survive the rename. Encrypted files still open: Windows ties
 * them to the user account, not the folder. The old folder is left untouched.
 */
function migrateFromOldName(userData) {
  if (fs.existsSync(path.join(userData, 'settings.json'))) return;
  const oldDir = ['Clippy 2.0', 'clippy-2']
    .map((name) => path.join(app.getPath('appData'), name))
    .find((dir) => fs.existsSync(path.join(dir, 'settings.json')));
  if (!oldDir) return;
  fs.mkdirSync(userData, { recursive: true });
  for (const file of ['settings.json', 'secrets.bin', 'memory.bin']) {
    const from = path.join(oldDir, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(userData, file));
  }
}

// ---------- Windows ----------

const SECURE_PREFS = { nodeIntegration: false, contextIsolation: true, sandbox: true };

function createWindow() {
  win = new BrowserWindow({
    width: 320,
    height: 440,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,             // Lives in the tray, not the taskbar
    hasShadow: false,
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'preload.js') }
  });

  win.loadFile(INDEX_FILE);

  // Transparent areas pass clicks through to the desktop. The renderer turns
  // this off while the cursor is over the character (see 'set-click-through').
  // `forward: true` keeps mousemove events flowing so the renderer can detect that.
  win.setIgnoreMouseEvents(true, { forward: true });

  win.on('closed', () => {
    stopDrag();
    win = null;
  });
}

function openSettings() {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 520,
    height: 680,
    resizable: false,
    title: 'Pebble Settings',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#f6f7fb',
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'preload-settings.js') }
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(SETTINGS_FILE);
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

function showPebble() {
  if (win && !win.isVisible()) {
    win.show();
    win.webContents.send('shown');
  }
}

function hidePebble() {
  if (!win || !win.isVisible()) return;
  win.webContents.send('goodbye', { quit: false });
  setTimeout(() => win && win.hide(), HIDE_MS);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png')));
  tray.on('click', showPebble);
  updateTrayMenu();
}

function updateTrayMenu() {
  const characterItems = listCharacters(CHARACTERS_DIR).map(({ id, name }) => ({
    label: name,
    type: 'radio',
    checked: id === settings.characterId,
    click: () => setCharacter(id)
  }));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Show Pebble', click: showPebble },
    { label: 'Hide Pebble', click: hidePebble },
    { label: 'Character', submenu: characterItems },
    { label: 'Preview Animations', click: () => win && win.webContents.send('play-preview') },
    { label: 'Quiet Mode', type: 'checkbox', checked: settings.quietMode, click: (item) => updateSettings({ quietMode: item.checked }) },
    // Visible at all times while on, with a one-click off switch.
    ...(settings.activity.enabled ? [{ label: 'Activity Awareness (on)', type: 'checkbox', checked: true, click: () => revokeActivity() }] : []),
    ...(settings.privacy.offlineMode ? [{ label: 'Offline Mode (on)', enabled: false }] : []),
    { type: 'separator' },
    { label: 'Quit Pebble', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip(`Pebble${settings.activity.enabled ? ' · activity awareness on' : ''}${settings.privacy.offlineMode ? ' · offline' : ''}`);
}

// ---------- State changes ----------

/** Fall back to the first installed character if the saved one is gone. */
function ensureValidCharacter() {
  const ids = listCharacters(CHARACTERS_DIR).map((c) => c.id);
  if (!ids.includes(settings.characterId) && ids.length > 0) settings.characterId = ids[0];
}

function persistSettings() {
  try {
    saveSettings(settingsPath, settings);
  } catch (error) {
    console.error('Could not save settings:', error.message);
  }
}

function setCharacter(id) {
  const character = loadCharacter(CHARACTERS_DIR, id); // throws on unknown/invalid ids
  settings.characterId = id;
  persistSettings();
  updateTrayMenu();
  if (win) win.webContents.send('character-changed', character);
}

function updateSettings(patch) {
  const before = settings;
  settings = applyPatch(settings, patch);
  persistSettings();
  updateTrayMenu();
  if (before.activity.enabled && !settings.activity.enabled) resetActivity();
  if (win) {
    if (before.quietMode !== settings.quietMode) win.webContents.send('quiet-mode-changed', settings.quietMode);
    win.webContents.send('settings-changed', characterSettings());
  }
  return settings;
}

/** The subset of settings the character window needs. */
function characterSettings() {
  return { quietMode: settings.quietMode, animation: settings.animation, firstRunDone: settings.firstRunDone };
}

// ---------- Agents & activity ----------

function runAgents() {
  if (!win || !win.isVisible() || quitting) return;
  const reminder = coordinator.tick();
  if (reminder) win.webContents.send('reminder', reminder);
}

function setAway(value) {
  if (value === away) return;
  away = value;
  if (win && settings.activity.enabled && settings.activity.signals.away) win.webContents.send('activity', { type: 'away', on: away });
}

/**
 * PRIVACY: runs only after explicit consent. Window titles are classified and
 * dropped inside ActivityMonitor; only coarse events reach this function, and
 * nothing here is stored, logged or sent anywhere.
 */
function runActivity() {
  if (!settings.activity.enabled || !win || !win.isVisible() || quitting) return;

  if (settings.activity.signals.away) {
    const idle = powerMonitor.getSystemIdleTime();
    if (!away && idle >= AWAY_AFTER_S) setAway(true);
    else if (away && idle < 5) setAway(false);
  }
  if (!activityMonitor) return;

  for (const event of activityMonitor.poll()) {
    if (event.type === 'search-started' || event.type === 'search-ended') {
      win.webContents.send('activity', { type: 'search', on: event.type === 'search-started' });
    } else if (event.type === 'music-started' || event.type === 'music-stopped') {
      win.webContents.send('activity', { type: 'music', on: event.type === 'music-started' });
    } else if (event.type === 'app-closed') {
      win.webContents.send('activity', { type: 'app-closed', app: event.app });
    } else if (event.type === 'unsaved-left') {
      // Pebble only asks. It never presses Save or closes other apps for you.
      const reminder = coordinator.offer({
        agentId: `unsaved:${event.app}`,
        reminderType: 'save',
        text: `${event.app} still has unsaved changes. Want to go back and save?`,
        labels: { done: 'Got it', snooze: 'Not now' },
        helpfulness: 0.85,
        confidence: 0.75,
        urgency: 0.6,
        interruptionCost: 0.2,
      });
      if (reminder) win.webContents.send('reminder', reminder);
    }
  }
}

async function askActivityConsent() {
  const { response } = await dialog.showMessageBox(settingsWin || win, {
    type: 'question',
    title: 'Activity awareness',
    message: 'Let Pebble react to what you are doing?',
    detail: [
      'Pebble will look at the name and title of your open windows every 2 seconds to notice when you search, play music, leave unsaved work or close an app.',
      '',
      '• Everything stays on this PC. Nothing is saved, logged or sent to any AI or server.',
      '• Window titles are turned into simple labels (like "music") and thrown away immediately.',
      '• Private/incognito windows and password managers are ignored.',
      '• Pebble never reads what is inside windows, never logs keys and never clicks or types in other apps.',
      '',
      'You can turn this off any time from Settings > Privacy or the tray menu.'
    ].join('\n'),
    buttons: ['Allow', 'Not now'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (response !== 0) return false;
  updateSettings({ activity: { enabled: true, consentedAt: Date.now() } });
  return true;
}

function resetActivity() {
  if (activityMonitor) activityMonitor.reset();
  away = false;
  if (win) win.webContents.send('activity', { type: 'reset' });
}

function revokeActivity() {
  updateSettings({ activity: { enabled: false, consentedAt: null } });
}

async function deleteAllData() {
  const { response } = await dialog.showMessageBox(settingsWin || win, {
    type: 'warning',
    title: 'Delete all my data',
    message: 'Delete all of your Pebble data?',
    detail: 'This removes your API keys, memories, reminders and settings from this PC. It cannot be undone.',
    buttons: ['Delete everything', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (response !== 0) return false;
  keyStore.removeAll();
  memory.clear();
  settings = { ...defaultSettings(), characterId: settings.characterId, firstRunDone: true };
  updateSettings({});
  resetActivity();
  return true;
}

// ---------- IPC ----------

// SECURE: each channel only accepts calls from the one page meant to use it.
function fromPage(event, url) {
  return event.senderFrame !== null && event.senderFrame.url === url;
}

function on(channel, url, listener) {
  ipcMain.on(channel, (event, ...args) => {
    if (fromPage(event, url)) listener(...args);
  });
}

/** Settings-window handlers return { ok, ...result } or { ok: false, error }. */
function handleSettings(name, listener) {
  ipcMain.handle(`settings:${name}`, async (event, ...args) => {
    if (!fromPage(event, SETTINGS_URL)) return { ok: false, error: 'Not allowed' };
    try {
      return { ok: true, ...(await listener(...args)) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

function settingsState() {
  return {
    settings,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    activitySupported: Boolean(activityReader),
    characters: listCharacters(CHARACTERS_DIR).map(({ id, name }) => {
      const character = loadCharacter(CHARACTERS_DIR, id);
      return { id, name, preview: character.poses[character.states.greet[0]] };
    }),
    providers: keyStore.status(),
    agents: coordinator.status(),
    memories: memory.list()
  };
}

function registerIpc() {
  // --- character window ---
  on('set-click-through', INDEX_URL, (enabled) => {
    if (!win || typeof enabled !== 'boolean') return;
    win.setIgnoreMouseEvents(enabled, { forward: true });
  });

  // Dragging is done here instead of with `-webkit-app-region: drag`, because
  // drag regions swallow clicks and don't work with click-through windows.
  on('drag-start', INDEX_URL, (offsetX, offsetY) => {
    if (!win || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;
    stopDrag();
    dragTimer = setInterval(() => {
      if (!win) return stopDrag();
      const cursor = screen.getCursorScreenPoint();
      win.setPosition(Math.round(cursor.x - offsetX), Math.round(cursor.y - offsetY));
    }, 16);
  });

  on('drag-end', INDEX_URL, () => stopDrag());
  on('open-settings', INDEX_URL, () => openSettings());
  on('reminder-respond', INDEX_URL, (id, action) => {
    if (['done', 'snooze', 'dismiss'].includes(action)) coordinator.respond(id, action);
  });
  on('greeted', INDEX_URL, () => {
    if (!settings.firstRunDone) updateSettings({ firstRunDone: true });
  });

  ipcMain.handle('get-character', (event) => {
    if (!fromPage(event, INDEX_URL)) return null;
    try {
      return loadCharacter(CHARACTERS_DIR, settings.characterId);
    } catch (error) {
      console.error(error.message);
      return null;
    }
  });
  ipcMain.handle('get-character-settings', (event) => (fromPage(event, INDEX_URL) ? characterSettings() : null));

  // --- settings window ---
  handleSettings('get-state', () => settingsState());
  handleSettings('update', (patch) => ({ settings: updateSettings(sanitizeRendererPatch(patch)) }));
  handleSettings('set-character', (id) => {
    setCharacter(id);
    return { settings };
  });
  handleSettings('preview', () => {
    if (win) win.webContents.send('play-preview');
    return {};
  });

  // Privacy
  handleSettings('activity-consent', async () => ({ granted: await askActivityConsent(), settings }));
  handleSettings('activity-revoke', () => {
    revokeActivity();
    return { settings };
  });
  handleSettings('delete-all-data', async () => {
    const deleted = await deleteAllData();
    return { deleted, ...settingsState() };
  });

  // API keys: write-only from the UI's point of view.
  handleSettings('set-api-key', (provider, key) => {
    keyStore.set(provider, key);
    return { providers: keyStore.status() };
  });
  handleSettings('remove-api-key', (provider) => {
    keyStore.remove(provider);
    return { providers: keyStore.status() };
  });
  // Only ever opens the providers' own key pages, never a URL from the renderer.
  handleSettings('open-keys-page', (provider) => {
    if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Unknown provider');
    shell.openExternal(PROVIDERS[provider].keysUrl);
    return {};
  });
  handleSettings('test-api-key', async (provider) => {
    if (settings.privacy.offlineMode) return { result: { ok: false, message: 'Offline mode is on. Turn it off in Privacy to test keys.' } };
    const key = keyStore.get(provider);
    if (!key) return { result: { ok: false, message: 'No key saved for this provider.' } };
    return { result: await testApiKey(provider, key) };
  });

  // Memory (vector store)
  handleSettings('memory-add', (text) => {
    const { redactions } = memory.add(text, { source: 'user' });
    return { memories: memory.list(), redactions };
  });
  handleSettings('memory-search', (query) => ({ results: memory.search(query) }));
  handleSettings('memory-remove', (id) => {
    memory.remove(id);
    return { memories: memory.list() };
  });
  handleSettings('memory-clear', () => {
    memory.clear();
    return { memories: [] };
  });

  // Reminders & agents
  handleSettings('reminder-add', (text, at) => {
    if (!(at > Date.now()) || at - Date.now() > MAX_REMINDER_AHEAD_MS) throw new Error('Pick a time in the next 30 days');
    updateSettings({ customReminders: [...settings.customReminders, newCustomReminder(text, at)] });
    return { settings };
  });
  handleSettings('reminder-remove', (id) => {
    updateSettings({ customReminders: settings.customReminders.filter((r) => r.id !== id) });
    return { settings };
  });
  handleSettings('agent-test', (agentId) => {
    const reminder = coordinator.trigger(agentId);
    if (!reminder) throw new Error('Another reminder is already showing');
    if (win) {
      showPebble();
      win.webContents.send('reminder', reminder);
    }
    return {};
  });
}

function stopDrag() {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
