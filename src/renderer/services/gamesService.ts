import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import type { LauncherGame } from '../data/launcherGames';

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
export async function fetchLauncherGames(): Promise<LauncherGame[]> {
  try {
    const gamesRef = collection(db, GAMES_COLLECTION);
    const q = query(gamesRef, orderBy('releaseYear', 'desc'));
    const snapshot = await getDocs(q);

    const dynamicGames: LauncherGame[] = [];

    if (!snapshot.empty) {
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const card = toAbsoluteUrl(data.cardImage || data.cover);
        const cov = toAbsoluteUrl(data.cover || data.cardImage);
        const id = docSnap.id || data.slug;

        let targetFileName = data.targetFileName;
        let targetRelativeDir = data.targetRelativeDir;
        let defaultExeName = data.defaultExeName || 'Game.exe';
        let keyPrefix = data.keyPrefix || 'SUB-GAME';
        let status = data.subtitleStatus || data.status || 'Tayyor';
        let subtitleSize = data.subtitleSize || '1.5 MB';

        // Mafia: Definitive Edition maxsus sozlamalari
        if (id === 'mafia-definitive-edition' || data.slug === 'mafia-definitive-edition') {
          targetFileName = data.targetFileName || 'stringtable_en.sds';
          targetRelativeDir = (data.targetRelativeDir || 'sds_retail/string_tables').replace(/[\\/]+$/, '');
          defaultExeName = data.defaultExeName || 'mafiadefinitiveedition.exe';
          keyPrefix = 'SUB-MAFI';
          status = 'Tayyor';
          subtitleSize = data.subtitleSize || '1.6 MB';
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

        const subUrl = data.subtitleDownloadUrl && data.subtitleDownloadUrl.startsWith('http')
          ? data.subtitleDownloadUrl
          : undefined;

        dynamicGames.push({
          id,
          slug: data.slug || docSnap.id,
          title: data.title,
          cardImage: card,
          fallbackImage: card,
          cover: cov,
          status,
          version: data.subtitleVersion || data.version || 'v1.0.0',
          keyPrefix,
          developer: data.developer || 'Noma‘lum',
          releaseYear: data.releaseYear || 2026,
          genres: data.genres || ['Sarguzasht'],
          description: data.shortDescription || data.description || '',
          subtitleSize,
          price: data.subtitlePrice || data.price || 'Bepul',
          defaultExeName,
          targetFileName: isStandalone ? undefined : (targetFileName || undefined),
          targetRelativeDir: isStandalone ? undefined : (targetRelativeDir || undefined),
          subtitleDownloadUrl: isStandalone ? undefined : subUrl,
          isStandalone,
          skipSubtitleInjection: isStandalone,
        });
      });
    }

    console.info(`[Launcher] Loaded ${dynamicGames.length} games dynamically from Firestore.`);
    return dynamicGames;
  } catch (error) {
    console.error('[Launcher] Failed to fetch dynamic games from Firestore:', error);
    return [];
  }
}
