import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import type { LauncherGame } from '../data/launcherGames';
import { fetchFromBackend } from './apiClient';

const GAMES_COLLECTION = 'games';

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
 * Fetch games list purely and dynamically from Firestore for the Launcher.
 * 100% dynamic from the central database, no static array fallback.
 */
function mapRawGameToLauncherGame(data: any, fallbackId?: string): LauncherGame {
  const card = toAbsoluteUrl(data.cardImage || data.card_image || data.cover);
  const cov = toAbsoluteUrl(data.cover || data.cardImage || data.card_image);
  const id = data.id || data.slug || fallbackId || 'game';

  let targetFileName = data.targetFileName || data.target_file_name;
  let targetRelativeDir = data.targetRelativeDir || data.target_relative_dir;
  let defaultExeName = data.defaultExeName || data.default_exe_name || 'Game.exe';
  let keyPrefix = data.keyPrefix || data.key_prefix || 'SUB-GAME';
  let status = data.subtitleStatus || data.subtitle_status || data.status || 'Tayyor';
  let subtitleSize = data.subtitleSize || data.subtitle_size || '1.5 MB';

  if (id === 'mafia-definitive-edition' || data.slug === 'mafia-definitive-edition') {
    targetFileName = targetFileName || 'stringtable_en.sds';
    targetRelativeDir = (targetRelativeDir || 'sds_retail/string_tables').replace(/[\\/]+$/, '');
    defaultExeName = defaultExeName || 'mafiadefinitiveedition.exe';
    keyPrefix = 'SUB-MAFI';
    status = 'Tayyor';
    subtitleSize = subtitleSize || '1.6 MB';
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
 * Fetch games list dynamically from Django Backend first, then fallback to Firestore.
 */
export async function fetchLauncherGames(): Promise<LauncherGame[]> {
  // 1. Try local Django REST backend first
  try {
    const backendGames = await fetchFromBackend<any[]>('api/v1/games/');
    if (backendGames && Array.isArray(backendGames) && backendGames.length > 0) {
      console.info(`[Launcher] Loaded ${backendGames.length} games directly from Django REST Backend.`);
      return backendGames.map((g) => mapRawGameToLauncherGame(g));
    }
  } catch (backendErr) {
    console.warn('[Launcher] Django backend unavailable, checking Firestore fallback:', backendErr);
  }

  // 2. Fallback to Firestore
  try {
    const gamesRef = collection(db, GAMES_COLLECTION);
    const q = query(gamesRef, orderBy('releaseYear', 'desc'));
    const snapshot = await getDocs(q);

    const dynamicGames: LauncherGame[] = [];

    if (!snapshot.empty) {
      snapshot.forEach((docSnap) => {
        dynamicGames.push(mapRawGameToLauncherGame(docSnap.data(), docSnap.id));
      });
    }

    console.info(`[Launcher] Loaded ${dynamicGames.length} games dynamically from Firestore.`);
    return dynamicGames;
  } catch (error) {
    console.error('[Launcher] Failed to fetch dynamic games from Firestore:', error);
    return [];
  }
}
