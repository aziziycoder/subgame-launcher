import type { LauncherGame } from '../data/launcherGames';
import { fetchFromBackend } from './apiClient';

/**
 * Normalizes relative URLs (e.g. /images/...) to absolute HTTPS URLs so Electron can load them seamlessly.
 */
function toAbsoluteUrl(url?: string): string {
  if (!url) return 'https://www.subgame.uz/images/logo_doppi.png';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `https://www.subgame.uz${url}`;
  if (url.startsWith('./')) return `https://www.subgame.uz/${url.substring(2)}`;
  return `https://www.subgame.uz/${url}`;
}

/**
 * Admin panel bo'sh maydonlarni "-" bilan to'ldirib qo'yadi; ularni qiymat yo'q deb hisoblaymiz,
 * aks holda "-" fayl yoki exe nomi sifatida ishlatilib, o'yin "subtitrsiz" deb belgilanadi.
 */
function field(...values: any[]): string | undefined {
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (s && !/^[-–—]+$/.test(s)) return s;
  }
  return undefined;
}

/**
 * Fetch games list purely and dynamically from the backend for the Launcher.
 * 100% dynamic from the central database, no static array fallback.
 */
function mapRawGameToLauncherGame(data: any, fallbackId?: string): LauncherGame {
  const card = toAbsoluteUrl(data.cardImage || data.card_image || data.cover);
  const cov = toAbsoluteUrl(data.cover || data.cardImage || data.card_image);
  const id = data.id || data.slug || fallbackId || 'game';

  let targetFileName = field(data.targetFileName, data.target_file_name);
  let targetRelativeDir = field(data.targetRelativeDir, data.target_relative_dir);
  const rawExeName = field(data.defaultExeName, data.default_exe_name);
  let defaultExeName = rawExeName || 'Game.exe';
  let keyPrefix = field(data.keyPrefix, data.key_prefix) || 'SUB-GAME';
  let status = data.subtitleStatus || data.subtitle_status || data.status || 'Tayyor';
  let subtitleSize = field(data.subtitleSize, data.subtitle_size) || '1.5 MB';

  if (id === 'mafia-definitive-edition' || data.slug === 'mafia-definitive-edition') {
    targetFileName = targetFileName || 'stringtable_en.sds';
    targetRelativeDir = (targetRelativeDir || 'sds_retail/string_tables').replace(/[\\/]+$/, '');
    defaultExeName = defaultExeName || 'mafiadefinitiveedition.exe';
    keyPrefix = 'SUB-MAFI';
    status = 'Tayyor';
    subtitleSize = subtitleSize || '1.6 MB';
  }

  if (id === 'red-dead-redemption-2' || data.slug === 'red-dead-redemption-2') {
    targetFileName = targetFileName || 'rdr2-translator.xml,Translation.xml,rdr2-translator.asi,dinput8.dll,ScriptHookRDR2.dll';
    targetRelativeDir = '';
    defaultExeName = rawExeName || 'RDR2.exe';
    keyPrefix = 'SUB-RDR2';
    status = 'Tayyor';
    subtitleSize = subtitleSize || '20.0 MB';
  }

  const isStandalone = Boolean(
    data.isStandalone ||
    data.skipSubtitleInjection ||
    id === 'level-devil' ||
    data.slug === 'level-devil' ||
    !targetFileName ||
    targetFileName === defaultExeName ||
    targetFileName === 'Level Devil.exe'
  );

  const rawSubUrl = data.subtitleDownloadUrl || data.subtitle_download_url;
  const subUrl = rawSubUrl && rawSubUrl.startsWith('http') ? rawSubUrl : undefined;

  return {
    id,
    slug: data.slug || id,
    title: data.title,
    cardImage: card,
    fallbackImage: card,
    cover: cov,
    status,
    version: data.subtitleVersion || data.subtitle_version || data.version || 'v1.0.0',
    keyPrefix,
    developer: data.developer || 'Noma‘lum',
    releaseYear: data.releaseYear || data.release_year || 2026,
    genres: data.genres || ['Sarguzasht'],
    description: data.shortDescription || data.short_description || data.description || '',
    subtitleSize,
    price: data.subtitlePrice || data.subtitle_price || data.price || 'Bepul',
    defaultExeName,
    targetFileName: isStandalone ? undefined : (targetFileName || undefined),
    targetRelativeDir: isStandalone ? undefined : (targetRelativeDir || undefined),
    subtitleDownloadUrl: isStandalone ? undefined : subUrl,
    isStandalone,
    skipSubtitleInjection: isStandalone,
  };
}

/**
 * Fetch games list dynamically from the Django Backend.
 */
export async function fetchLauncherGames(): Promise<LauncherGame[]> {
  const backendGames = await fetchFromBackend<any[]>('api/v1/games/');
  if (backendGames && Array.isArray(backendGames)) {
    console.info(`[Launcher] Loaded ${backendGames.length} games directly from Django REST Backend.`);
    return backendGames.map((g) => mapRawGameToLauncherGame(g));
  }

  console.error('[Launcher] Failed to fetch games from the backend.');
  return [];
}
