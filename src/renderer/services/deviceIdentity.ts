const IDENTITY_STORAGE_KEY = 'subgame_device_identity';

/**
 * Returns this PC's hardware identity, reusing the first value ever read.
 * UI patches run on top of older main processes whose HWID can change when a slow
 * WMI query times out, so the identity has to be remembered on this side as well.
 */
export async function getStableHardwareInfo(): Promise<any | null> {
  try {
    const saved = JSON.parse(localStorage.getItem(IDENTITY_STORAGE_KEY) || 'null');
    if (saved && /^[A-F0-9]{64}$/.test(saved.hwid)) return saved;
  } catch {
    // A corrupted value is replaced below
  }

  const info = await window.subgame?.getHardwareId();
  if (info?.hwid) {
    localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(info));
  }
  return info || null;
}
