const { contextBridge, ipcRenderer } = require('electron');

// Character window API. Only these narrow, typed functions are visible to the
// renderer. Never expose ipcRenderer itself or generic send/invoke helpers.
contextBridge.exposeInMainWorld('api', {
  setClickThrough: (enabled) => ipcRenderer.send('set-click-through', Boolean(enabled)),
  dragStart: (offsetX, offsetY) => ipcRenderer.send('drag-start', Number(offsetX), Number(offsetY)),
  dragEnd: () => ipcRenderer.send('drag-end'),
  openSettings: () => ipcRenderer.send('open-settings'),
  respondReminder: (id, action) => ipcRenderer.send('reminder-respond', String(id), String(action)),
  getCharacter: () => ipcRenderer.invoke('get-character'),
  getSettings: () => ipcRenderer.invoke('get-character-settings'),
  onQuietModeChanged: (callback) => {
    ipcRenderer.on('quiet-mode-changed', (_event, enabled) => callback(Boolean(enabled)));
  },
  onCharacterChanged: (callback) => {
    ipcRenderer.on('character-changed', (_event, character) => callback(character));
  },
  onSettingsChanged: (callback) => {
    ipcRenderer.on('settings-changed', (_event, settings) => callback(settings));
  },
  onReminder: (callback) => {
    ipcRenderer.on('reminder', (_event, reminder) => callback(reminder));
  },
  onPreview: (callback) => {
    ipcRenderer.on('play-preview', () => callback());
  },
  // Coarse activity events only ({ type, on } or { type, app }); never window titles.
  onActivity: (callback) => {
    ipcRenderer.on('activity', (_event, activity) => callback(activity));
  },
  onGoodbye: (callback) => {
    ipcRenderer.on('goodbye', (_event, info) => callback(info));
  },
  onShown: (callback) => {
    ipcRenderer.on('shown', () => callback());
  },
  greeted: () => ipcRenderer.send('greeted')
});
