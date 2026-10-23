import { execSync } from 'child_process';
import crypto from 'crypto';

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
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 });
    return output.trim();
  } catch {
    return '';
  }
}

/**
 * Reads Windows hardware attributes to construct a unique, persistent Hardware ID (HWID).
 */
export function getHardwareId(): HardwareInfo {
  if (cachedHwid) {
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

  // Combine into deterministic raw string
  const rawData = `SUBGAME_DRM_V1:${mbUuid || 'UNKNOWN_MB'}:${cpuId || 'UNKNOWN_CPU'}:${biosSerial || 'UNKNOWN_BIOS'}`;
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

  return cachedHwid;
}
