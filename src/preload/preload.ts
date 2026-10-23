import { contextBridge, ipcRenderer } from 'electron';

export interface GameLaunchConfigPayload {
  gameId: string;
  gameExePath: string;
  targetSubtitleFileName?: string;
  targetRelativeDir?: string;
  subtitleDownloadUrl?: string;
  isAuthorized?: boolean;
  skipSubtitleInjection?: boolean;
}

export interface SubGameApi {
  getHardwareId: () => Promise<any>;
  getLicenses: () => Promise<any>;
  activateLicense: (key: string, gameTitle: string) => Promise<any>;
  selectGameExecutable: () => Promise<string | null>;
  launchGame: (config: GameLaunchConfigPayload) => Promise<{ success: boolean; message: string }>;
  installSubtitle: (config: GameLaunchConfigPayload) => Promise<{ success: boolean; message: string; targetPath?: string }>;
  openGameFolder: (exePath: string) => Promise<boolean>;
  onStatusUpdate: (callback: (status: string) => void) => () => void;
  windowControl: (action: 'minimize' | 'maximize' | 'close') => void;
  openExternal: (url: string) => void;
  getAppVersion: () => Promise<string>;
  downloadUpdate: (url: string) => Promise<{ success: boolean; tempPath?: string; error?: string }>;
  applyUpdate: (tempPath: string) => Promise<{ success: boolean; error?: string }>;
  onUpdateProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => () => void;
}

const api: SubGameApi = {
  getHardwareId: () => ipcRenderer.invoke('get-hwid'),
  getLicenses: () => ipcRenderer.invoke('get-licenses'),
  activateLicense: (key: string, gameTitle: string) => ipcRenderer.invoke('activate-license', { key, gameTitle }),
  selectGameExecutable: () => ipcRenderer.invoke('select-game-exe'),
  launchGame: (config) => ipcRenderer.invoke('launch-game', config),
  installSubtitle: (config) => ipcRenderer.invoke('install-subtitle', config),
  openGameFolder: (exePath) => ipcRenderer.invoke('open-game-folder', exePath),
  onStatusUpdate: (callback) => {
    const handler = (_: any, status: string) => callback(status);
    ipcRenderer.on('game-status', handler);
    return () => {
      ipcRenderer.removeListener('game-status', handler);
    };
  },
  windowControl: (action) => ipcRenderer.send('window-control', action),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  downloadUpdate: (url: string) => ipcRenderer.invoke('download-update', url),
  applyUpdate: (tempPath: string) => ipcRenderer.invoke('apply-update', tempPath),
  onUpdateProgress: (callback) => {
    const handler = (_: any, progress: any) => callback(progress);
    ipcRenderer.on('update-progress', handler);
    return () => {
      ipcRenderer.removeListener('update-progress', handler);
    };
  },
};

contextBridge.exposeInMainWorld('subgame', api);
