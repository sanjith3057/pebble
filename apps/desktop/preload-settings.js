const { contextBridge, ipcRenderer } = require('electron');

// Settings window API. API keys only travel ONE way (renderer -> main) through
// setApiKey; nothing here can read a key back. The UI only sees
// { configured, hint: '…abcd' } from getState().
const invoke = (channel, ...args) => ipcRenderer.invoke(`settings:${channel}`, ...args);

contextBridge.exposeInMainWorld('settingsApi', {
  getState: () => invoke('get-state'),
  update: (patch) => invoke('update', patch),
  setCharacter: (id) => invoke('set-character', String(id)),
  previewAnimations: () => invoke('preview'),

  // Consent is shown as a native Windows dialog by the main process.
  requestActivityConsent: () => invoke('activity-consent'),
  revokeActivity: () => invoke('activity-revoke'),
  deleteAllData: () => invoke('delete-all-data'),

  setApiKey: (provider, key) => invoke('set-api-key', String(provider), String(key)),
  removeApiKey: (provider) => invoke('remove-api-key', String(provider)),
  testApiKey: (provider) => invoke('test-api-key', String(provider)),
  openKeysPage: (provider) => invoke('open-keys-page', String(provider)),

  addMemory: (text) => invoke('memory-add', String(text)),
  searchMemory: (query) => invoke('memory-search', String(query)),
  removeMemory: (id) => invoke('memory-remove', String(id)),
  clearMemory: () => invoke('memory-clear'),

  addReminder: (text, at) => invoke('reminder-add', String(text), Number(at)),
  removeReminder: (id) => invoke('reminder-remove', String(id)),
  testAgent: (agentId) => invoke('agent-test', String(agentId))
});
