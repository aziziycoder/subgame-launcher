export interface GameLicense {
  id: string; // `${userId}_${gameId}`
  userId: string;
  userEmail: string;
  userName?: string;
  userPhoto?: string;
  gameId: string;
  gameTitle: string;
  gameSlug: string;
  status: 'active' | 'revoked';
  hwid?: string | null; // Bound hardware ID (1 device limit)
  boundAt?: any;
  boundDeviceName?: string;
  createdAt: any;
}

export interface SubGameApi {
  getHardwareId: () => Promise<{
    hwid: string;
    formattedHwid: string;
    motherboardUuid: string;
    processorId: string;
    biosSerial: string;
  }>;
  getLicenses: () => Promise<Record<string, {
    gameId: string;
    gameTitle: string;
    licenseKey: string;
    hwid: string;
    activatedAt: string;
    status: 'active' | 'revoked' | 'expired';
  }>>;
  activateLicense: (key: string, gameTitle: string) => Promise<{
    success: boolean;
    message: string;
    entry?: any;
  }>;
  selectGameExecutable: () => Promise<string | null>;
  launchGame: (config: {
    gameId: string;
    gameExePath: string;
    targetSubtitleFileName?: string;
    targetRelativeDir?: string;
    subtitleDownloadUrl?: string;
    isAuthorized?: boolean;
    skipSubtitleInjection?: boolean;
    subtitleVersion?: string;
  }) => Promise<{ success: boolean; message: string }>;
  installSubtitle: (config: {
    gameId: string;
    gameExePath: string;
    targetSubtitleFileName?: string;
    targetRelativeDir?: string;
    subtitleDownloadUrl?: string;
    isAuthorized?: boolean;
    skipSubtitleInjection?: boolean;
    subtitleVersion?: string;
  }) => Promise<{ success: boolean; message: string; targetPath?: string }>;
  openGameFolder: (exePath: string) => Promise<boolean>;
  /** 1.4.6+: eski main kodda yo'q bo'lishi mumkin */
  getSubtitleRemovalInfo?: (config: SubtitleConfig) => Promise<SubtitleRemovalInfo>;
  removeSubtitle?: (config: SubtitleConfig, options?: { cacheOnly?: boolean }) => Promise<SubtitleRemovalResult>;
  getSubtitleVersion: (gameId: string) => Promise<string | null>;
  checkLocalDubbing?: (gameId: string, exePath: string) => Promise<{ installed: boolean; totalBytes: number }>;
  onStatusUpdate: (callback: (status: any) => void) => () => void;
  windowControl: (action: 'minimize' | 'maximize' | 'close') => void;
  openExternal: (url: string) => void;
  getAppVersion: () => Promise<string>;
  downloadUpdate: (url: string) => Promise<{ success: boolean; tempPath?: string; error?: string }>;
  applyUpdate: (tempPath: string) => Promise<{ success: boolean; error?: string; fallbackToFull?: boolean }>;
  getUpdateInfo?: () => Promise<{ builtinVersion: string; blockedPatchVersions: string[] }>;
  onUpdateProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => () => void;
}

export interface SubtitleConfig {
  gameId: string;
  gameExePath: string;
  targetSubtitleFileName?: string;
  targetRelativeDir?: string;
  subtitleDownloadUrl?: string;
  isAuthorized?: boolean;
  skipSubtitleInjection?: boolean;
  subtitleVersion?: string;
}

export interface SubtitleRemovalInfo {
  success: boolean;
  message?: string;
  cacheBytes: number;
  gameFolderBytes: number;
  totalBytes: number;
  gameFolderItems: number;
  gameFolderFound: boolean;
  gameRunning: boolean;
  filesLocked?: boolean;
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

declare global {
  interface Window {
    subgame?: SubGameApi;
  }
}
