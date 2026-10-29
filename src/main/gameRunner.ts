import { spawn, ChildProcess, execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { app } from 'electron';
import { isGameActivated } from './license';
import { decryptData } from './crypto';

export interface InjectedFileInfo {
  destFilePath: string;
  backupFilePath?: string;
}

export interface GameLaunchConfig {
  gameId: string;
  gameExePath: string;
  encryptedSubtitlePath?: string;
  targetSubtitleFileName?: string; // e.g. tt01.pc or "stringtable_en.sds,stringtable_ru.sds"
  targetRelativeDir?: string; // e.g. TRTEXT or sds_retail/string_tables
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
 * Launcher yopilsa ham, o'yin jarayoni tugashi bilan subtitr faylini xavfsiz o'chiradi yoki zaxiradan tiklaydi
 */
export function spawnDetachedCleanupWatcher(
  pattern: string,
  filesOrDest: string | InjectedFileInfo[],
  legacyBackupPath?: string
): void {
  try {
    const fileEntries: Array<{ dest: string; bak: string }> = Array.isArray(filesOrDest)
      ? filesOrDest.map((f) => ({ dest: f.destFilePath, bak: f.backupFilePath || '' }))
      : [{ dest: filesOrDest, bak: legacyBackupPath || '' }];

    if (fileEntries.length === 0) return;

    const escapedPattern = pattern.replace(/'/g, "''");
    const fileArrayScript = fileEntries
      .map((f) => `@{ dest = '${f.dest.replace(/'/g, "''")}'; bak = '${f.bak.replace(/'/g, "''")}' }`)
      .join(', ');

    const psCommand = `
      $pattern = '${escapedPattern}';
      $files = @(${fileArrayScript});
      $t = 0;
      while (!(Get-Process -Name $pattern* -ErrorAction SilentlyContinue) -and $t -lt 30) {
        Start-Sleep -Seconds 1;
        $t++;
      };
      while (Get-Process -Name $pattern* -ErrorAction SilentlyContinue) {
        Start-Sleep -Seconds 2;
      };
      Start-Sleep -Seconds 1;
      foreach ($f in $files) {
        for ($i = 0; $i -lt 15; $i++) {
          try {
            if ($f.bak -and (Test-Path -LiteralPath $f.bak)) {
              Copy-Item -LiteralPath $f.bak -Destination $f.dest -Force;
              Remove-Item -LiteralPath $f.bak -Force;
            } elseif (Test-Path -LiteralPath $f.dest) {
              Remove-Item -LiteralPath $f.dest -Force;
            }
            break;
          } catch {
            Start-Sleep -Seconds 1;
          }
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

  const resPath = process.resourcesPath;
  // Avval shifrlangan .enc faylni qidiramiz, keyin asl faylni
  for (const f of [encName, fileName]) {
    const candidatePaths = [
      path.join(app.getPath('userData'), 'subtitles', gameId, f),
      ...(resPath ? [
        path.join(resPath, 'subtitles', gameId, f),
        path.join(resPath, 'public', 'subtitles', gameId, f),
        path.join(resPath, 'app.asar.unpacked', 'dist', 'subtitles', gameId, f),
        path.join(resPath, 'app.asar.unpacked', 'public', 'subtitles', gameId, f),
      ] : []),
      path.join(app.getAppPath(), 'dist', 'subtitles', gameId, f),
      path.join(app.getAppPath(), 'public', 'subtitles', gameId, f),
      path.join(__dirname, '../../dist/subtitles', gameId, f),
      path.join(__dirname, '../../public/subtitles', gameId, f),
      path.join(__dirname, '../subtitles', gameId, f),
    ];

    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) {
          let isEncrypted = f.endsWith('.enc');
          if (!isEncrypted) {
            try {
              const testBuf = fs.readFileSync(p);
              decryptData(testBuf);
              isEncrypted = true;
            } catch {
              isEncrypted = false;
            }
          }
          return { path: p, isEncrypted };
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
 * Bir yoki bir nechta subtitr fayllarini qo'llab-quvvatlaydi (masalan, stringtable_en.sds,stringtable_ru.sds)
 */
export async function injectSubtitleFile(
  config: GameLaunchConfig,
  onStatusUpdate?: (status: any) => void
): Promise<{
  success: boolean;
  message: string;
  targetPath?: string;
  injectedFiles?: InjectedFileInfo[];
}> {
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
    const destDir = resolveTargetDir(gameDir, config.targetRelativeDir);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Avvalgi xatolikdan qolgan noto'g'ri nomli faylni tozalash
    try {
      const junkCorrupted = path.join(destDir, 'stringtable_en.sds,stringtable_ru.sds');
      if (fs.existsSync(junkCorrupted)) {
        fs.unlinkSync(junkCorrupted);
      }
    } catch {}

    const fileNames = config.targetSubtitleFileName
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean);

    // Mafia: Definitive Edition uchun agar faqat stringtable_en.sds ko'rsatilgan bo'lsa ham,
    // o'yin papkasida stringtable_ru.sds bo'lsa, ikkala til foydalanuvchilariga ham ishlashi uchun uni ham qo'shamiz
    if (
      config.gameId === 'mafia-definitive-edition' ||
      config.gameExePath.toLowerCase().includes('mafiadefinitiveedition')
    ) {
      if (!fileNames.includes('stringtable_ru.sds') && fs.existsSync(path.join(destDir, 'stringtable_ru.sds'))) {
        fileNames.push('stringtable_ru.sds');
      }
    }

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
        for (const f of fileNames) {
          const testFile = path.join(userSubDir, f);
          const testEnc = path.join(userSubDir, `${f}.enc`);
          if (fs.existsSync(testFile) || fs.existsSync(testEnc)) {
            needsVersionUpdate = true;
            break;
          }
        }
      }

      if (needsVersionUpdate) {
        for (const f of fileNames) {
          try {
            const oldFile = path.join(userSubDir, f);
            const oldEnc = path.join(userSubDir, `${f}.enc`);
            if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
            if (fs.existsSync(oldEnc)) fs.unlinkSync(oldEnc);
          } catch {}
        }
      }
    }

    // Agar lokal papkalarda barcha fayllar topilmasa va server URL berilgan bo'lsa, yuklab olamiz
    let allFound = !needsVersionUpdate && fileNames.every((f) => findSubtitleSource(config.gameId, f) !== null);

    if (!allFound && config.subtitleDownloadUrl && config.subtitleDownloadUrl.startsWith('http')) {
      try {
        if (!fs.existsSync(userSubDir)) {
          fs.mkdirSync(userSubDir, { recursive: true });
        }

        const tempDownloadPath = path.join(userSubDir, `temp_download_${Date.now()}`);
        onStatusUpdate?.("Subtitr serverdan yuklanmoqda...");
        await downloadSubtitleFile(config.subtitleDownloadUrl, tempDownloadPath, onStatusUpdate);

        if (fs.existsSync(tempDownloadPath)) {
          // Fayl turini tekshirish: Zip arxivmi yoki to'g'ridan-to'g'ri faylmi?
          let isZipFile = false;
          try {
            const fd = fs.openSync(tempDownloadPath, 'r');
            const magicBuf = Buffer.alloc(4);
            fs.readSync(fd, magicBuf, 0, 4, 0);
            fs.closeSync(fd);
            // PK\x03\x04 (ZIP signature)
            if (magicBuf[0] === 0x50 && magicBuf[1] === 0x4b && magicBuf[2] === 0x03 && magicBuf[3] === 0x04) {
              isZipFile = true;
            }
          } catch {}

          if (isZipFile) {
            try {
              execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${tempDownloadPath.replace(/'/g, "''")}' -DestinationPath '${userSubDir.replace(/'/g, "''")}' -Force"`, { windowsHide: true });
            } catch (unzipErr) {
              console.warn('Zip faylni ochishda xatolik:', unzipErr);
            }
            try { fs.unlinkSync(tempDownloadPath); } catch {}
          } else {
            // To'g'ridan-to'g'ri (zipsiz) subtitr fayli (masalan, .sds)
            const primaryName = fileNames[0] || 'stringtable_en.sds';
            const primaryFile = path.join(userSubDir, primaryName);
            try { if (fs.existsSync(primaryFile)) fs.unlinkSync(primaryFile); } catch {}
            fs.renameSync(tempDownloadPath, primaryFile);

            // Agar o'yin uchun qo'shimcha nomlar kerak bo'lsa (masalan, stringtable_ru.sds)
            for (let i = 1; i < fileNames.length; i++) {
              const secondaryFile = path.join(userSubDir, fileNames[i]);
              try {
                safeCopyFileSync(primaryFile, secondaryFile);
              } catch {}
            }
          }

          if (config.subtitleVersion) {
            try {
              fs.writeFileSync(versionFilePath, config.subtitleVersion.trim(), 'utf8');
            } catch {}
          }
        }
      } catch (dlErr: any) {
        console.warn('Subtitrni yuklab olishda ogohlantirish:', dlErr);
      }
    }

    const injectedList: InjectedFileInfo[] = [];

    for (const targetFileName of fileNames) {
      const destFilePath = path.join(destDir, targetFileName);
      const backupFilePath = path.join(destDir, `${targetFileName}.subgame_bak`);

      let source = findSubtitleSource(config.gameId, targetFileName);

      // Agar aynan shu nomdagi manba topilmasa, lekin boshqa fayl yuklangan bo'lsa (masalan, EN -> RU nusxalash)
      if (!source) {
        for (const otherF of fileNames) {
          const altSource = findSubtitleSource(config.gameId, otherF);
          if (altSource) {
            source = altSource;
            break;
          }
        }
      }

      // Agar yuqoridagi umumiy yuklashdan keyin ham topilmagan bo'lsa va yakka fayl URL bo'lsa
      if (!source && config.subtitleDownloadUrl && config.subtitleDownloadUrl.startsWith('http') && fileNames.length === 1) {
        try {
          if (!fs.existsSync(userSubDir)) {
            fs.mkdirSync(userSubDir, { recursive: true });
          }
          const downloadedFilePath = path.join(userSubDir, targetFileName);
          await downloadSubtitleFile(config.subtitleDownloadUrl, downloadedFilePath, onStatusUpdate);
          if (fs.existsSync(downloadedFilePath)) {
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
          message: `Subtitr manba fayli topilmadi: ${targetFileName}. O'yin identifikatori: ${config.gameId}`,
        };
      }

      onStatusUpdate?.(`Subtitr fayli (${targetFileName}) o'yin papkasiga xavfsiz ulanmoqda...`);

      // Agar o'yin papkasida asl fayl mavjud bo'lsa va hali zaxiralanmagan bo'lsa, zaxiraga olamiz
      if (fs.existsSync(destFilePath) && !fs.existsSync(backupFilePath)) {
        try {
          safeCopyFileSync(destFilePath, backupFilePath);
        } catch (err) {
          console.warn(`Original faylni zaxiralashda ogohlantirish (${targetFileName}):`, err);
        }
      }

      // AES-256 bilan shifrlangan bo'lsa dekodlaymiz
      let decryptedBuffer: Buffer | null = null;
      if (source.isEncrypted) {
        try {
          const encryptedBuffer = fs.readFileSync(source.path);
          decryptedBuffer = decryptData(encryptedBuffer);
        } catch (decryptErr) {
          console.warn(`Dekodlashda ogohlantirish (${targetFileName}):`, decryptErr);
        }
      } else {
        try {
          const testBuffer = fs.readFileSync(source.path);
          decryptedBuffer = decryptData(testBuffer);
        } catch {
          decryptedBuffer = null;
        }
      }

      if (decryptedBuffer) {
        safeWriteFileSync(destFilePath, decryptedBuffer);
      } else {
        safeCopyFileSync(source.path, destFilePath);
      }

      injectedList.push({ destFilePath, backupFilePath });
    }

    return {
      success: true,
      message: `O‘zbekcha subtitr paketi o‘yinga muvaffaqiyatli ulandi!`,
      targetPath: injectedList[0]?.destFilePath,
      injectedFiles: injectedList,
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
    let injectedList: InjectedFileInfo[] = [];

    // 3. Inject subtitle into target directory if needed (e.g. TRTEXT/tt01.pc)
    if (shouldInject) {
      const injectRes = await injectSubtitleFile(config, onStatusUpdate);
      if (!injectRes.success) {
        return injectRes;
      }
      injectedList = injectRes.injectedFiles || [];
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
    if (shouldInject && injectedList.length > 0) {
      spawnDetachedCleanupWatcher(processPattern, injectedList);
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

        if (shouldInject && injectedList.length > 0) {
          for (const item of injectedList) {
            if (!item.destFilePath || item.destFilePath === config.gameExePath) continue;
            for (let attempt = 0; attempt < 10; attempt++) {
              try {
                if (item.backupFilePath && fs.existsSync(item.backupFilePath)) {
                  safeCopyFileSync(item.backupFilePath, item.destFilePath);
                  try { fs.unlinkSync(item.backupFilePath); } catch {}
                  break;
                } else if (fs.existsSync(item.destFilePath)) {
                  fs.unlinkSync(item.destFilePath);
                  break;
                }
              } catch {
                await new Promise((r) => setTimeout(r, 1000));
              }
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
