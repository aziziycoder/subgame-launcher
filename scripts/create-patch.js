const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 1. Read package.json version
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
console.log(`[Patch] Creating delta patch for SubGame Launcher v${version}...`);

// 2. Ensure dist/version.json exists
const distDir = path.join(__dirname, '..', 'dist');
fs.writeFileSync(path.join(distDir, 'version.json'), JSON.stringify({ version }, null, 2));

// 3. Output zip paths
const releaseDir = path.join(__dirname, '..', 'release');
if (!fs.existsSync(releaseDir)) fs.mkdirSync(releaseDir, { recursive: true });
const zipPath = path.join(releaseDir, 'update-bundle.zip');
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

// 4. Create zip using powershell Compress-Archive
console.log('[Patch] Compressing UI bundle (index.html, assets, logo, version.json)...');
const psCmd = `Compress-Archive -Path dist/index.html, dist/assets, dist/images/logo_doppi.png, dist/version.json -DestinationPath release/update-bundle.zip -Force`;
execSync(`powershell -NoProfile -Command "${psCmd}"`, { cwd: path.join(__dirname, '..') });

const stats = fs.statSync(zipPath);
const sizeKb = (stats.size / 1024).toFixed(0);
const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`[Patch] Bundle created! Size: ${sizeKb} KB (${sizeMb} MB)`);

// 5. Copy to Game-sub public/downloads/update-bundle.zip
const webDownloadsDir = path.join(__dirname, '..', '..', 'Game-sub', 'public', 'downloads');
if (fs.existsSync(webDownloadsDir)) {
  const targetZip = path.join(webDownloadsDir, 'update-bundle.zip');
  fs.copyFileSync(zipPath, targetZip);
  console.log(`[Patch] Copied to ${targetZip}`);

  // 6. Update version.json on website
  const versionJsonPath = path.join(webDownloadsDir, 'version.json');
  let vData = {};
  if (fs.existsSync(versionJsonPath)) {
    try { vData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8')); } catch {}
  }
  vData.version = version;
  vData.patchUrl = 'https://www.subgame.uz/downloads/update-bundle.zip';
  vData.patchSize = `${sizeKb} KB`;
  vData.downloadUrl = vData.downloadUrl || 'https://www.subgame.uz/downloads/SubGame-Launcher.exe';
  vData.releaseDate = new Date().toISOString().split('T')[0];
  fs.writeFileSync(versionJsonPath, JSON.stringify(vData, null, 2));
  console.log(`[Patch] Updated website version.json for v${version}`);
}

console.log('[Patch] Done!');
