const { app, BrowserWindow, Tray, Menu } = require('electron');
const path = require('path');

let win = null;
let tray = null;

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 300,
    height: 300,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,      // SECURE: Disable node integration in renderer
      contextIsolation: true,      // SECURE: Isolate preload/renderer contexts
      sandbox: true,               // SECURE: Enable sandbox
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // SECURE: Click-through for transparent areas
  win.setIgnoreMouseEvents(true, { forward: true });

  // SECURE: Prevent window opening (popups)
  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // SECURE: Prevent navigation
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
}

function createTray() {
  // Use a placeholder icon for now (or a real path if available)
  // In a real app, you need a small icon file (e.g. tray-icon.png or .ico)
  // tray = new Tray(path.join(__dirname, 'tray-icon.png'));
  
  // Note: Since we don't have an icon file right now, we can create an empty NativeImage
  const { nativeImage } = require('electron');
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings', click: () => { console.log('Settings clicked'); } },
    { label: 'Quiet Mode', type: 'checkbox', checked: false },
    { type: 'separator' },
    { label: 'Quit Clippy', click: () => { app.quit(); } }
  ]);
  
  tray.setToolTip('Clippy 2.0');
  tray.setContextMenu(contextMenu);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
