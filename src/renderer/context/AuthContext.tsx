import React, { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import type { GameLicense } from '../types';
import { ApiError, apiRequest, clearTokens, getAccessToken, setTokens } from '../services/apiClient';

const PAIRING_POLL_INTERVAL_MS = 2500;
const USER_STORAGE_KEY = 'subgame_auth_user';
const LICENSES_STORAGE_KEY = 'subgame_cached_licenses';

export interface LauncherUserData {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role?: string;
  isAdmin?: boolean;
}

export interface BindDeviceResult {
  success: boolean;
  message?: string;
  isBoundToAnotherDevice?: boolean;
  boundDeviceName?: string;
  /** The server could not be reached, so nothing is known about the binding. */
  offline?: boolean;
}

interface AuthContextType {
  user: LauncherUserData | null;
  isAdmin: boolean;
  loading: boolean;
  cloudLicenses: Record<string, GameLicense>;
  pairingCode: string | null;
  isPairing: boolean;
  pairingError: string | null;
  startDevicePairing: () => Promise<string>;
  cancelDevicePairing: () => void;
  openPairingInBrowser: (code: string) => void;
  signOut: () => Promise<void>;
  refreshLicenses: () => Promise<Record<string, GameLicense> | null>;
  bindDeviceToLicense: (
    gameId: string,
    currentHwid: string,
    deviceName: string
  ) => Promise<BindDeviceResult>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toLauncherUser(raw: any): LauncherUserData {
  return {
    uid: raw.uid || raw.id,
    email: raw.email ?? null,
    displayName: raw.displayName ?? null,
    photoURL: raw.photoURL ?? null,
    role: raw.role,
    isAdmin: Boolean(raw.isAdmin),
  };
}

function readCachedLicenses(): Record<string, GameLicense> {
  try {
    return JSON.parse(localStorage.getItem(LICENSES_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<LauncherUserData | null>(() => {
    // Sessions from before the backend migration have no JWT and must pair again.
    if (!getAccessToken()) return null;
    try {
      const saved = localStorage.getItem(USER_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [loading] = useState(false);
  const [cloudLicenses, setCloudLicenses] = useState<Record<string, GameLicense>>(() =>
    user ? readCachedLicenses() : {}
  );
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const pairingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAdmin = Boolean(user && (user.role === 'admin' || user.isAdmin === true));

  const signOut = useCallback(async () => {
    clearTokens();
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(LICENSES_STORAGE_KEY);
    setUser(null);
    setCloudLicenses({});
  }, []);

  const refreshLicenses = useCallback(async (): Promise<Record<string, GameLicense> | null> => {
    try {
      const map = await apiRequest<Record<string, GameLicense>>('api/v1/licenses/my/');
      setCloudLicenses(map);
      localStorage.setItem(LICENSES_STORAGE_KEY, JSON.stringify(map));
      return map;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await signOut();
      }
      return null;
    }
  }, [signOut]);

  // Refresh role and licenses on start, and whenever the user comes back to the launcher
  useEffect(() => {
    if (!user?.uid) return;

    apiRequest('api/v1/auth/me/')
      .then((profile) => {
        const fresh = toLauncherUser(profile);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(fresh));
        setUser(fresh);
      })
      .catch((err) => console.warn('User profile sync error:', err));

    refreshLicenses();

    const onFocus = () => {
      refreshLicenses();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user?.uid, refreshLicenses]);

  const stopPairingPoll = () => {
    if (pairingTimerRef.current) {
      clearInterval(pairingTimerRef.current);
      pairingTimerRef.current = null;
    }
  };

  // Clean up pairing poll on unmount
  useEffect(() => stopPairingPoll, []);

  const openPairingInBrowser = (code: string) => {
    const url = `https://subgame.uz/connect?code=${code}`;
    if (window.subgame?.openExternal) {
      window.subgame.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const startDevicePairing = async (): Promise<string> => {
    stopPairingPoll();
    setPairingError(null);
    setIsPairing(true);

    try {
      const session = await apiRequest<{ code: string; pollToken: string }>('api/v1/licenses/device/create/', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setPairingCode(session.code);

      // Automatically open browser
      openPairingInBrowser(session.code);

      pairingTimerRef.current = setInterval(async () => {
        try {
          const res = await apiRequest<{ status: string; user?: any; tokens?: { access: string; refresh: string } }>(
            `api/v1/licenses/device/poll/${session.code}/`,
            { method: 'POST', body: JSON.stringify({ pollToken: session.pollToken }) }
          );

          if (res.status === 'approved' && res.tokens && res.user) {
            stopPairingPoll();
            setTokens(res.tokens.access, res.tokens.refresh);
            const receivedUser = toLauncherUser(res.user);
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(receivedUser));
            setUser(receivedUser);
            setIsPairing(false);
            setPairingCode(null);
          } else if (res.status !== 'pending') {
            stopPairingPoll();
            setIsPairing(false);
            setPairingCode(null);
            setPairingError('Ulanish kodining muddati tugadi. Qaytadan urinib ko‘ring.');
          }
        } catch (err) {
          // A dropped connection is retried on the next tick
          if (err instanceof ApiError && err.status !== 0) {
            stopPairingPoll();
            setIsPairing(false);
            setPairingCode(null);
            setPairingError(err.message);
          }
        }
      }, PAIRING_POLL_INTERVAL_MS);

      return session.code;
    } catch (err: any) {
      console.error('Failed to start device pairing:', err);
      setIsPairing(false);
      setPairingCode(null);
      setPairingError(err?.message || 'Launcherni ulashda xatolik yuz berdi.');
      throw err;
    }
  };

  const cancelDevicePairing = () => {
    stopPairingPoll();
    setPairingCode(null);
    setIsPairing(false);
  };

  const bindDeviceToLicense = async (
    gameId: string,
    currentHwid: string,
    deviceName: string
  ): Promise<BindDeviceResult> => {
    if (!user) {
      return { success: false, message: 'Iltimos, avval hisobingizga kiring.' };
    }

    // The backend is the only authority on which machine owns a license.
    try {
      await apiRequest('api/v1/licenses/bind-hwid/', {
        method: 'POST',
        body: JSON.stringify({
          gameId,
          hwid: currentHwid,
          deviceName: deviceName || 'Asosiy PC',
        }),
      });
      await refreshLicenses();
      return { success: true };
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          await signOut();
          return { success: false, message: 'Sessiya tugagan. Iltimos, qaytadan kiring.' };
        }
        return {
          success: false,
          message: err.message,
          offline: err.status === 0,
          isBoundToAnotherDevice: Boolean(err.data?.isBoundToAnotherDevice),
          boundDeviceName: err.data?.boundDeviceName || undefined,
        };
      }
      return { success: false, message: 'Litsenziyani tekshirishda xatolik yuz berdi.' };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin,
        loading,
        cloudLicenses,
        pairingCode,
        isPairing,
        pairingError,
        startDevicePairing,
        cancelDevicePairing,
        openPairingInBrowser,
        signOut,
        refreshLicenses,
        bindDeviceToLicense,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
