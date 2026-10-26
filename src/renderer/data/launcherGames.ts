export interface LauncherGame {
  id: string;
  slug: string;
  title: string;
  cardImage: string;
  cover: string;
  fallbackImage?: string;
  status: 'Tayyor' | 'Jarayonda' | 'Tez kunda';
  version: string;
  keyPrefix: string;
  developer: string;
  releaseYear: number;
  genres: string[];
  description: string;
  subtitleSize: string;
  price?: string;
  defaultExeName: string;
  targetFileName?: string;
  targetRelativeDir?: string;
  subtitleDownloadUrl?: string;
  isStandalone?: boolean;
  skipSubtitleInjection?: boolean;
}

/**
 * Barcha o‘yinlar to‘g‘ridan-to‘g‘ri Firebase Firestore bazasidan yuklanadi.
 * Kod ichidagi statik massiv to‘liq olib tashlangan.
 */
export const LAUNCHER_GAMES: LauncherGame[] = [];
