import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  query,
  where,
  onSnapshot
} from 'firebase/firestore';
import { db } from '../services/firebase';
import type { GameLicense } from '../types';

export const ADMIN_EMAILS = [
  'azizbekgulomovweb@gmail.com',
  'imuz21029@gmail.com'
];

export interface LauncherUserData {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role?: string;
  isAdmin?: boolean;
}

interface AuthContextType {
  user: LauncherUserData | null;
  isAdmin: boolean;
  loading: boolean;
  cloudLicenses: Record<string, GameLicense>;
  pairingCode: string | null;
  isPairing: boolean;
  startDevicePairing: () => Promise<string>;
  cancelDevicePairing: () => void;
  openPairingInBrowser: (code: string) => void;
  signOut: () => Promise<void>;
  bindDeviceToLicense: (
    gameId: string,
    currentHwid: string,
    deviceName: string
  ) => Promise<{ success: boolean; message?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<LauncherUserData | null>(() => {
    try {
      const saved = localStorage.getItem('subgame_auth_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(false);
  const [cloudLicenses, setCloudLicenses] = useState<Record<string, GameLicense>>({});
  const [userProfile, setUserProfile] = useState<{ role?: string; isAdmin?: boolean } | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const pairingUnsubscribeRef = useRef<(() => void) | null>(null);

  // Sync user profile from Firestore users collection to detect admin role dynamically
  useEffect(() => {
    if (!user?.uid) {
      setUserProfile(null);
      return;
    }

    try {
      const unsubscribeProfile = onSnapshot(
        doc(db, 'users', user.uid),
        (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setUserProfile({
              role: data.role,
              isAdmin: Boolean(data.isAdmin || data.role === 'admin'),
            });
          }
        },
        (err) => {
          console.warn('User profile sync error:', err);
        }
      );

      return () => unsubscribeProfile();
    } catch (e) {
      console.warn('Could not subscribe to user profile:', e);
    }
  }, [user?.uid]);

  const userEmail = (user?.email || '').trim().toLowerCase();
  const isAdmin = Boolean(
    user && (
      ADMIN_EMAILS.some((e) => e.toLowerCase() === userEmail) ||
      user.role === 'admin' ||
      user.isAdmin === true ||
      userProfile?.role === 'admin' ||
      userProfile?.isAdmin === true
    )
  );

  // Real-time Firestore sync of user licenses whenever user changes
  useEffect(() => {
    if (!user) {
      setCloudLicenses({});
      return;
    }

    try {
      const q = query(collection(db, 'licenses'), where('userId', '==', user.uid));
      const unsubscribeLicenses = onSnapshot(
        q,
        (snapshot) => {
          const map: Record<string, GameLicense> = {};
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as GameLicense;
            map[data.gameId] = {
              ...data,
              id: docSnap.id,
            };
          });
          setCloudLicenses(map);
        },
        (error) => {
          console.warn('Licenses sync error:', error);
        }
      );

      return () => unsubscribeLicenses();
    } catch (err) {
      console.warn('Could not subscribe to licenses:', err);
    }
  }, [user]);

  // Clean up pairing listener on unmount
  useEffect(() => {
    return () => {
      pairingUnsubscribeRef.current?.();
    };
  }, []);

  const openPairingInBrowser = (code: string) => {
    const url = `https://sub-game.vercel.app/connect?code=${code}`;
    if (window.subgame?.openExternal) {
      window.subgame.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const startDevicePairing = async (): Promise<string> => {
    pairingUnsubscribeRef.current?.();

    // Generate random 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setPairingCode(code);
    setIsPairing(true);

    try {
      const sessionRef = doc(db, 'device_sessions', code);
      await setDoc(sessionRef, {
        code,
        status: 'pending',
        createdAt: serverTimestamp(),
      });

      // Automatically open browser
      openPairingInBrowser(code);

      // Listen for approval
      const unsubscribe = onSnapshot(sessionRef, (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();

        if (data?.status === 'approved' && data?.userData) {
          const receivedUser: LauncherUserData = data.userData;
          localStorage.setItem('subgame_auth_user', JSON.stringify(receivedUser));
          setUser(receivedUser);
          setIsPairing(false);
          setPairingCode(null);
          unsubscribe();

          // Delete pairing session from Firestore
          deleteDoc(sessionRef).catch(() => {});
        }
      });

      pairingUnsubscribeRef.current = unsubscribe;
      return code;
    } catch (err) {
      console.error('Failed to start device pairing:', err);
      setIsPairing(false);
      setPairingCode(null);
      throw err;
    }
  };

  const cancelDevicePairing = () => {
    pairingUnsubscribeRef.current?.();
    if (pairingCode) {
      deleteDoc(doc(db, 'device_sessions', pairingCode)).catch(() => {});
    }
    setPairingCode(null);
    setIsPairing(false);
  };

  const signOut = async () => {
    localStorage.removeItem('subgame_auth_user');
    setUser(null);
    setCloudLicenses({});
  };

  const bindDeviceToLicense = async (
    gameId: string,
    currentHwid: string,
    deviceName: string
  ): Promise<{ success: boolean; message?: string }> => {
    if (!user) {
      return { success: false, message: 'Iltimos, avval hisobingizga kiring.' };
    }

    const license = cloudLicenses[gameId];
    if (!license) {
      return { success: false, message: 'Ushbu o‘yin uchun litsenziya topilmadi.' };
    }

    // Check if already bound
    if (license.hwid) {
      if (license.hwid === currentHwid) {
        return { success: true };
      } else {
        return {
          success: false,
          message: `Ushbu litsenziya allaqachon boshqa qurilmaga bog‘langan (${license.boundDeviceName || 'Boshqa kompyuter'}). 1 ta litsenziya faqat 1 ta qurilmada amal qiladi!`,
        };
      }
    }

    // Bind this machine's HWID
    try {
      const licenseRef = doc(db, 'licenses', `${user.uid}_${gameId}`);
      await updateDoc(licenseRef, {
        hwid: currentHwid,
        boundDeviceName: deviceName || 'Asosiy PC',
        boundAt: serverTimestamp(),
      });
      return { success: true };
    } catch (err: any) {
      console.warn('Failed to bind HWID to Firestore, falling back to local binding:', err);
      try {
        localStorage.setItem(`subgame_bound_${user.uid}_${gameId}`, currentHwid);
      } catch {}
      return { success: true };
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
        startDevicePairing,
        cancelDevicePairing,
        openPairingInBrowser,
        signOut,
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
