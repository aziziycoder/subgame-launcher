import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { getHardwareId } from './hwid';
import { loadLicenseStore, activateLicense } from './license';
import { launchGameWithProtection, injectSubtitleFile } from './gameRunner';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 1024,
    minHeight: 680,
    frame: false, // Frameless custom modern gaming UI
    backgroundColor: '#090d16',
    icon: path.join(__dirname, '../../public/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    title: 'SubGame Launcher',
  });

  const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  mainWindow.webContents.setUserAgent(CHROME_UA);

  // Handle Google OAuth Popups in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('accounts.google.com') || url.includes('firebaseapp.com') || url.includes('oauth')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          width: 520,
          height: 680,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Check if running in dev mode
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexPath = path.join(__dirname, '../../dist/index.html');
    mainWindow.loadFile(indexPath).catch(() => {
      // If built differently
      mainWindow?.loadURL(`file://${path.resolve(__dirname, '../dist/index.html')}`);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = CHROME_UA;
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC: Window Controls
ipcMain.on('window-control', (_, action: 'minimize' | 'maximize' | 'close') => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  else if (action === 'maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  } else if (action === 'close') {
    mainWindow.close();
  }
});

// IPC: Open External URL in default browser
ipcMain.on('open-external', (_, url: string) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});

// IPC: Get Hardware ID
ipcMain.handle('get-hwid', () => {
  return getHardwareId();
});

// IPC: Get Saved Licenses
ipcMain.handle('get-licenses', () => {
  const store = loadLicenseStore();
  return store.licenses;
});

// IPC: Activate License Key
ipcMain.handle('activate-license', (_, { key, gameTitle }: { key: string; gameTitle: string }) => {
  return activateLicense(key, gameTitle);
});

// IPC: Select Game Executable File Dialog
ipcMain.handle('select-game-exe', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "O'yin ijro faylini (.exe) tanlang",
    properties: ['openFile'],
    filters: [{ name: 'Ijro fayllari (*.exe)', extensions: ['exe'] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// IPC: Launch Game with Protection
ipcMain.handle('launch-game', async (_, config) => {
  const result = await launchGameWithProtection(config, (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game-status', status);
    }
  });
  return result;
});

// IPC: Install Subtitle Only
ipcMain.handle('install-subtitle', async (_, config) => {
  return injectSubtitleFile(config, (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game-status', status);
    }
  });
});

// IPC: Open Game Folder in Explorer
ipcMain.handle('open-game-folder', async (_, exePath: string) => {
  if (exePath) {
    const dir = fs.existsSync(exePath) && fs.statSync(exePath).isFile() ? path.dirname(exePath) : exePath;
    if (fs.existsSync(dir)) {
      shell.openPath(dir);
      return true;
    }
  }
  return false;
});
