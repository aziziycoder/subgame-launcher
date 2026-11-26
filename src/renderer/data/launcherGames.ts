export interface LauncherSubtitleVariant {
  key: string;
  label: string;
  subtitleVersion: string;
  subtitleSize?: string;
  subtitleDownloadUrl?: string;
  targetFileName: string;
  targetRelativeDir?: string;
  defaultExeName?: string;
  sortOrder?: number;
  detectFilesPresent?: string[];
  detectFilesAbsent?: string[];
  detectFileSizes?: Record<string, number | { exact?: number; min?: number; max?: number; optional?: boolean }>;
}

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
  hasDubbing?: boolean;
  dubbingSize?: string;
  dubbingPrice?: string;
  dubbingVersion?: string;
  dubbingDownloadUrl?: string;
  variants?: LauncherSubtitleVariant[];
}

/**
 * Barcha o‘yinlar to‘g‘ridan-to‘g‘ri backend bazasidan yuklanadi.
 * Kod ichidagi statik massiv to‘liq olib tashlangan.
 */
export const LAUNCHER_GAMES: LauncherGame[] = [];
