import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { spawn } from 'child_process';
import { getHardwareId } from './hwid';
import { loadLicenseStore, activateLicense } from './license';
import { launchGameWithProtection, injectSubtitleFile } from './gameRunner';

let mainWindow: BrowserWindow | null = null;

function compareSemver(a: string, b: string): number {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

/**
 * To'liq (exe) yangilanishdan keyin userData/update ichida eski tez-yangilanish (UI patch) qolib ketsa,
 * launcher o'zini eski versiya deb ko'rsatadi va majburiy yangilanish cheksiz takrorlanadi.
 * Ilova versiyasidan eski bo'lgan UI patchni o'chirib tashlaymiz.
 */
function dropStaleUiPatch(): void {
  const updateDir = path.join(app.getPath('userData'), 'update');
  const verFile = path.join(updateDir, 'dist', 'version.json');
  try {
    if (!fs.existsSync(verFile)) return;
    const v = JSON.parse(fs.readFileSync(verFile, 'utf8'))?.version;
    if (!v || compareSemver(v, app.getVersion()) < 0) {
      fs.rmSync(updateDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('Stale UI patch cleanup warning:', err);
  }
}

/** Portable launcher bo'lsa, foydalanuvchi ishga tushirgan asl .exe fayl yo'li */
function launcherExePath(): string {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

/**
 * 1.3.0 va undan eski launcherlar to'liq yangilanishni portable faylning o'rniga emas, %TEMP% dagi
 * vaqtinchalik nusxaga yozardi. Shunday ishga tushgan bo'lsak, o'zimizni ish stoliga saqlaymiz va
 * foydalanuvchiga bundan keyin shu fayldan ochishni aytamiz (aks holda eski fayl har safar yangilanish so'raydi).
 */
async function rescueFromTempLaunch(): Promise<void> {
  try {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE;
    if (!exe || !app.isPackaged) return;
    const tmp = path.resolve(app.getPath('temp')).toLowerCase();
    if (!path.resolve(exe).toLowerCase().startsWith(tmp)) return;

    const desktopExe = path.join(app.getPath('desktop'), 'SubGame Launcher.exe');
    if (path.resolve(desktopExe).toLowerCase() === path.resolve(exe).toLowerCase()) return;
    fs.copyFileSync(exe, desktopExe);
    await dialog.showMessageBox({
      type: 'info',
      title: 'SubGame Launcher yangilandi',
      message: `SubGame Launcher ${app.getVersion()} ga yangilandi.`,
      detail:
        "Yangi launcher ish stolingizga \"SubGame Launcher.exe\" nomi bilan saqlandi. Bundan keyin launcherni shu fayldan oching. Eski launcher faylini o'chirib tashlashingiz mumkin.",
      buttons: ['Tushunarli'],
    });
  } catch (err) {
    console.warn('Temp launch rescue warning:', err);
  }
}

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
    if (url.includes('accounts.google.com') || url.includes('oauth')) {
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
    // In production packaged app, check if a lightweight delta patch update exists in userData
    const userUpdateIndex = path.join(app.getPath('userData'), 'update', 'dist', 'index.html');
    if (app.isPackaged && fs.existsSync(userUpdateIndex)) {
      mainWindow.loadFile(userUpdateIndex).catch((err) => {
        console.warn('Failed to load user update index, falling back to bundled:', err);
        const indexPath = path.join(__dirname, '../../dist/index.html');
        mainWindow?.loadFile(indexPath);
      });
    } else {
      const indexPath = path.join(__dirname, '../../dist/index.html');
      mainWindow.loadFile(indexPath).catch(() => {
        // If built differently
        mainWindow?.loadURL(`file://${path.resolve(__dirname, '../dist/index.html')}`);
      });
    }
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

  dropStaleUiPatch();
  createWindow();
  void rescueFromTempLaunch();

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

// IPC: Get Installed Subtitle Version for a Game
ipcMain.handle('get-subtitle-version', (_, gameId: string) => {
  try {
    if (!gameId) return null;
    const versionFile = path.join(app.getPath('userData'), 'subtitles', gameId, 'version.txt');
    if (fs.existsSync(versionFile)) {
      return fs.readFileSync(versionFile, 'utf8').trim();
    }
  } catch {}
  return null;
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

// IPC: Get Current App Version (checks for user patch version first)
ipcMain.handle('get-app-version', () => {
  try {
    const userVersionFile = path.join(app.getPath('userData'), 'update', 'dist', 'version.json');
    if (fs.existsSync(userVersionFile)) {
      const data = JSON.parse(fs.readFileSync(userVersionFile, 'utf8'));
      if (data && data.version) {
        return data.version;
      }
    }
  } catch (err) {
    console.warn('Could not read user update version:', err);
  }
  return app.getVersion();
});

// IPC: Download Launcher Update with progress (Supports both .zip patch and .exe full update)
ipcMain.handle('download-update', async (_, downloadUrl: string) => {
  try {
    const isZip = downloadUrl.toLowerCase().includes('.zip');
    const tempDir = app.getPath('temp');
    const destPath = isZip
      ? path.join(tempDir, 'SubGame-Launcher-Patch.zip')
      : path.join(tempDir, 'SubGame-Launcher-Update.exe');

    return await new Promise<{ success: boolean; tempPath?: string; error?: string }>((resolve) => {
      function doDownload(targetUrl: string) {
        const client = targetUrl.startsWith('https') ? https : http;
        const req = client.get(targetUrl, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return doDownload(res.headers.location);
          }
          if (res.statusCode !== 200) {
            return resolve({ success: false, error: `Server xatosi: HTTP ${res.statusCode}` });
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let transferred = 0;

          const fileStream = fs.createWriteStream(destPath);
          res.on('data', (chunk) => {
            transferred += chunk.length;
            const percent = total > 0 ? Math.round((transferred / total) * 100) : 0;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('update-progress', { percent, transferred, total });
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            resolve({ success: true, tempPath: destPath });
          });

          fileStream.on('error', (err) => {
            try { fs.unlinkSync(destPath); } catch {}
            resolve({ success: false, error: err.message });
          });
        });

        req.on('error', (err) => {
          try { fs.unlinkSync(destPath); } catch {}
          resolve({ success: false, error: err.message });
        });
      }

      doDownload(downloadUrl);
    });
  } catch (err: any) {
    return { success: false, error: err?.message || 'Yuklab olishda xatolik yuz berdi' };
  }
});

// IPC: Apply Update & Restart (Instant .zip extraction or PowerShell .exe swap)
ipcMain.handle('apply-update', async (_, tempPath: string) => {
  try {
    if (!fs.existsSync(tempPath)) {
      return { success: false, error: 'Yangilanish fayli topilmadi.' };
    }

    // 1. Fast Delta Patch Update (.zip)
    if (tempPath.toLowerCase().endsWith('.zip')) {
      const updateDistDir = path.join(app.getPath('userData'), 'update', 'dist');
      if (!fs.existsSync(updateDistDir)) {
        fs.mkdirSync(updateDistDir, { recursive: true });
      }

      const { execSync } = require('child_process');
      let extracted = false;

      // Try tar.exe (native on modern Windows)
      try {
        execSync(`tar -xf "${tempPath}" -C "${updateDistDir}"`, { stdio: 'ignore' });
        extracted = true;
      } catch {
        // Fallback to powershell Expand-Archive
      }

      if (!extracted) {
        const escapedZip = tempPath.replace(/'/g, "''");
        const escapedDest = updateDistDir.replace(/'/g, "''");
        const psCmd = `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDest}' -Force`;
        execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: 'ignore' });
      }

      try { fs.unlinkSync(tempPath); } catch {}

      // Fast relaunch directly into the updated UI
      app.relaunch();
      setTimeout(() => {
        app.quit();
      }, 300);

      return { success: true };
    }

    // 2. Full .exe update (fallback)
    const currentExe = launcherExePath();
    const oldPid = process.pid;

    const escapedTemp = tempPath.replace(/'/g, "''");
    const escapedDest = currentExe.replace(/'/g, "''");

    const psCommand = `
      $oldPid = ${oldPid};
      $temp = '${escapedTemp}';
      $dest = '${escapedDest}';
      Wait-Process -Id $oldPid -Timeout 15 -ErrorAction SilentlyContinue;
      Start-Sleep -Milliseconds 800;
      for ($i = 0; $i -lt 15; $i++) {
        try {
          Copy-Item -LiteralPath $temp -Destination $dest -Force;
          Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue;
          break;
        } catch {
          Start-Sleep -Seconds 1;
        }
      }
      Start-Process -FilePath $dest;
    `.replace(/\\s+/g, ' ').trim();

    const child = spawn('powershell', ['-WindowStyle', 'Hidden', '-NoProfile', '-Command', psCommand], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    setTimeout(() => {
      app.quit();
    }, 200);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Yangilanishni qo‘llashda xatolik' };
  }
});
