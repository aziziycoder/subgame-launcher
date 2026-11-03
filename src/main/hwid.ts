import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface HardwareInfo {
  hwid: string;
  formattedHwid: string;
  motherboardUuid: string;
  processorId: string;
  biosSerial: string;
}

let cachedHwid: HardwareInfo | null = null;

function runCommand(cmd: string): string {
  try {
    // PowerShell can take many seconds to start on a slow or freshly booted PC.
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
    return output.trim();
  } catch {
    return '';
  }
}

function getIdentityPath(): string {
  const base = app?.getPath('userData') || path.resolve(process.cwd(), '.launcher-data');
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  return path.join(base, 'device-identity.json');
}

function loadSavedIdentity(): HardwareInfo | null {
  try {
    const saved = JSON.parse(fs.readFileSync(getIdentityPath(), 'utf-8'));
    return /^[A-F0-9]{64}$/.test(saved?.hwid) ? saved : null;
  } catch {
    return null;
  }
}

function saveIdentity(info: HardwareInfo): void {
  try {
    fs.writeFileSync(getIdentityPath(), JSON.stringify(info), 'utf-8');
  } catch (err) {
    console.warn('Could not persist device identity:', err);
  }
}

/**
 * Reads Windows hardware attributes to construct a unique, persistent Hardware ID (HWID).
 * The first result is saved and reused: if a later WMI query timed out, a recomputed hash
 * would differ and the user would be locked out of their own license.
 */
export function getHardwareId(): HardwareInfo {
  if (cachedHwid) {
    return cachedHwid;
  }

  const saved = loadSavedIdentity();
  if (saved) {
    cachedHwid = saved;
    return cachedHwid;
  }

  // Fallback chain: PowerShell CIM -> WMIC -> Fallback random/mac
  let mbUuid = runCommand('powershell -NoProfile -Command "(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID"');
  if (!mbUuid || mbUuid.includes('Not Applicable')) {
    mbUuid = runCommand('wmic csproduct get uuid').replace('UUID', '').trim();
  }

  let cpuId = runCommand('powershell -NoProfile -Command "(Get-CimInstance -ClassName Win32_Processor).ProcessorId"');
  if (!cpuId) {
    cpuId = runCommand('wmic cpu get processorid').replace('ProcessorId', '').trim();
  }

  let biosSerial = runCommand('powershell -NoProfile -Command "(Get-CimInstance -ClassName Win32_BIOS).SerialNumber"');
  if (!biosSerial) {
    biosSerial = runCommand('wmic bios get serialnumber').replace('SerialNumber', '').trim();
  }

  // Combine into deterministic raw string. When nothing could be read, a random value keeps
  // such PCs from all sharing one hash; it is saved below, so it stays stable on this machine.
  const nothingRead = !mbUuid && !cpuId && !biosSerial;
  const rawData = nothingRead
    ? `SUBGAME_DRM_V1:RANDOM:${crypto.randomUUID()}`
    : `SUBGAME_DRM_V1:${mbUuid || 'UNKNOWN_MB'}:${cpuId || 'UNKNOWN_CPU'}:${biosSerial || 'UNKNOWN_BIOS'}`;
  const sha256 = crypto.createHash('sha256').update(rawData).digest('hex').toUpperCase();

  // Format as friendly blocks: SG-XXXX-XXXX-XXXX-XXXX
  const formatted = `SG-${sha256.substring(0, 4)}-${sha256.substring(4, 8)}-${sha256.substring(8, 12)}-${sha256.substring(12, 16)}`;

  cachedHwid = {
    hwid: sha256,
    formattedHwid: formatted,
    motherboardUuid: mbUuid || 'N/A',
    processorId: cpuId || 'N/A',
    biosSerial: biosSerial || 'N/A',
  };

  saveIdentity(cachedHwid);

  return cachedHwid;
}
