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
  }) => Promise<{ success: boolean; message: string }>;
  installSubtitle: (config: {
    gameId: string;
    gameExePath: string;
    targetSubtitleFileName?: string;
    targetRelativeDir?: string;
    subtitleDownloadUrl?: string;
    isAuthorized?: boolean;
    skipSubtitleInjection?: boolean;
  }) => Promise<{ success: boolean; message: string; targetPath?: string }>;
  openGameFolder: (exePath: string) => Promise<boolean>;
  onStatusUpdate: (callback: (status: string) => void) => () => void;
  windowControl: (action: 'minimize' | 'maximize' | 'close') => void;
  openExternal: (url: string) => void;
}

declare global {
  interface Window {
    subgame?: SubGameApi;
  }
}
