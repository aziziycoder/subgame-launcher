import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import crypto from 'crypto';
import { getHardwareId } from './hwid';

export interface LicenseEntry {
  gameId: string;
  gameTitle: string;
  licenseKey: string;
  hwid: string;
  activatedAt: string;
  status: 'active' | 'revoked' | 'expired';
}

interface LicenseStore {
  version: number;
  hwid: string;
  signature: string;
  licenses: Record<string, LicenseEntry>; // gameId -> LicenseEntry
}

const MASTER_SIGNING_SALT = 'SUBGAME_2026_PRODUCTION_SECRET_KEY';

function getStoragePath(): string {
  const base = app?.getPath('userData') || path.resolve(process.cwd(), '.launcher-data');
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  return path.join(base, 'licenses.v1.dat');
}

function computeSignature(licenses: Record<string, LicenseEntry>, hwid: string): string {
  const content = JSON.stringify(licenses) + '::' + hwid + '::' + MASTER_SIGNING_SALT;
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function loadLicenseStore(): LicenseStore {
  const filePath = getStoragePath();
  const currentHwid = getHardwareId().hwid;

  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      hwid: currentHwid,
      signature: computeSignature({}, currentHwid),
      licenses: {},
    };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed: LicenseStore = JSON.parse(raw);

    // Anti-tamper check: If someone copied this licenses file from another PC:
    if (parsed.hwid !== currentHwid) {
      console.warn('Litsenziya fayli boshqa kompyuterdan ko\'chirilgan! Bloklandi.');
      return {
        version: 1,
        hwid: currentHwid,
        signature: computeSignature({}, currentHwid),
        licenses: {},
      };
    }

    // Verify cryptographic signature to ensure file wasn't edited manually with Notepad
    const expectedSig = computeSignature(parsed.licenses, currentHwid);
    if (parsed.signature !== expectedSig) {
      console.warn('Litsenziya fayli tahrirlangan (tampered)! Bloklandi.');
      return {
        version: 1,
        hwid: currentHwid,
        signature: computeSignature({}, currentHwid),
        licenses: {},
      };
    }

    return parsed;
  } catch (e) {
    console.error('Litsenziya faylini o\'qishda xatolik:', e);
    return {
      version: 1,
      hwid: currentHwid,
      signature: computeSignature({}, currentHwid),
      licenses: {},
    };
  }
}

export function saveLicenseStore(store: LicenseStore): void {
  const filePath = getStoragePath();
  store.hwid = getHardwareId().hwid;
  store.signature = computeSignature(store.licenses, store.hwid);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Validates a license key format and checks eligibility
 */
export function validateKeyFormat(key: string): { valid: boolean; gameId?: string; error?: string } {
  const cleanKey = key.trim().toUpperCase();
  // Standard format: SUB-{GAME_PREFIX}-{4 CHARS}-{4 CHARS}
  // e.g. SUB-INNO-7842-AB12, SUB-REQU-9912-XX44, SUB-OUTW-1234-ABCD, SUB-DEMO-0001-TEST, SUB-RDR1-XXXX-XXXX
  const regex = /^SUB-(INNO|REQU|OUTW|DEMO|GAME|RDR1|STRA|RE2R|RLPA|MAFI)-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  if (!regex.test(cleanKey)) {
    return { valid: false, error: "Litsenziya kaliti formati noto'g'ri. Namuna: SUB-INNO-8492-XK91" };
  }

  const parts = cleanKey.split('-');
  const prefix = parts[1];
  let gameId = 'a-plague-tale-innocence';
  if (prefix === 'REQU') gameId = 'a-plague-tale-requiem';
  if (prefix === 'OUTW') gameId = 'outward-2';
  if (prefix === 'DEMO') gameId = 'demo-game';
  if (prefix === 'RDR1') gameId = 'red-dead-redemption';
  if (prefix === 'STRA') gameId = 'stray';
  if (prefix === 'RE2R') gameId = 'resident-evil-2-remake';
  if (prefix === 'RLPA') gameId = 'rusty-lake-paradise';
  if (prefix === 'MAFI') gameId = 'mafia-definitive-edition';

  return { valid: true, gameId };
}

/**
 * Activates a license key for this specific PC
 */
export function activateLicense(licenseKey: string, gameTitle: string): { success: boolean; message: string; entry?: LicenseEntry } {
  const check = validateKeyFormat(licenseKey);
  if (!check.valid || !check.gameId) {
    return { success: false, message: check.error || "Noto'g'ri kalit" };
  }

  const hwidInfo = getHardwareId();
  const store = loadLicenseStore();

  const entry: LicenseEntry = {
    gameId: check.gameId,
    gameTitle,
    licenseKey: licenseKey.trim().toUpperCase(),
    hwid: hwidInfo.hwid,
    activatedAt: new Date().toISOString(),
    status: 'active',
  };

  store.licenses[check.gameId] = entry;
  saveLicenseStore(store);

  return {
    success: true,
    message: `${gameTitle} ushbu qurilma (${hwidInfo.formattedHwid}) uchun muvaffaqiyatli faollashtirildi!`,
    entry,
  };
}

/**
 * Check if a game is activated on this device
 */
export function isGameActivated(gameId: string): boolean {
  const store = loadLicenseStore();
  const entry = store.licenses[gameId];
  if (!entry) return false;
  return entry.status === 'active' && entry.hwid === getHardwareId().hwid;
}
