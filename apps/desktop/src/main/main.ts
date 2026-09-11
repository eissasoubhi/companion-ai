import { app, BrowserWindow, ipcMain, session } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  configureMediaPermissionHandlers,
  getMicrophonePermissionStatus,
  requestMicrophonePermission,
} from './media-permissions.js';
import {
  configureSystemAudioCapture,
  getSystemAudioCapability,
} from './system-audio.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

function registerIpcHandlers(): void {
  ipcMain.handle('microphone:get-permission', () => getMicrophonePermissionStatus());
  ipcMain.handle('microphone:request-permission', () => requestMicrophonePermission());
  ipcMain.handle('system-audio:get-capability', () => getSystemAudioCapability());
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: 'Companion AI',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(currentDir, 'preload.cjs'),
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());

  void window.loadFile(join(currentDir, '../renderer/index.html'));

  return window;
}

app.whenReady().then(() => {
  configureMediaPermissionHandlers(session.defaultSession);
  configureSystemAudioCapture(session.defaultSession);
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
