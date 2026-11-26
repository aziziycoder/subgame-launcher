import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { decryptData } from './crypto';
import { isRangePatch, parseRangePatch, restoreRangePatch } from './rangePatch';
import {
  GameLaunchConfig,
  EXTRA_GAME_DIR,
  activeSessions,
  clearLastInjectedManifest,
  findSubtitleSource,
  getSubtitleCacheDir,
  hideFileDetails,
  isProcessRunning,
  resolveLaunchPlan,
  resolveSubtitleFileNames,
  safeCopyFileSync,
} from './gameRunner';

/**
 * O'zbekcha subtitrlarni kompyuterdan olib tashlash.
 *
 * Launcher o'yinga subtitrni ishga tushirishda qo'yadi va o'yin yopilganda zaxiradan tiklaydi,
 * yuklab olingan paket esa userData/subtitles/<gameId> da qoladi. Bu modul:
 *  - o'yin papkasida qolib ketgan launcher fayllarini topadi (zaxiralar, patchlangan fayllar, commonx);
 *  - asl fayllarni zaxiradan tiklaydi, faqat launcher qo'ygan fayllarni o'chiradi;
 *  - launcher yuklab olgan paketni (keshni) o'chiradi.
 * O'yinning o'z fayllari va papkalariga tegilmaydi. Litsenziya o'zgarmaydi.
 */

type ActionKind =
  | 'restore-backup' // .subgame_bak -> asl fayl
  | 'drop-backup' // asl fayl joyida, ortiqcha zaxirani o'chirish
  | 'restore-range' // .subgame_rangebak -> asl baytlar
  | 'delete-added' // launcher qo'shgan fayl (zaxirasiz, mazmuni paketimiz bilan bir xil)
  | 'delete-extra'; // commonx ichidagi biz tarqatgan fayl

interface PlannedAction {
  kind: ActionKind;
  target: string;
  backup?: string;
  /** Bu amal diskdan bo'shatadigan joy (bayt) */
  bytes: number;
  /** Asl fayl zaxirasiz qolgan bo'lishi mumkin: Steam/Epic orqali tekshirish tavsiya qilinadi */
  needsVerify?: boolean;
}

export interface SubtitleRemovalInfo {
  success: boolean;
  message?: string;
  /** Launcher yuklab olgan paket hajmi (bayt) */
  cacheBytes: number;
  /** O'yin papkasidan bo'shaydigan joy (bayt) */
  gameFolderBytes: number;
  totalBytes: number;
  /** O'yin papkasida tiklanadigan/o'chiriladigan fayllar soni */
  gameFolderItems: number;
  gameFolderFound: boolean;
  gameRunning: boolean;
  /** Ba'zi fayllar band (o'yin yoki boshqa dastur ochib turibdi) */
  filesLocked: boolean;
  /** Olib tashlanadigan hech narsa yo'q */
  nothingToRemove: boolean;
  needsVerify: boolean;
}

export interface SubtitleRemovalResult {
  success: boolean;
  message: string;
  freedBytes?: number;
  needsVerify?: boolean;
  code?: 'running' | 'locked' | 'folder-missing' | 'error';
}

function userCacheDir(gameId: string, variantKey?: string): string {
  return getSubtitleCacheDir(gameId, variantKey);
}

function isSafeGameId(gameId: string): boolean {
  return typeof gameId === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(gameId) && !gameId.includes('..');
}

function fileSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      total += e.isDirectory() ? dirSize(full) : fileSize(full);
    }
  } catch {}
  return total;
}

function listFilesRel(dir: string, base = dir): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? listFilesRel(full, base) : [path.relative(base, full)];
    });
  } catch {
    return [];
  }
}

/** injectSubtitleFile dagi maqsad papka bilan bir xil, lekin hech qanday papka yaratmaydi */
function findTargetDir(gameDir: string, targetRelativeDir?: string): string {
  if (targetRelativeDir) {
    const candidates = [
      path.join(gameDir, targetRelativeDir),
      path.resolve(gameDir, '../../..', targetRelativeDir),
      path.resolve(gameDir, '../..', targetRelativeDir),
      path.resolve(gameDir, '..', targetRelativeDir),
    ];
    const found = candidates.find((c) => fs.existsSync(c));
    if (found) return found;
  }
  if (fs.existsSync(path.join(gameDir, 'TRTEXT'))) return path.join(gameDir, 'TRTEXT');
  if (targetRelativeDir) return path.join(gameDir, targetRelativeDir);
  return gameDir;
}

/** Paketimizdagi faylning o'yinga yoziladigan (dekodlangan) mazmuni; paket yo'q bo'lsa null */
function readOurPayload(gameId: string, fileName: string, fileNames: string[], variantKey?: string): Buffer | null {
  let source = findSubtitleSource(gameId, fileName, variantKey);
  if (!source) {
    const wantExt = path.extname(fileName).toLowerCase();
    for (const other of fileNames) {
      if (other === fileName || path.extname(other).toLowerCase() !== wantExt) continue;
      source = findSubtitleSource(gameId, other, variantKey);
      if (source) break;
    }
  }
  if (!source) return null;
  try {
    const raw = fs.readFileSync(source.path);
    try {
      return decryptData(raw);
    } catch {
      return source.isEncrypted ? null : raw;
    }
  } catch {
    return null;
  }
}

/** Fayl band (o'yin ochiq) bo'lsa, uni "bizniki emas" deb jim o'tkazib yubormaslik uchun xatoni uzatamiz */
class FileLockedError extends Error {
  code = 'EBUSY';
}

function rethrowIfLocked(err: any): void {
  if (err?.code === 'EBUSY' || err?.code === 'EPERM' || err?.code === 'EACCES') {
    throw new FileLockedError(String(err?.message || err));
  }
}

function sameContent(file: string, data: Buffer): boolean {
  try {
    if (fs.statSync(file).size !== data.length) return false;
    return fs.readFileSync(file).equals(data);
  } catch (err) {
    rethrowIfLocked(err);
    return false;
  }
}

function filesEqual(a: string, b: string): boolean {
  try {
    if (fs.statSync(a).size !== fs.statSync(b).size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch (err) {
    rethrowIfLocked(err);
    return false;
  }
}

/** Range patch: fayl hozir to'liq bizning baytlarimiz bilan patchlanganmi */
function isRangeApplied(file: string, patch: Buffer): boolean {
  try {
    const parsed = parseRangePatch(patch);
    if (fs.statSync(file).size !== parsed.targetSize) return false;
    const fd = fs.openSync(file, 'r');
    try {
      for (const e of parsed.entries) {
        const cur = Buffer.alloc(e.data.length);
        fs.readSync(fd, cur, 0, e.data.length, e.offset);
        if (!cur.equals(e.data)) return false;
      }
      return true;
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    rethrowIfLocked(err);
    return false;
  }
}

function planGameFolder(config: GameLaunchConfig, gameDir: string): PlannedAction[] {
  const actions: PlannedAction[] = [];
  const destDir = findTargetDir(gameDir, config.targetRelativeDir);
  if (!fs.existsSync(destDir)) return actions;

  const fileNames = resolveSubtitleFileNames(config, destDir);

  // Avvalgi launcher xatosidan qolgan noto'g'ri nomli fayl (faqat launcher yaratgan)
  const junk = path.join(destDir, 'stringtable_en.sds,stringtable_ru.sds');
  if (fs.existsSync(junk)) actions.push({ kind: 'delete-added', target: junk, bytes: fileSize(junk) });

  for (const name of fileNames) {
    const dest = path.join(destDir, name);
    if (path.resolve(dest).toLowerCase() === path.resolve(config.gameExePath).toLowerCase()) continue;
    const bak = path.join(destDir, `${name}.subgame_bak`);
    const rangeBak = `${dest}.subgame_rangebak`;
    const payload = readOurPayload(config.gameId, name, fileNames, config.variantKey);

    if (fs.existsSync(rangeBak)) {
      actions.push({ kind: 'restore-range', target: dest, backup: rangeBak, bytes: fileSize(rangeBak) });
      continue;
    }
    if (payload && isRangePatch(payload)) {
      // Zaxirasiz, lekin fayl hali patchlangan: asl baytlarni qaytara olmaymiz
      if (fs.existsSync(dest) && isRangeApplied(dest, payload)) {
        actions.push({ kind: 'restore-range', target: dest, bytes: 0, needsVerify: true });
      }
      continue;
    }

    if (fs.existsSync(bak)) {
      if (fs.existsSync(dest) && filesEqual(dest, bak)) {
        actions.push({ kind: 'drop-backup', target: dest, backup: bak, bytes: fileSize(bak) });
      } else {
        actions.push({ kind: 'restore-backup', target: dest, backup: bak, bytes: fileSize(bak) });
      }
      continue;
    }

    // Zaxira yo'q: faqat mazmuni aynan bizning paketimiz bilan bir xil faylni o'chiramiz.
    // Asl fayl hech qachon bo'lmagan bo'lsa (masalan, qo'shimcha dll) o'yin buzilmaydi; aks holda
    // foydalanuvchiga o'yin fayllarini tekshirishni tavsiya qilamiz.
    if (payload && fs.existsSync(dest) && sameContent(dest, payload)) {
      actions.push({ kind: 'delete-added', target: dest, bytes: payload.length, needsVerify: true });
    }
  }

  // commonx (RDR2 fontmap): faqat biz tarqatgan va mazmuni o'zgarmagan fayllar
  const cacheExtra = [
    path.join(userCacheDir(config.gameId, config.variantKey), EXTRA_GAME_DIR),
    ...(process.resourcesPath ? [path.join(process.resourcesPath, 'subtitles', config.gameId, EXTRA_GAME_DIR)] : []),
    path.join(app.getAppPath(), 'public', 'subtitles', config.gameId, EXTRA_GAME_DIR),
  ].find((p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
  if (cacheExtra) {
    const gameExtra = path.join(destDir, EXTRA_GAME_DIR);
    for (const rel of listFilesRel(cacheExtra)) {
      const inGame = path.join(gameExtra, rel);
      if (fs.existsSync(inGame) && filesEqual(inGame, path.join(cacheExtra, rel))) {
        actions.push({ kind: 'delete-extra', target: inGame, bytes: fileSize(inGame) });
      }
    }
  }

  return actions;
}

function gameIsRunning(config: GameLaunchConfig, gameDir: string): boolean {
  if (activeSessions.has(config.gameId)) return true;
  try {
    return isProcessRunning(resolveLaunchPlan(config, gameDir).processPattern);
  } catch {
    return false;
  }
}

function folderState(config: GameLaunchConfig): { gameDir: string; found: boolean } {
  const exe = config.gameExePath || '';
  const gameDir = exe ? path.dirname(exe) : '';
  return { gameDir, found: !!exe && fs.existsSync(exe) };
}

export function getSubtitleRemovalInfo(config: GameLaunchConfig): SubtitleRemovalInfo {
  const empty: SubtitleRemovalInfo = {
    success: false,
    cacheBytes: 0,
    gameFolderBytes: 0,
    totalBytes: 0,
    gameFolderItems: 0,
    gameFolderFound: false,
    gameRunning: false,
    filesLocked: false,
    nothingToRemove: true,
    needsVerify: false,
  };
  try {
    if (!config || !isSafeGameId(config.gameId)) return { ...empty, message: "O'yin aniqlanmadi." };
    const cacheBytes = dirSize(userCacheDir(config.gameId, config.variantKey));
    const { gameDir, found } = folderState(config);
    let actions: PlannedAction[] = [];
    let filesLocked = false;
    if (found) {
      try {
        actions = planGameFolder(config, gameDir);
      } catch (err) {
        if (!(err instanceof FileLockedError)) throw err;
        filesLocked = true;
      }
    }
    const gameFolderBytes = actions.reduce((s, a) => s + a.bytes, 0);
    const cacheExists = fs.existsSync(userCacheDir(config.gameId, config.variantKey));
    return {
      success: true,
      cacheBytes,
      gameFolderBytes,
      totalBytes: cacheBytes + gameFolderBytes,
      gameFolderItems: actions.length,
      gameFolderFound: found,
      gameRunning: found ? gameIsRunning(config, gameDir) : activeSessions.has(config.gameId),
      filesLocked,
      nothingToRemove: !cacheExists && actions.length === 0 && !filesLocked,
      needsVerify: actions.some((a) => a.needsVerify),
    };
  } catch (err) {
    return { ...empty, message: `Ma'lumotni o'qib bo'lmadi: ${hideFileDetails(err)}` };
  }
}

function isLockError(err: any): boolean {
  const code = err?.code;
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return true;
  return /EBUSY|EPERM|EACCES|ruxsat/i.test(String(err?.message || ''));
}

async function withRetry(fn: () => void, attempts = 3): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      fn();
      return;
    } catch (err) {
      if (i >= attempts - 1 || !isLockError(err)) throw err;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
}

function removeEmptyDirsUpTo(startDir: string, stopDir: string): void {
  let dir = startDir;
  const stop = path.resolve(stopDir).toLowerCase();
  while (path.resolve(dir).toLowerCase().startsWith(stop)) {
    try {
      if (fs.readdirSync(dir).length > 0) return;
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    if (path.resolve(dir).toLowerCase() === stop) return;
    dir = path.dirname(dir);
  }
}

/**
 * Subtitrlarni olib tashlaydi.
 * cacheOnly: o'yin papkasi topilmaganda foydalanuvchi faqat launcher yuklagan paketni o'chirishni tanlaydi.
 */
export async function removeSubtitles(config: GameLaunchConfig, cacheOnly = false): Promise<SubtitleRemovalResult> {
  try {
    if (!config || !isSafeGameId(config.gameId)) {
      return { success: false, code: 'error', message: "O'yin aniqlanmadi." };
    }
    const { gameDir, found } = folderState(config);

    if (!found && !cacheOnly) {
      return {
        success: false,
        code: 'folder-missing',
        message:
          "O'yin papkasi topilmadi. O'yinni boshqa joyga ko'chirgan bo'lsangiz, avval yangi joydagi .exe faylini tanlang. O'yin o'chirilgan bo'lsa, faqat launcher yuklab olgan fayllarni o'chirishingiz mumkin.",
      };
    }

    if (found && gameIsRunning(config, gameDir)) {
      return {
        success: false,
        code: 'running',
        message: "O'yin hozir ochiq. Avval o'yinni to'liq yoping, keyin subtitrlarni o'chiring.",
      };
    }

    let freed = 0;
    let needsVerify = false;

    if (found && !cacheOnly) {
      try {
        const actions = planGameFolder(config, gameDir);
        for (const a of actions) {
          switch (a.kind) {
            case 'restore-backup':
              await withRetry(() => {
                safeCopyFileSync(a.backup!, a.target);
                fs.unlinkSync(a.backup!);
              });
              break;
            case 'drop-backup':
              await withRetry(() => fs.unlinkSync(a.backup!));
              break;
            case 'restore-range':
              if (a.backup) await withRetry(() => void restoreRangePatch(a.target, a.backup!));
              break;
            case 'delete-added':
              await withRetry(() => fs.unlinkSync(a.target));
              break;
            case 'delete-extra': {
              await withRetry(() => fs.unlinkSync(a.target));
              const marker = `${path.sep}${EXTRA_GAME_DIR}${path.sep}`;
              const idx = a.target.toLowerCase().lastIndexOf(marker.toLowerCase());
              if (idx >= 0) {
                const root = a.target.slice(0, idx + marker.length - 1);
                removeEmptyDirsUpTo(path.dirname(a.target), root);
              }
              break;
            }
          }
          freed += a.bytes;
          if (a.needsVerify) needsVerify = true;
        }
      } catch (err) {
        if (isLockError(err)) {
          return {
            success: false,
            code: 'locked',
            message:
              "Ba'zi fayllar band: o'yin yoki boshqa dastur ularni ishlatmoqda. O'yinni (va Steam/Epic launcherini) yoping, keyin qaytadan urinib ko'ring.",
          };
        }
        throw err;
      }
    }

    // Launcher yuklab olgan paket (o'yin papkasi tozalangandan keyin, aks holda qayta urinishda
    // qaysi fayl bizniki ekanini aniqlay olmay qolamiz)
    const cacheDir = userCacheDir(config.gameId, config.variantKey);
    if (fs.existsSync(cacheDir)) {
      const bytes = dirSize(cacheDir);
      try {
        fs.rmSync(cacheDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
      } catch (err) {
        if (isLockError(err)) {
          return {
            success: false,
            code: 'locked',
            message: "Launcher yuklab olgan fayllar band. Launcherni qayta ochib, yana urinib ko'ring.",
          };
        }
        throw err;
      }
      freed += bytes;
    }
    clearLastInjectedManifest(config.gameId);

    const mb = (freed / (1024 * 1024)).toFixed(1);
    let message = found && !cacheOnly
      ? `O'zbekcha subtitrlar o'chirildi, o'yin asl holiga qaytarildi. ${mb} MB joy bo'shadi.`
      : `Launcher yuklab olgan o'zbekcha subtitr fayllari o'chirildi. ${mb} MB joy bo'shadi.`;
    if (needsVerify) {
      message +=
        " Agar o'yin ishga tushmasa yoki matnlar buzilsa, Steam/Epic'da o'yin fayllarini tekshiring (Verify integrity of game files).";
    }
    message += " Litsenziyangiz saqlanib qoldi: xohlasangiz istalgan vaqt qayta o'rnatishingiz mumkin.";
    return { success: true, message, freedBytes: freed, needsVerify };
  } catch (err) {
    return { success: false, code: 'error', message: `Subtitrlarni o'chirishda xatolik: ${hideFileDetails(err)}` };
  }
}
