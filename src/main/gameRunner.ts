import { spawn, ChildProcess, execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { app } from 'electron';
import { isGameActivated } from './license';
import { decryptData } from './crypto';

export interface GameLaunchConfig {
  gameId: string;
  gameExePath: string;
  encryptedSubtitlePath?: string;
  targetSubtitleFileName?: string; // e.g. tt01.pc
  targetRelativeDir?: string; // e.g. TRTEXT
  subtitleDownloadUrl?: string; // Real-time server URL for dynamically added games
  isAuthorized?: boolean;
  skipSubtitleInjection?: boolean; // For standalone games or games that don't need external subtitle injection
  subtitleVersion?: string; // Real-time subtitle version from Firestore (e.g. "v1.1.0")
}

interface RunningGameSession {
  process: ChildProcess;
  gameId: string;
}

const activeSessions = new Map<string, RunningGameSession>();

/**
 * Windows jarayonini tekshirish (tasklist orqali)
 */
export function isProcessRunning(pattern: string): boolean {
  if (!pattern) return false;
  try {
    const output = execFileSync('tasklist', ['/nh', '/fi', `imagename eq ${pattern}*`], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.toLowerCase().includes(pattern.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Mustaqil fon jarayoni (Detached Watcher)
 * Launcher yopilsa ham, o'yin jarayoni tugashi bilan subtitr faylini xavfsiz o'chiradi
 */
export function spawnDetachedCleanupWatcher(
  pattern: string,
  destFilePath: string,
  backupFilePath?: string
): void {
  try {
    const escapedDest = destFilePath.replace(/'/g, "''");
    const escapedBak = (backupFilePath || '').replace(/'/g, "''");
    const escapedPattern = pattern.replace(/'/g, "''");

    const psCommand = `
      $pattern = '${escapedPattern}';
      $dest = '${escapedDest}';
      $bak = '${escapedBak}';
      $t = 0;
      while (!(Get-Process -Name $pattern* -ErrorAction SilentlyContinue) -and $t -lt 30) {
        Start-Sleep -Seconds 1;
        $t++;
      };
      while (Get-Process -Name $pattern* -ErrorAction SilentlyContinue) {
        Start-Sleep -Seconds 2;
      };
      Start-Sleep -Seconds 1;
      for ($i = 0; $i -lt 15; $i++) {
        try {
          if ($bak -and (Test-Path -LiteralPath $bak)) {
            Copy-Item -LiteralPath $bak -Destination $dest -Force;
            Remove-Item -LiteralPath $bak -Force;
          } elseif (Test-Path -LiteralPath $dest) {
            Remove-Item -LiteralPath $dest -Force;
          }
          break;
        } catch {
          Start-Sleep -Seconds 1;
        }
      }
    `.replace(/\\s+/g, ' ').trim();

    const watcher = spawn('powershell', ['-WindowStyle', 'Hidden', '-NoProfile', '-Command', psCommand], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    watcher.unref();
  } catch (err) {
    console.warn('Detached watcher start warning:', err);
  }
}

/**
 * Xavfsiz nusxalash (Program Files papkasida EPERM xatosi bo'lsa, UAC orqali ruxsat oladi)
 */
export function safeCopyFileSync(source: string, destination: string): void {
  try {
    if (fs.existsSync(destination)) {
      try {
        fs.chmodSync(destination, 0o666);
      } catch {
        // ignore
      }
    }
    fs.copyFileSync(source, destination);
  } catch (err: any) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      try {
        const psCommand = `powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -Command Copy-Item -LiteralPath \\'${source}\\' -Destination \\'${destination}\\' -Force'"`;
        execSync(psCommand, { stdio: 'ignore' });
        if (fs.existsSync(destination)) {
          return;
        }
      } catch (elevateErr) {
        console.error('PowerShell elevate error:', elevateErr);
      }
      throw new Error(
        `Faylni yozishga ruxsat berilmadi (EPERM). O'yin "Program Files" papkasida joylashganligi sababli, iltimos SubGame Launcherni "Administrator sifatida ishga tushirish" (Run as administrator) orqali oching.`
      );
    }
    throw err;
  }
}

/**
 * Xavfsiz fayl yozish (Buffer dan to'g'ridan-to'g'ri yozish)
 */
export function safeWriteFileSync(destination: string, data: Buffer): void {
  try {
    if (fs.existsSync(destination)) {
      try {
        fs.chmodSync(destination, 0o666);
      } catch {
        // ignore
      }
    }
    fs.writeFileSync(destination, data);
  } catch (err: any) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      const tempPath = path.join(app.getPath('temp'), `subgame_${Date.now()}_${path.basename(destination)}`);
      fs.writeFileSync(tempPath, data);
      safeCopyFileSync(tempPath, destination);
      try {
        fs.unlinkSync(tempPath);
      } catch {}
      return;
    }
    throw err;
  }
}

/**
 * Subtitr manba faylini qidirish (shifrlangan .enc yoki asl fayl)
 */
export function findSubtitleSource(
  gameId: string,
  fileName: string
): { path: string; isEncrypted: boolean } | null {
  const encName = `${fileName}.enc`;

  // Avval shifrlangan .enc faylni qidiramiz, keyin asl faylni
  for (const f of [encName, fileName]) {
    const candidatePaths = [
      path.join(app.getPath('userData'), 'subtitles', gameId, f),
      path.join(process.resourcesPath, 'subtitles', gameId, f),
      path.join(process.resourcesPath, 'public', 'subtitles', gameId, f),
      path.join(app.getAppPath(), 'dist', 'subtitles', gameId, f),
      path.join(app.getAppPath(), 'public', 'subtitles', gameId, f),
      path.join(__dirname, '../../dist/subtitles', gameId, f),
      path.join(__dirname, '../../public/subtitles', gameId, f),
      path.join(__dirname, '../subtitles', gameId, f),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'subtitles', gameId, f),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'public', 'subtitles', gameId, f),
    ];

    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) {
          return { path: p, isEncrypted: f.endsWith('.enc') };
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

/**
 * O'yin papkasi ichidagi subtitr joylashadigan maqsad papkani aniqlash (TRTEXT yoki boshqa)
 */
export function resolveTargetDir(gameDir: string, targetRelativeDir?: string): string {
  if (targetRelativeDir) {
    const candidates = [
      path.join(gameDir, targetRelativeDir),
      path.resolve(gameDir, '../../..', targetRelativeDir),
      path.resolve(gameDir, '../..', targetRelativeDir),
      path.resolve(gameDir, '..', targetRelativeDir),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
  }

  // A Plague Tale seriyasida matnlar TRTEXT papkasida joylashgan
  if (fs.existsSync(path.join(gameDir, 'TRTEXT'))) {
    return path.join(gameDir, 'TRTEXT');
  }
  if (targetRelativeDir) {
    const customDir = path.join(gameDir, targetRelativeDir);
    if (!fs.existsSync(customDir)) {
      try {
        fs.mkdirSync(customDir, { recursive: true });
      } catch {}
    }
    return customDir;
  }
  return gameDir;
}

/**
 * Google Drive yoki boshqa havolalarni to'g'ridan-to'g'ri yuklab olish formatiga keltirish
 */
export function formatDownloadUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  const gDriveMatch = rawUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (gDriveMatch && gDriveMatch[1]) {
    return `https://drive.usercontent.google.com/download?id=${gDriveMatch[1]}&export=download&confirm=t`;
  }
  const gDriveIdMatch = rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (gDriveIdMatch && gDriveIdMatch[1] && rawUrl.includes('drive.google.com')) {
    return `https://drive.usercontent.google.com/download?id=${gDriveIdMatch[1]}&export=download&confirm=t`;
  }
  return rawUrl;
}

/**
 * Subtitr faylini serverdan 0-100% progress bilan yuklab olish
 */
export async function downloadSubtitleFile(
  rawUrl: string,
  destPath: string,
  onStatusUpdate?: (status: any) => void
): Promise<void> {
  const url = formatDownloadUrl(rawUrl);
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  onStatusUpdate?.({
    type: 'download-progress',
    percent: 0,
    transferredMb: '0.0',
    totalMb: '...',
    message: 'Serverga ulanmoqda...'
  });

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      // 301, 302, 303, 307 redirectlarni xavfsiz boshqarish
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const parsedOrigin = new URL(url).origin;
          redirectUrl = new URL(redirectUrl, parsedOrigin).href;
        }
        return downloadSubtitleFile(redirectUrl, destPath, onStatusUpdate).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`Server javobi: HTTP ${res.statusCode}`));
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastReportTime = 0;
      const fileStream = fs.createWriteStream(destPath);

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const now = Date.now();
        // UI silliq ishlashi uchun xabarlarni ~80ms oraliqda jo'natamiz
        if (now - lastReportTime > 80 || (totalBytes > 0 && downloadedBytes >= totalBytes)) {
          lastReportTime = now;
          if (totalBytes > 0) {
            const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            const dlMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
            const totMB = (totalBytes / (1024 * 1024)).toFixed(1);
            onStatusUpdate?.({
              type: 'download-progress',
              percent,
              transferredMb: dlMB,
              totalMb: totMB,
              message: `Subtitr yuklanmoqda: ${percent}% (${dlMB} MB / ${totMB} MB)`
            });
          } else {
            const dlMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
            onStatusUpdate?.({
              type: 'download-progress',
              percent: -1,
              transferredMb: dlMB,
              totalMb: '?',
              message: `Subtitr yuklanmoqda: ${dlMB} MB`
            });
          }
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        const dlMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
        onStatusUpdate?.({
          type: 'download-progress',
          percent: 100,
          transferredMb: dlMB,
          totalMb: dlMB,
          message: 'Subtitr to‘liq yuklab olindi (100%)'
        });
        resolve();
      });

      fileStream.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    });

    req.on('error', (err) => {
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    });
  });
}

/**
 * Subtitr faylini o'yin papkasiga xavfsiz dekodlab joylash
 */
export async function injectSubtitleFile(
  config: GameLaunchConfig,
  onStatusUpdate?: (status: any) => void
): Promise<{ success: boolean; message: string; targetPath?: string }> {
  try {
    if (config.skipSubtitleInjection || !config.targetSubtitleFileName || config.targetSubtitleFileName === 'none') {
      return {
        success: true,
        message: "O‘yin lokalizatsiyasi tayyor.",
      };
    }

    if (!fs.existsSync(config.gameExePath)) {
      return {
        success: false,
        message: `O'yin ijro fayli (.exe) topilmadi: ${config.gameExePath}`,
      };
    }

    const gameDir = path.dirname(config.gameExePath);
    const targetFileName = config.targetSubtitleFileName;
    const destDir = resolveTargetDir(gameDir, config.targetRelativeDir);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const destFilePath = path.join(destDir, targetFileName);
    const backupFilePath = path.join(destDir, `${targetFileName}.subgame_bak`);

    const userSubDir = path.join(app.getPath('userData'), 'subtitles', config.gameId);
    const versionFilePath = path.join(userSubDir, 'version.txt');

    // Subtitr versiyasini tekshirish (Subtitle Version Auto-Updater)
    let needsVersionUpdate = false;
    if (config.subtitleVersion && config.subtitleDownloadUrl && config.subtitleDownloadUrl.startsWith('http')) {
      if (fs.existsSync(versionFilePath)) {
        try {
          const installedVer = fs.readFileSync(versionFilePath, 'utf8').trim();
          if (installedVer && installedVer !== config.subtitleVersion.trim()) {
            console.info(`[Subtitle Updater] New version available for ${config.gameId}: ${config.subtitleVersion} (current: ${installedVer}). Triggering re-download.`);
            needsVersionUpdate = true;
          }
        } catch {}
      } else {
        // Agar versiya fayli bo'lmasa lekin oldin yuklab olingan fayl bo'lsa
        const testFile = path.join(userSubDir, targetFileName);
        const testEnc = path.join(userSubDir, `${targetFileName}.enc`);
        if (fs.existsSync(testFile) || fs.existsSync(testEnc)) {
          // Versiya belgilanmagan eski kesh, yangi versiya kelgan bo'lsa yangilaymiz
          needsVersionUpdate = true;
        }
      }

      if (needsVersionUpdate) {
        try {
          const oldFile = path.join(userSubDir, targetFileName);
          const oldEnc = path.join(userSubDir, `${targetFileName}.enc`);
          if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
          if (fs.existsSync(oldEnc)) fs.unlinkSync(oldEnc);
        } catch {}
      }
    }

    let source = needsVersionUpdate ? null : findSubtitleSource(config.gameId, targetFileName);

    // Agar lokal papkalarda topilmasa yoki yangi versiya mavjud bo'lsa, serverdan yuklab olamiz
    if (!source && config.subtitleDownloadUrl && config.subtitleDownloadUrl.startsWith('http')) {
      try {
        if (!fs.existsSync(userSubDir)) {
          fs.mkdirSync(userSubDir, { recursive: true });
        }
        const downloadedFilePath = path.join(userSubDir, targetFileName);
        await downloadSubtitleFile(config.subtitleDownloadUrl, downloadedFilePath, onStatusUpdate);
        if (fs.existsSync(downloadedFilePath)) {
          // Yangilangan versiyani saqlaymiz
          if (config.subtitleVersion) {
            try {
              fs.writeFileSync(versionFilePath, config.subtitleVersion.trim(), 'utf8');
            } catch {}
          }
          // Fayl SubGame AES-256 bilan shifrlanganligini tekshiramiz
          let isEncrypted = false;
          try {
            const testBuf = fs.readFileSync(downloadedFilePath);
            decryptData(testBuf);
            isEncrypted = true;
          } catch {
            isEncrypted = false;
          }
          source = { path: downloadedFilePath, isEncrypted };
        }
      } catch (dlErr: any) {
        console.warn('Subtitrni yuklab olishda ogohlantirish:', dlErr);
      }
    }

    if (!source) {
      return {
        success: false,
        message: `Subtitr manba fayli topilmadi. O'yin identifikatori: ${config.gameId}`,
      };
    }

    onStatusUpdate?.("Subtitr fayli o'yin papkasiga xavfsiz ulanmoqda...");

    // Agar o'yin papkasida asl fayl mavjud bo'lsa va hali zaxiralanmagan bo'lsa, zaxiraga olamiz
    if (fs.existsSync(destFilePath) && !fs.existsSync(backupFilePath)) {
      try {
        safeCopyFileSync(destFilePath, backupFilePath);
      } catch (err) {
        console.warn('Original faylni zaxiralashda ogohlantirish:', err);
      }
    }

    // AES-256 bilan shifrlangan bo'lsa dekodlaymiz
    if (source.isEncrypted) {
      try {
        const encryptedBuffer = fs.readFileSync(source.path);
        const decryptedBuffer = decryptData(encryptedBuffer);
        safeWriteFileSync(destFilePath, decryptedBuffer);
      } catch (decryptErr) {
        console.warn('Dekodlashda ogohlantirish, asl fayl nusxalanmoqda:', decryptErr);
        // Agar fayl aslida shifrlanmagan bo'lsa (masalan oddiy .pak yoki .pc), to'g'ridan-to'g'ri nusxalaymiz
        safeCopyFileSync(source.path, destFilePath);
      }
    } else {
      safeCopyFileSync(source.path, destFilePath);
    }

    return {
      success: true,
      message: `O‘zbekcha subtitr paketi o‘yinga muvaffaqiyatli ulandi!`,
      targetPath: destFilePath,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Subtitrni joylashda xatolik: ${error?.message || error}`,
    };
  }
}

/**
 * O'yinni o'zbekcha subtitrlar bilan ishga tushirish (A-Variant DRM)
 */
export async function launchGameWithProtection(
  config: GameLaunchConfig,
  onStatusUpdate: (status: any) => void
): Promise<{ success: boolean; message: string }> {
  try {
    onStatusUpdate('Litsenziya tekshirilmoqda...');

    // 1. Check license
    const hasLocalLicense = isGameActivated(config.gameId);
    if (!config.isAuthorized && !hasLocalLicense) {
      return {
        success: false,
        message: "Ushbu o'yin uchun litsenziya faollashtirilmagan! Iltimos, hisobingizga kiring yoki litsenziya kalitini kiriting.",
      };
    }

    // 2. Validate Game Executable exists
    if (!fs.existsSync(config.gameExePath)) {
      return {
        success: false,
        message: `O'yin ijro fayli (.exe) topilmadi: ${config.gameExePath}`,
      };
    }

    const shouldInject = !config.skipSubtitleInjection && !!config.targetSubtitleFileName && config.targetSubtitleFileName !== 'none';
    const gameDir = path.dirname(config.gameExePath);
    let destFilePath: string | undefined;
    let backupFilePath: string | undefined;

    // 3. Inject subtitle into target directory if needed (e.g. TRTEXT/tt01.pc)
    if (shouldInject) {
      const injectRes = await injectSubtitleFile(config, onStatusUpdate);
      if (!injectRes.success) {
        return injectRes;
      }
      const targetFileName = config.targetSubtitleFileName!;
      const destDir = resolveTargetDir(gameDir, config.targetRelativeDir);
      destFilePath = path.join(destDir, targetFileName);
      backupFilePath = path.join(destDir, `${targetFileName}.subgame_bak`);
    } else {
      onStatusUpdate("O'yin ishga tushirishga tayyorlanmoqda...");
    }

    onStatusUpdate("O'yin ishga tushirilmoqda...");

    // Extract process pattern (e.g. Stray from Stray.exe or Stray-Win64-Shipping.exe)
    const rawExeName = path.basename(config.gameExePath, path.extname(config.gameExePath));
    let processPattern = rawExeName.replace(/[-_](Win64|Win32|Shipping|x64|x86)+.*$/i, '');
    if (processPattern.length < 3) {
      processPattern = rawExeName;
    }

    // 4. Launch Game process
    const gameProcess = spawn(config.gameExePath, [], {
      cwd: gameDir,
      detached: true,
      stdio: 'ignore',
    });

    gameProcess.unref();

    activeSessions.set(config.gameId, {
      process: gameProcess,
      gameId: config.gameId,
    });

    // Windows mustaqil tozalovchi jarayonini ishga tushiramiz (Launcher yopilsa ham fonda ishlaydi)
    if (shouldInject && destFilePath && destFilePath !== config.gameExePath) {
      spawnDetachedCleanupWatcher(processPattern, destFilePath, backupFilePath);
    }

    onStatusUpdate("O'yin faol va o'zbekcha subtitrlar ulandi. Maroqli hordiq!");

    // 5. A-Variant DRM: O'yin ichki monitori (Launcher ochiq turganda real vaqtda kuzatadi va tozalaydi)
    let checkCount = 0;
    let gameHasStarted = false;

    const monitorInterval = setInterval(async () => {
      checkCount++;
      const isRunning = isProcessRunning(processPattern);

      if (isRunning) {
        gameHasStarted = true;
      }

      // O'yin ishga tushib keyin yopilsa, yoki 30 soniya ichida umuman boshlanmasa
      if ((gameHasStarted && !isRunning) || (!gameHasStarted && checkCount > 15)) {
        clearInterval(monitorInterval);
        activeSessions.delete(config.gameId);
        onStatusUpdate("O'yin yakunlandi. Subtitrlar himoyalanmoqda...");

        if (shouldInject && destFilePath && destFilePath !== config.gameExePath) {
          for (let attempt = 0; attempt < 10; attempt++) {
            try {
              if (backupFilePath && fs.existsSync(backupFilePath)) {
                safeCopyFileSync(backupFilePath, destFilePath);
                try { fs.unlinkSync(backupFilePath); } catch {}
                break;
              } else if (fs.existsSync(destFilePath)) {
                fs.unlinkSync(destFilePath);
                break;
              }
            } catch {
              await new Promise((r) => setTimeout(r, 1000));
            }
          }
        }

        onStatusUpdate('Tayyor');
      }
    }, 2000);

    return {
      success: true,
      message: "O'yin va o'zbekcha subtitrlar muvaffaqiyatli ishga tushirildi!",
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Ishga tushirishda xatolik: ${error?.message || error}`,
    };
  }
}
