import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const APP_MASTER_KEY = 'SUBGAME_ASSET_PROTECTION_2026_MASTER_SECRET_KEY';
export const APP_MASTER_HWID = 'SUBGAME_SYSTEM_HWID_BINDING';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;

/**
 * Derives a 256-bit key using PBKDF2 from a master secret and the machine HWID
 */
export function deriveKey(licenseKey: string = APP_MASTER_KEY, hwid: string = APP_MASTER_HWID, salt: Buffer): Buffer {
  const secret = `${licenseKey}::SUBGAME_PROTECTION::${hwid}`;
  return crypto.pbkdf2Sync(secret, salt, 100000, 32, 'sha256');
}

/**
 * Encrypts a buffer or file content
 */
export function encryptData(data: Buffer, licenseKey: string = APP_MASTER_KEY, hwid: string = APP_MASTER_HWID): Buffer {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(licenseKey, hwid, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  // File structure: [SALT (16)] + [IV (12)] + [TAG (16)] + [CIPHERTEXT]
  return Buffer.concat([salt, iv, tag, encrypted]);
}

/**
 * Decrypts a previously encrypted buffer
 */
export function decryptData(encryptedBuffer: Buffer, licenseKey: string = APP_MASTER_KEY, hwid: string = APP_MASTER_HWID): Buffer {
  if (encryptedBuffer.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Noto\'g\'ri shifrlangan fayl formati');
  }

  const salt = encryptedBuffer.subarray(0, SALT_LENGTH);
  const iv = encryptedBuffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = encryptedBuffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encryptedBuffer.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(licenseKey, hwid, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypts a source file (e.g. tt01.pc) to a target encrypted file (.enc)
 */
export function encryptFile(srcPath: string, destPath: string, licenseKey: string = APP_MASTER_KEY, hwid: string = APP_MASTER_HWID): void {
  const fileData = fs.readFileSync(srcPath);
  const encrypted = encryptData(fileData, licenseKey, hwid);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, encrypted);
}

/**
 * Decrypts an encrypted file to memory or temporary destination
 */
export function decryptFile(srcPath: string, destPath: string, licenseKey: string = APP_MASTER_KEY, hwid: string = APP_MASTER_HWID): void {
  const encryptedData = fs.readFileSync(srcPath);
  const decrypted = decryptData(encryptedData, licenseKey, hwid);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, decrypted);
}
