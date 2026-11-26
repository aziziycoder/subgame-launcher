import { spawn, ChildProcess, execSync, execFile, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { app } from 'electron';
import { isGameActivated } from './license';
import { decryptData } from './crypto';
import { isRangePatch, applyRangePatch, restoreRangePatch, POWERSHELL_RANGE_RESTORE } from './rangePatch';

export interface InjectedFileInfo {
  destFilePath: string;
  backupFilePath?: string;
  /** 'range' - fayl joyida bayt-patch qilingan (SGPATCH1); uni hech qachon o'chirmaslik kerak */
  kind?: 'file' | 'range';
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
  subtitleVersion?: string; // Real-time subtitle version from the backend (e.g. "v1.1.0")
  variantKey?: string; // Selected game variant key (e.g. "torrent", "steam")
  useDubbing?: boolean;
  dubbingDownloadUrl?: string;
  dubbingVersion?: string;
}

interface RunningGameSession {
  process: ChildProcess | null; // null when the game was started elevated through UAC
  gameId: string;
}

export const activeSessions = new Map<string, RunningGameSession>();

/** O'yin papkasiga butunligicha ko'chiriladigan qo'shimcha papka (RDR2: commonx/data/ui/fontmap.xml) */
export const EXTRA_GAME_DIR = 'commonx';

/** O'yin jarayoni shu vaqt ichida paydo bo'lmasa, ulangan fayllar qaytarib olinadi */
const DEFAULT_STARTUP_GRACE_SEC = 30;

interface LaunchPlan {
  /** Ishga tushiriladigan exe (o'yinning o'zi yoki uning launcheri) */
  exePath: string;
  /** Kuzatiladigan o'yin jarayoni nomining boshi */
  processPattern: string;
  startupGraceSec: number;
}

/**
 * Ba'zi o'yinlarni o'z exe'si orqali to'g'ridan-to'g'ri ochib bo'lmaydi. RDR2.exe to'g'ridan-to'g'ri
 * ishga tushirilsa "ERR_NO_LAUNCHER" beradi: uni Rockstar launcheri (PlayRDR2.exe) yoki o'yin
 * papkasidagi Launcher.exe ochishi kerak, u esa o'zi RDR2.exe ni ancha kechikib ishga tushiradi.
 * Shuning uchun launcherni ochamiz, lekin kuzatishni RDR2 jarayoni bo'yicha olib boramiz.
 */
export function resolveLaunchPlan(config: GameLaunchConfig, gameDir: string): LaunchPlan {
  const rawExeName = path.basename(config.gameExePath, path.extname(config.gameExePath));
  let processPattern = rawExeName.replace(/[-_](Win64|Win32|Shipping|x64|x86)+.*$/i, '');
  if (processPattern.length < 3) {
    processPattern = rawExeName;
  }

  if (config.gameId === 'red-dead-redemption-2') {
    const starters = ['Launcher.exe', 'PlayRDR2.exe'];
    const starter = /^rdr2$/i.test(rawExeName)
      ? starters.map((s) => path.join(gameDir, s)).find((p) => fs.existsSync(p))
      : undefined;
    return {
      exePath: starter || config.gameExePath,
      processPattern: 'RDR2',
      startupGraceSec: 300,
    };
  }

  return { exePath: config.gameExePath, processPattern, startupGraceSec: DEFAULT_STARTUP_GRACE_SEC };
}

/**
 * Foydalanuvchiga ko'rsatiladigan xato matnidan fayl yo'llari va nomlarini olib tashlaydi
 * (qaysi fayl yuklanayotgani/qo'yilayotgani launcherda ko'rinmasligi kerak).
 */
export function hideFileDetails(err: any): string {
  const msg = String(err?.message || err || '');
  return msg
    .replace(/[A-Za-z]:[\\/][^\s'"`,;)]+/g, '')
    .replace(/'[^']*[\\/][^']*'/g, '')
    .replace(/\b[\w.-]+\.(psarc|pak|enc|sds|pc|rpf|assets|swf|patch|subgame_\w+)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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
  legacyBackupPath?: string,
  startupGraceSec: number = DEFAULT_STARTUP_GRACE_SEC
): void {
  try {
    const fileEntries: Array<{ dest: string; bak: string; kind: string }> = Array.isArray(filesOrDest)
      ? filesOrDest.map((f) => ({ dest: f.destFilePath, bak: f.backupFilePath || '', kind: f.kind || 'file' }))
      : [{ dest: filesOrDest, bak: legacyBackupPath || '', kind: 'file' }];

    if (fileEntries.length === 0) return;

    const escapedPattern = pattern.replace(/'/g, "''");
    const fileArrayScript = fileEntries
      .map((f) => `@{ dest = '${f.dest.replace(/'/g, "''")}'; bak = '${f.bak.replace(/'/g, "''")}'; kind = '${f.kind}' }`)
      .join(', ');

    const psCommand = `
      $pattern = '${escapedPattern}';
      $files = @(${fileArrayScript});
      $t = 0;
      while (!(Get-Process -Name $pattern* -ErrorAction SilentlyContinue) -and $t -lt ${Math.max(1, Math.round(startupGraceSec))}) {
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
            if ($f.kind -eq 'range') {
              if ($f.bak -and (Test-Path -LiteralPath $f.bak)) {
                $dest = $f.dest; $bak = $f.bak;
                ${POWERSHELL_RANGE_RESTORE}
              }
            } elseif ($f.bak -and (Test-Path -LiteralPath $f.bak)) {
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

export function getSubtitleCacheDir(gameId: string, variantKey?: string): string {
  const safeVariant = variantKey && /^[a-z0-9._-]+$/i.test(variantKey.trim()) ? variantKey.trim() : '';
  return safeVariant
    ? path.join(app.getPath('userData'), 'subtitles', gameId, safeVariant)
    : path.join(app.getPath('userData'), 'subtitles', gameId);
}

function getLastInjectedManifestPath(gameId: string): string {
  return path.join(app.getPath('userData'), 'subtitles', gameId, 'last_injected.json');
}

export function clearLastInjectedManifest(gameId: string): void {
  try {
    const p = getLastInjectedManifestPath(gameId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}

/**
 * O'yin papkasidagi fayllar asosida variant mosligini tekshirish (hech qanday papka yaratmaydi)
 */
export function evaluateVariantRules(
  exePath: string,
  defaultRelativeDir: string | undefined,
  variants: Array<{
    key: string;
    targetRelativeDir?: string;
    detectFilesPresent?: string[];
    detectFilesAbsent?: string[];
    detectFileSizes?: Record<string, number | { exact?: number; min?: number; max?: number; optional?: boolean }>;
  }>
): {
  detectedKey: string | null;
  results: Record<string, { matched: boolean; reasons: string[] }>;
} {
  const results: Record<string, { matched: boolean; reasons: string[] }> = {};
  if (!exePath || !fs.existsSync(exePath) || !Array.isArray(variants) || variants.length === 0) {
    return { detectedKey: null, results };
  }

  const gameDir = fs.statSync(exePath).isFile() ? path.dirname(exePath) : exePath;

  const findExistingDir = (relDir?: string): string => {
    if (relDir && relDir !== '.') {
      const candidates = [
        path.join(gameDir, relDir),
        path.resolve(gameDir, '../../..', relDir),
        path.resolve(gameDir, '../..', relDir),
        path.resolve(gameDir, '..', relDir),
      ];
      const found = candidates.find((c) => fs.existsSync(c));
      if (found) return found;
    }
    return gameDir;
  };

  const resolveFileInDirs = (dir: string, fileName: string): string | null => {
    const p1 = path.join(dir, fileName);
    if (fs.existsSync(p1)) return p1;
    const p2 = path.join(gameDir, fileName);
    if (fs.existsSync(p2)) return p2;
    return null;
  };

  let detectedKey: string | null = null;

  for (const v of variants) {
    const reasons: string[] = [];
    const rel = v.targetRelativeDir ?? defaultRelativeDir;
    const dir = findExistingDir(rel);

    const presentList = Array.isArray(v.detectFilesPresent) ? v.detectFilesPresent : [];
    const absentList = Array.isArray(v.detectFilesAbsent) ? v.detectFilesAbsent : [];
    const sizeRules = v.detectFileSizes && typeof v.detectFileSizes === 'object' ? v.detectFileSizes : {};

    const hasAnyRule = presentList.length > 0 || absentList.length > 0 || Object.keys(sizeRules).length > 0;
    if (!hasAnyRule) {
      results[v.key] = { matched: true, reasons: [] };
      continue;
    }

    for (const f of presentList) {
      if (!resolveFileInDirs(dir, f)) {
        reasons.push(`Kerakli fayl topilmadi: ${f}`);
      }
    }

    for (const f of absentList) {
      if (resolveFileInDirs(dir, f)) {
        reasons.push(`Mos kelmaydigan fayl mavjud: ${f}`);
      }
    }

    for (const [f, rule] of Object.entries(sizeRules)) {
      // Agar zaxira fayl (.subgame_bak) bo'lsa, asl o'lchamni zaxiradan tekshiramiz
      const bakPath = resolveFileInDirs(dir, `${f}.subgame_bak`);
      const filePath = bakPath || resolveFileInDirs(dir, f);
      if (!filePath) {
        if (typeof rule === 'object' && rule !== null && (rule.optional || rule.max !== undefined)) {
          continue;
        }
        reasons.push(`Fayl topilmadi: ${f}`);
        continue;
      }
      const size = fs.statSync(filePath).size;
      if (typeof rule === 'number') {
        if (size !== rule) {
          reasons.push(`${f} hajmi mos emas (${size} != ${rule} bayt)`);
        }
      } else if (rule && typeof rule === 'object') {
        if (rule.exact !== undefined && size !== rule.exact) {
          reasons.push(`${f} hajmi mos emas (${size} != ${rule.exact} bayt)`);
        }
        if (rule.min !== undefined && size < rule.min) {
          reasons.push(`${f} hajmi kichik (${size} < ${rule.min} bayt)`);
        }
        if (rule.max !== undefined && size > rule.max) {
          reasons.push(`${f} hajmi katta (${size} > ${rule.max} bayt)`);
        }
      }
    }

    const matched = reasons.length === 0;
    results[v.key] = { matched, reasons };
    if (matched && !detectedKey) {
      detectedKey = v.key;
    }
  }

  return { detectedKey, results };
}

/**
 * Subtitr manba faylini qidirish (shifrlangan .enc yoki asl fayl)
 */
export function findSubtitleSource(
  gameId: string,
  fileName: string,
  variantKey?: string
): { path: string; isEncrypted: boolean } | null {
  const encName = `${fileName}.enc`;
  const userCache = getSubtitleCacheDir(gameId, variantKey);
  const safeVariant = variantKey && /^[a-z0-9._-]+$/i.test(variantKey.trim()) ? variantKey.trim() : '';

  const resPath = process.resourcesPath;
  // Avval shifrlangan .enc faylni qidiramiz, keyin asl faylni
  for (const f of [encName, fileName]) {
    const candidatePaths = [
      path.join(userCache, f),
      ...(safeVariant && resPath ? [
        path.join(resPath, 'subtitles', gameId, safeVariant, f),
        path.join(resPath, 'public', 'subtitles', gameId, safeVariant, f),
      ] : []),
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
 * O'yin papkasiga qo'yiladigan subtitr fayllari nomlari (masalan "stringtable_en.sds,stringtable_ru.sds").
 */
export function resolveSubtitleFileNames(config: GameLaunchConfig, destDir: string): string[] {
  const fileNames = (config.targetSubtitleFileName || '')
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
  return fileNames;
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

    const fileNames = resolveSubtitleFileNames(config, destDir);

    // Oldingi sessiya qulab qolgan yoki variant almashtirilgan bo'lsa, qolib ketgan fayllarni tiklaymiz
    const manifestPath = getLastInjectedManifestPath(config.gameId);
    if (fs.existsSync(manifestPath)) {
      try {
        const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (Array.isArray(prev?.files) && prev.files.length > 0) {
          await restoreInjectedFiles(prev.files, config.gameExePath);
        }
      } catch {}
      clearLastInjectedManifest(config.gameId);
    }

    const userSubDir = getSubtitleCacheDir(config.gameId, config.variantKey);
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
        try {
          fs.rmSync(path.join(userSubDir, EXTRA_GAME_DIR), { recursive: true, force: true });
        } catch {}
      }
    }

    // Agar lokal papkalarda barcha fayllar topilmasa va server URL berilgan bo'lsa, yuklab olamiz
    let allFound = !needsVersionUpdate && fileNames.every((f) => findSubtitleSource(config.gameId, f, config.variantKey) !== null);

    if (!allFound && config.subtitleDownloadUrl && config.subtitleDownloadUrl.startsWith('http')) {
      try {
        if (!fs.existsSync(userSubDir)) {
          fs.mkdirSync(userSubDir, { recursive: true });
        }

        const tempDownloadPath = path.join(userSubDir, `temp_download_${Date.now()}.zip`);
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
            let extracted = false;
            // 1. Tar orqali tezkor va xavfsiz ochish (Windows 10/11 ichki utilitasi)
            try {
              execSync(`tar -xf "${tempDownloadPath}" -C "${userSubDir}"`, { stdio: 'ignore', windowsHide: true });
              extracted = true;
            } catch {}

            // 2. PowerShell Expand-Archive zaxira usuli
            if (!extracted) {
              try {
                execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${tempDownloadPath.replace(/'/g, "''")}' -DestinationPath '${userSubDir.replace(/'/g, "''")}' -Force"`, { windowsHide: true });
                extracted = true;
              } catch (unzipErr) {
                console.warn('Zip faylni ochishda xatolik:', unzipErr);
              }
            }
            try { fs.unlinkSync(tempDownloadPath); } catch {}

            // Agar zip ichida alohida papka bo'lsa, fayllarni userSubDir ildiziga ko'chiramiz (flatten)
            try {
              const subEntries = fs.readdirSync(userSubDir, { withFileTypes: true });
              for (const subEntry of subEntries) {
                // commonx — o'yin papkasiga butunligicha ko'chiriladigan papka (RDR2 fontmap), uni yoymaymiz
                if (subEntry.isDirectory() && subEntry.name.toLowerCase() !== EXTRA_GAME_DIR) {
                  const nestedDir = path.join(userSubDir, subEntry.name);
                  const nestedFiles = fs.readdirSync(nestedDir);
                  for (const nf of nestedFiles) {
                    const srcP = path.join(nestedDir, nf);
                    const dstP = path.join(userSubDir, nf);
                    if (nf.toLowerCase() === EXTRA_GAME_DIR && fs.existsSync(dstP)) {
                      try { fs.rmSync(dstP, { recursive: true, force: true }); } catch {}
                    }
                    if (!fs.existsSync(dstP)) {
                      try { fs.renameSync(srcP, dstP); } catch {}
                    }
                  }
                  try { fs.rmSync(nestedDir, { recursive: true, force: true }); } catch {}
                }
              }
            } catch {}
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

      let source = findSubtitleSource(config.gameId, targetFileName, config.variantKey);

      // Agar aynan shu nomdagi manba topilmasa, lekin boshqa fayl yuklangan bo'lsa (masalan, EN -> RU nusxalash)
      // Faqat bir xil kengaytmali fayl (stringtable_en.sds -> _ru.sds). Aks holda RDR2'da XML
      // dinput8.dll nomi bilan yozilib, o'yinni buzib qo'yardi.
      if (!source) {
        const wantExt = path.extname(targetFileName).toLowerCase();
        for (const otherF of fileNames) {
          if (otherF === targetFileName || path.extname(otherF).toLowerCase() !== wantExt) continue;
          const altSource = findSubtitleSource(config.gameId, otherF, config.variantKey);
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
          message: "O'zbekcha paket topilmadi. Internet aloqasini tekshirib, qaytadan urinib ko'ring.",
        };
      }

      onStatusUpdate?.("O'zbekcha paket o'yinga xavfsiz ulanmoqda...");

      // Bayt-oraliq patchi (SGPATCH1): katta arxivlarni butunlay nusxalamay, joyida patchlaymiz
      let sourceBuffer: Buffer | null = null;
      try {
        const rawBuf = fs.readFileSync(source.path);
        try {
          sourceBuffer = decryptData(rawBuf);
        } catch {
          sourceBuffer = source.isEncrypted ? null : rawBuf;
        }
      } catch {}

      if (isRangePatch(sourceBuffer)) {
        if (!fs.existsSync(destFilePath)) {
          return {
            success: false,
            message: "O'yin fayllari to'liq emas. O'yin papkasini to'g'ri tanlaganingizni tekshiring.",
          };
        }
        const rangeBackupPath = `${destFilePath}.subgame_rangebak`;
        try {
          applyRangePatch(destFilePath, sourceBuffer as Buffer, rangeBackupPath);
        } catch (patchErr: any) {
          return {
            success: false,
            message: `O'zbekcha paketni ulab bo'lmadi: ${hideFileDetails(patchErr)}`,
          };
        }
        injectedList.push({ destFilePath, backupFilePath: rangeBackupPath, kind: 'range' });
        continue;
      }

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

    // Agar o'yin papkasida qo'shimcha papkalar kerak bo'lsa (masalan RDR2 fontmap uchun commonx)
    // Yuklangan paket (userData) birinchi, keyin exe ichidagi zaxira. Faqat biz tarqatadigan
    // fayllar yangilanadi; o'yinchining commonx ichidagi boshqa modlariga tegilmaydi.
    if (injectedList.length > 0) {
      const parentGameDir = path.dirname(injectedList[0].destFilePath);
      const commonxCandidates = [
        path.join(userSubDir, EXTRA_GAME_DIR),
        ...(process.resourcesPath ? [path.join(process.resourcesPath, 'subtitles', config.gameId, EXTRA_GAME_DIR)] : []),
        path.join(app.getAppPath(), 'public', 'subtitles', config.gameId, EXTRA_GAME_DIR),
      ];
      const commonxSrc = commonxCandidates.find((p) => {
        try { return fs.statSync(p).isDirectory(); } catch { return false; }
      });
      if (commonxSrc) {
        try {
          fs.cpSync(commonxSrc, path.join(parentGameDir, EXTRA_GAME_DIR), { recursive: true, force: true });
        } catch (cpxErr) {
          console.warn('commonx papkasini nusxalashda ogohlantirish:', cpxErr);
        }
      }
    }

    if (config.useDubbing && config.dubbingDownloadUrl && config.dubbingDownloadUrl.startsWith('http')) {
      const dubVer = (config.dubbingVersion || 'v1.0.0').trim();
      const dubMarkerPath = path.join(gameDir, '.subgame_dub_version');
      let alreadyInstalled = false;
      try {
        if (fs.existsSync(dubMarkerPath) && fs.readFileSync(dubMarkerPath, 'utf8').trim() === dubVer) {
          alreadyInstalled = true;
        }
      } catch {}

      if (!alreadyInstalled) {
        const userDubDir = path.join(app.getPath('userData'), 'dubbing', config.gameId);
        if (!fs.existsSync(userDubDir)) {
          fs.mkdirSync(userDubDir, { recursive: true });
        }
        const tempDubZip = path.join(userDubDir, `dub_${Date.now()}.zip`);
        onStatusUpdate?.("O‘zbekcha dublyaj paketi yuklanmoqda...");
        await downloadSubtitleFile(config.dubbingDownloadUrl, tempDubZip, onStatusUpdate);

        if (fs.existsSync(tempDubZip)) {
          onStatusUpdate?.("Dublyaj fayllari o‘yin papkasiga joylashtirilmoqda...");
          let extracted = false;
          try {
            execSync(`tar -xf "${tempDubZip}" -C "${gameDir}"`, { stdio: 'ignore', windowsHide: true });
            extracted = true;
          } catch {}
          if (!extracted) {
            execSync(
              `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${tempDubZip.replace(/'/g, "''")}' -DestinationPath '${gameDir.replace(/'/g, "''")}' -Force"`,
              { windowsHide: true }
            );
          }
          try { fs.unlinkSync(tempDubZip); } catch {}
          try { fs.writeFileSync(dubMarkerPath, dubVer, 'utf8'); } catch {}
        }
      }
    }

    if (injectedList.length > 0) {
      try {
        const manifestPath = getLastInjectedManifestPath(config.gameId);
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        fs.writeFileSync(
          manifestPath,
          JSON.stringify({ variantKey: config.variantKey || null, files: injectedList }),
          'utf8'
        );
      } catch {}
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
      message: `Subtitrni joylashda xatolik: ${hideFileDetails(error)}`,
    };
  }
}

/**
 * O'yinni o'zbekcha subtitrlar bilan ishga tushirish (A-Variant DRM)
 */
/**
 * O'yin papkasiga qo'yilgan fayllarni asl holiga qaytaradi (zaxiradan tiklaydi yoki o'chiradi).
 */
async function restoreInjectedFiles(injectedList: InjectedFileInfo[], gameExePath: string): Promise<void> {
  for (const item of injectedList) {
    if (!item.destFilePath || item.destFilePath === gameExePath) continue;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        if (item.kind === 'range') {
          // Arxivni hech qachon o'chirmaymiz: faqat asl baytlarni qaytaramiz
          if (item.backupFilePath) restoreRangePatch(item.destFilePath, item.backupFilePath);
          break;
        }
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

/**
 * O'yin exe'sini oddiy jarayon sifatida ishga tushiradi.
 * Windows jarayonni yaratgach resolve bo'ladi, rad etsa spawn xatosi bilan reject bo'ladi
 * (xato 'error' hodisasida keladi, uni ushlamasak main process qulaydi).
 */
function spawnGameProcess(exePath: string, cwd: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, [], { cwd, detached: true, stdio: 'ignore' });
    child.once('spawn', () => {
      child.unref();
      resolve(child);
    });
    child.once('error', reject);
  });
}

/**
 * Exe "Administrator sifatida ishga tushirish" deb belgilangan bo'lsa (Compatibility sozlamasi
 * yoki manifest), oddiy spawn Windows 740 xatosi bilan rad etiladi — Node buni EACCES deb beradi.
 * Bunday holda UAC oynasi orqali ishga tushiramiz. Foydalanuvchi rad etsa, reject bo'ladi.
 */
function startGameElevated(exePath: string, cwd: string): Promise<void> {
  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const command = `Start-Process -FilePath ${quote(exePath)} -WorkingDirectory ${quote(cwd)} -Verb RunAs`;
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true }, (err) =>
      err ? reject(err) : resolve()
    );
  });
}

function needsElevation(err: any): boolean {
  return err?.code === 'EACCES' || err?.errno === 740 || err?.errno === -4092;
}

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

    // Ishga tushiriladigan exe va kuzatiladigan jarayon (Stray.exe -> Stray; RDR2 -> Launcher.exe, kuzatish RDR2)
    const plan = resolveLaunchPlan(config, gameDir);
    const processPattern = plan.processPattern;

    // 4. Launch Game process
    let gameProcess: ChildProcess | null = null;
    try {
      gameProcess = await spawnGameProcess(plan.exePath, gameDir);
    } catch (spawnErr: any) {
      let started = false;
      if (needsElevation(spawnErr)) {
        onStatusUpdate("O'yin administrator ruxsatini so'rayapti...");
        try {
          await startGameElevated(plan.exePath, gameDir);
          started = true;
        } catch {}
      }
      if (!started) {
        if (shouldInject && injectedList.length > 0) {
          await restoreInjectedFiles(injectedList, config.gameExePath);
          clearLastInjectedManifest(config.gameId);
        }
        return {
          success: false,
          message: needsElevation(spawnErr)
            ? "O'yin administrator ruxsatisiz ishga tushmaydi. So'rov oynasida \"Ha\" ni bosing yoki o'yin exe faylining Compatibility sozlamasidan \"Run this program as an administrator\" belgisini olib tashlang."
            : `O'yinni ishga tushirib bo'lmadi: ${hideFileDetails(spawnErr)}`,
        };
      }
    }

    activeSessions.set(config.gameId, {
      process: gameProcess,
      gameId: config.gameId,
    });

    // Windows mustaqil tozalovchi jarayonini ishga tushiramiz (Launcher yopilsa ham fonda ishlaydi)
    if (shouldInject && injectedList.length > 0) {
      spawnDetachedCleanupWatcher(processPattern, injectedList, undefined, plan.startupGraceSec);
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

      // O'yin ishga tushib keyin yopilsa, yoki kutish vaqti ichida umuman boshlanmasa (2 soniyalik qadam)
      if ((gameHasStarted && !isRunning) || (!gameHasStarted && checkCount > plan.startupGraceSec / 2)) {
        clearInterval(monitorInterval);
        activeSessions.delete(config.gameId);
        onStatusUpdate("O'yin yakunlandi. Subtitrlar himoyalanmoqda...");

        if (shouldInject && injectedList.length > 0) {
          await restoreInjectedFiles(injectedList, config.gameExePath);
          clearLastInjectedManifest(config.gameId);
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
      message: `Ishga tushirishda xatolik: ${hideFileDetails(error)}`,
    };
  }
}
