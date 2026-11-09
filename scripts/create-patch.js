/**
 * Kichik launcher yangilanishi (update-bundle.zip) yasaydi: interfeys (dist) + main va preload kodi
 * (dist-electron -> electron/), hammasi manifest.json da sha256 bilan ro'yxatlanadi va manifest
 * ed25519 kalit bilan imzolanadi. Launcher (1.4.1+) imzosiz yoki o'zgartirilgan patchni o'rnatmaydi.
 *
 * Ishlatish: npm run patch   (avval `npm run build` qiladi)
 *
 * Yopiq kalit: SUBGAME_PATCH_KEY muhit o'zgaruvchisidagi yo'l yoki %USERPROFILE%\.subgame\launcher-patch-key.pem
 * Uni yo'qotsangiz yangi kalit bilan faqat to'liq exe yangilanish chiqarish mumkin bo'ladi.
 *
 * Bu skript patchni Game-sub/public/downloads ga ko'chiradi va version.json ni yangilaydi.
 * Patch faqat interfeys va main/preload JS ni almashtiradi: Electron, native modul, bootstrap.ts
 * yoki package.json "build" o'zgarsa, to'liq exe chiqarish kerak (npm run dist:win).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// main kodni patchdan yuklay oladigan birinchi exe versiyasi
const PATCH_BASE_VERSION = '1.4.1';

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
console.log(`[Patch] SubGame Launcher v${version} uchun patch yasalmoqda...`);

const keyPath = process.env.SUBGAME_PATCH_KEY || path.join(os.homedir(), '.subgame', 'launcher-patch-key.pem');
if (!fs.existsSync(keyPath)) {
  console.error(`[Patch] Imzolash kaliti topilmadi: ${keyPath}`);
  process.exit(1);
}
const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));

const releaseDir = path.join(root, 'release');
const staging = path.join(releaseDir, 'patch-staging');
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

// 1. Interfeys (avvalgi patchlardagi to'plam bilan bir xil)
copy(path.join(root, 'dist', 'index.html'), path.join(staging, 'index.html'));
copy(path.join(root, 'dist', 'assets'), path.join(staging, 'assets'));
copy(path.join(root, 'dist', 'images', 'logo_doppi.png'), path.join(staging, 'images', 'logo_doppi.png'));
fs.writeFileSync(path.join(staging, 'version.json'), JSON.stringify({ version }, null, 2));

// 2. Main va preload kodi (bootstrap exe ichida qoladi, uni patch almashtirmaydi)
for (const sub of ['main', 'preload']) {
  const srcDir = path.join(root, 'dist-electron', sub);
  for (const f of fs.readdirSync(srcDir)) {
    if (!f.endsWith('.js') || f === 'bootstrap.js') continue;
    copy(path.join(srcDir, f), path.join(staging, 'electron', sub, f));
  }
}

// 3. Manifest va imzo
function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}
const files = {};
for (const rel of listFiles(staging).sort()) {
  files[rel] = crypto.createHash('sha256').update(fs.readFileSync(path.join(staging, rel))).digest('hex');
}
const manifestBuf = Buffer.from(JSON.stringify({ version, files }, null, 2));
fs.writeFileSync(path.join(staging, 'manifest.json'), manifestBuf);
fs.writeFileSync(path.join(staging, 'manifest.sig'), crypto.sign(null, manifestBuf, privateKey).toString('base64'));
console.log(`[Patch] ${Object.keys(files).length} ta fayl imzolandi.`);

// 4. Zip (ichida / ajratgichli yo'llar bilan)
const zipPath = path.join(releaseDir, 'update-bundle.zip');
fs.rmSync(zipPath, { force: true });
// Windows'ning o'z tar.exe si (bsdtar) zip yoza oladi; PATH dagi Git Bash tar'i yoza olmaydi
const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(winTar, ['-a', '-cf', zipPath, '-C', staging, ...fs.readdirSync(staging)]);
const sizeKb = Math.round(fs.statSync(zipPath).size / 1024);
console.log(`[Patch] Tayyor: ${zipPath} (${sizeKb} KB)`);

// 5. Saytga joylash (SUBGAME_PATCH_NO_PUBLISH=1 bo'lsa, faqat zip yasaladi)
const webDownloadsDir = path.join(root, '..', 'Game-sub', 'public', 'downloads');
if (process.env.SUBGAME_PATCH_NO_PUBLISH !== '1' && fs.existsSync(webDownloadsDir)) {
  fs.copyFileSync(zipPath, path.join(webDownloadsDir, 'update-bundle.zip'));
  const versionJsonPath = path.join(webDownloadsDir, 'version.json');
  let vData = {};
  try { vData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8')); } catch {}
  vData.version = version;
  vData.patchUrl = 'https://www.subgame.uz/downloads/update-bundle.zip';
  vData.patchSize = `${sizeKb} KB`;
  vData.patchBaseVersion = PATCH_BASE_VERSION;
  vData.downloadUrl = vData.downloadUrl || 'https://www.subgame.uz/downloads/SubGame-Launcher.exe';
  vData.releaseDate = new Date().toISOString().split('T')[0];
  fs.writeFileSync(versionJsonPath, JSON.stringify(vData, null, 2) + '\n');
  console.log('[Patch] Game-sub/public/downloads ga joylandi. version.json dagi changelog ni yangilashni unutmang.');
}
