import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { LAUNCHER_GAMES, LauncherGame } from '../data/launcherGames';

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
 * Fetch games list dynamically from Firestore for the Launcher.
 * If network fails or collection is empty, seamlessly falls back to LAUNCHER_GAMES.
 */
export async function fetchLauncherGames(): Promise<LauncherGame[]> {
  try {
    const gamesRef = collection(db, GAMES_COLLECTION);
    const q = query(gamesRef, orderBy('releaseYear', 'desc'));
    const snapshot = await getDocs(q);

    const dynamicGames: LauncherGame[] = [];
    const seenIds = new Set<string>();

    if (!snapshot.empty) {
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const card = toAbsoluteUrl(data.cardImage || data.cover);
        const cov = toAbsoluteUrl(data.cover || data.cardImage);
        const id = docSnap.id || data.slug;
        seenIds.add(id);
        if (data.slug) seenIds.add(data.slug);

        const isStandalone = Boolean(
          data.isStandalone ||
          data.skipSubtitleInjection ||
          id === 'level-devil' ||
          data.slug === 'level-devil' ||
          !data.targetFileName ||
          data.targetFileName === data.defaultExeName ||
          data.targetFileName === 'Level Devil.exe'
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
          status: data.subtitleStatus || data.status || 'Tayyor',
          version: data.subtitleVersion || data.version || 'v1.0.0',
          keyPrefix: data.keyPrefix || 'SUB-GAME',
          developer: data.developer || 'Noma‘lum',
          releaseYear: data.releaseYear || 2026,
          genres: data.genres || ['Sarguzasht'],
          description: data.shortDescription || data.description || '',
          subtitleSize: data.subtitleSize || '1.5 MB',
          price: data.subtitlePrice || data.price || 'Bepul',
          defaultExeName: data.defaultExeName || 'Game.exe',
          targetFileName: isStandalone ? undefined : (data.targetFileName || undefined),
          targetRelativeDir: isStandalone ? undefined : (data.targetRelativeDir || undefined),
          subtitleDownloadUrl: isStandalone ? undefined : subUrl,
          isStandalone,
          skipSubtitleInjection: isStandalone,
        });
      });
    }

    // Merge: Include any static fallback games that are not in Firestore yet
    for (const localGame of LAUNCHER_GAMES) {
      if (!seenIds.has(localGame.id) && !seenIds.has(localGame.slug)) {
        dynamicGames.push({
          ...localGame,
          cardImage: toAbsoluteUrl(localGame.cardImage),
          cover: toAbsoluteUrl(localGame.cover),
          fallbackImage: toAbsoluteUrl(localGame.fallbackImage || localGame.cardImage)
        });
        seenIds.add(localGame.id);
        if (localGame.slug) seenIds.add(localGame.slug);
      }
    }

    // Sort by releaseYear desc
    dynamicGames.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0));

    console.info(`[Launcher] Loaded ${dynamicGames.length} games (Firestore + Built-in).`);
    return dynamicGames;
  } catch (error) {
    console.warn('[Launcher] Failed to fetch dynamic games from Firestore, using offline fallback:', error);
    return LAUNCHER_GAMES.map(g => ({
      ...g,
      cardImage: toAbsoluteUrl(g.cardImage),
      cover: toAbsoluteUrl(g.cover),
      fallbackImage: toAbsoluteUrl(g.fallbackImage || g.cardImage)
    }));
  }
}
