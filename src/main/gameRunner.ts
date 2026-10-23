import { spawn, ChildProcess, execSync } from 'child_process';
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
}

interface RunningGameSession {
  process: ChildProcess;
  gameId: string;
}

const activeSessions = new Map<string, RunningGameSession>();

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
    return `https://drive.google.com/uc?export=download&id=${gDriveMatch[1]}`;
  }
  const gDriveIdMatch = rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (gDriveIdMatch && gDriveIdMatch[1] && rawUrl.includes('drive.google.com')) {
    return `https://drive.google.com/uc?export=download&id=${gDriveIdMatch[1]}`;
  }
  return rawUrl;
}

/**
 * Subtitr faylini serverdan yuklab olish
 */
export async function downloadSubtitleFile(
  rawUrl: string,
  destPath: string,
  onStatusUpdate?: (status: string) => void
): Promise<void> {
  const url = formatDownloadUrl(rawUrl);
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  onStatusUpdate?.("Subtitr serverdan yuklab olinmoqda...");

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadSubtitleFile(res.headers.location, destPath, onStatusUpdate).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Server javobi: HTTP ${res.statusCode}`));
      }

      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    }).on('error', (err) => {
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
  onStatusUpdate?: (status: string) => void
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

    let source = findSubtitleSource(config.gameId, targetFileName);

    // Agar lokal papkalarda topilmasa va server URL berilgan bo'lsa, yuklab olamiz
    if (!source && config.subtitleDownloadUrl && config.subtitleDownloadUrl.startsWith('http')) {
      try {
        const userSubDir = path.join(app.getPath('userData'), 'subtitles', config.gameId);
        const downloadedFilePath = path.join(userSubDir, targetFileName);
        await downloadSubtitleFile(config.subtitleDownloadUrl, downloadedFilePath, onStatusUpdate);
        if (fs.existsSync(downloadedFilePath)) {
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
  onStatusUpdate: (status: string) => void
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

    onStatusUpdate("O'yin faol va o'zbekcha subtitrlar ulandi. Maroqli hordiq!");

    // 5. A-Variant DRM: O'yin yopilganda faylni asl holatiga qaytarish (himoyalash)
    gameProcess.on('exit', () => {
      onStatusUpdate("O'yin yakunlandi.");

      if (shouldInject && destFilePath && backupFilePath && destFilePath !== config.gameExePath) {
        try {
          if (fs.existsSync(backupFilePath)) {
            // Asl original faylni tiklaymiz
            safeCopyFileSync(backupFilePath, destFilePath);
            fs.unlinkSync(backupFilePath);
          } else {
            // Zaxira bo'lmagan bo'lsa, o'zbekcha faylni xavfsiz o'chiramiz
            if (fs.existsSync(destFilePath)) {
              safeWriteFileSync(destFilePath, Buffer.alloc(1024));
              fs.unlinkSync(destFilePath);
            }
          }
        } catch (cleanErr) {
          console.error('Tozalashda xatolik:', cleanErr);
        }
      }

      activeSessions.delete(config.gameId);
      onStatusUpdate('Tayyor');
    });

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
