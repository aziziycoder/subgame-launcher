import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Launcher patchlarini imzolovchi kalitning ochiq qismi (ed25519, SPKI DER, base64).
 * Yopiq kalit repoda saqlanmaydi: %USERPROFILE%\.subgame\launcher-patch-key.pem
 * (scripts/create-patch.js shu bilan imzolaydi).
 */
const PATCH_PUBLIC_KEY = 'MCowBQYDK2VwAyEAdimS/cM9vECTmJi/nZ3ZyI2BQoaS4c0DTCtWwXPrss4=';

export interface PatchManifest {
  version: string;
  files: Record<string, string>; // patch papkasiga nisbatan yo'l -> sha256 (hex)
}

export function compareSemver(a: string, b: string): number {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

function listFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/**
 * Patch papkasini tekshiradi: manifest.json imzosi ochiq kalitga mos kelishi, ro'yxatdagi har bir
 * faylning sha256 si to'g'ri bo'lishi va electron/ ichida ro'yxatda yo'q fayl bo'lmasligi kerak.
 * Mos kelmasa sababini aytib xato tashlaydi.
 */
export function verifyPatchDir(dir: string): PatchManifest {
  const manifestPath = path.join(dir, 'manifest.json');
  const sigPath = path.join(dir, 'manifest.sig');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(sigPath)) {
    throw new Error('patch is not signed');
  }
  const manifestBuf = fs.readFileSync(manifestPath);
  const signature = Buffer.from(fs.readFileSync(sigPath, 'utf8').trim(), 'base64');
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(PATCH_PUBLIC_KEY, 'base64'),
    format: 'der',
    type: 'spki',
  });
  if (!crypto.verify(null, manifestBuf, publicKey, signature)) {
    throw new Error('bad patch signature');
  }

  const manifest = JSON.parse(manifestBuf.toString('utf8')) as PatchManifest;
  if (!manifest || typeof manifest.version !== 'string' || !manifest.files) {
    throw new Error('bad patch manifest');
  }

  const root = path.resolve(dir);
  for (const [rel, hash] of Object.entries(manifest.files)) {
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep)) throw new Error(`bad path in manifest: ${rel}`);
    if (!fs.existsSync(full)) throw new Error(`missing patch file: ${rel}`);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    if (actual !== hash) throw new Error(`patch file changed: ${rel}`);
  }

  for (const rel of listFiles(path.join(root, 'electron'), root)) {
    if (!(rel in manifest.files)) throw new Error(`unlisted patch file: ${rel}`);
  }

  const versionFile = path.join(root, 'version.json');
  const declared = fs.existsSync(versionFile) ? JSON.parse(fs.readFileSync(versionFile, 'utf8'))?.version : null;
  if (declared !== manifest.version) throw new Error('patch version mismatch');

  return manifest;
}

/** Ishlamay qolgan patch versiyalari: launcher ularni qayta o'rnatmaydi, to'liq yangilanishni oladi. */
export function readBlockedPatchVersions(userData: string): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(userData, 'patch-blocklist.json'), 'utf8'));
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

export function blockPatchVersion(userData: string, version: string): void {
  if (!version) return;
  const list = readBlockedPatchVersions(userData);
  if (list.includes(version)) return;
  list.push(version);
  try {
    fs.writeFileSync(path.join(userData, 'patch-blocklist.json'), JSON.stringify(list));
  } catch {}
}
