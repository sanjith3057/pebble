const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Safe, typed IPC methods will be exposed here for the renderer to communicate with the main process.
});
