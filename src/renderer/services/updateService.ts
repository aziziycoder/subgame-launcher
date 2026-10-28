import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

export interface AppUpdateInfo {
  version: string;
  downloadUrl: string;
  patchUrl?: string;
  patchSize?: string;
  changelog: string;
  releaseDate?: string;
  minRequiredVersion?: string;
}

/**
 * Compare two semver strings: a and b.
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Checks for launcher update from Firestore (or fallback JSON on subgame.uz)
 */
export async function checkForAppUpdate(): Promise<{
  updateAvailable: boolean;
  isForceUpdate: boolean;
  currentVersion: string;
  latestInfo?: AppUpdateInfo;
}> {
  const currentVersion = (await window.subgame?.getAppVersion()) || '1.0.0';

  // 1. Try Firestore
  try {
    const ref = doc(db, 'appConfig', 'launcher');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as AppUpdateInfo;
      if (data && data.version) {
        const updateAvailable = compareVersions(data.version, currentVersion) > 0;
        const isForceUpdate = Boolean(
          data.minRequiredVersion && compareVersions(data.minRequiredVersion, currentVersion) > 0
        );
        return { updateAvailable, isForceUpdate, currentVersion, latestInfo: data };
      }
    }
  } catch (err) {
    console.warn('[UpdateService] Firestore check failed, checking fallback URL:', err);
  }

  // 2. Fallback to website JSON
  try {
    const res = await fetch(`https://www.subgame.uz/downloads/version.json?t=${Date.now()}`);
    if (res.ok) {
      const data = (await res.json()) as AppUpdateInfo;
      if (data && data.version) {
        const updateAvailable = compareVersions(data.version, currentVersion) > 0;
        const isForceUpdate = Boolean(
          data.minRequiredVersion && compareVersions(data.minRequiredVersion, currentVersion) > 0
        );
        return { updateAvailable, isForceUpdate, currentVersion, latestInfo: data };
      }
    }
  } catch (netErr) {
    console.warn('[UpdateService] Fallback check failed:', netErr);
  }

  return { updateAvailable: false, isForceUpdate: false, currentVersion };
}
