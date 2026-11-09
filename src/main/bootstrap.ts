/**
 * Launcherning kirish nuqtasi.
 *
 * userData/update/dist ichida imzolangan patch bo'lsa va u exe ichidagi versiyadan yangiroq bo'lsa,
 * main process kodini (electron/main, electron/preload) o'sha patchdan yuklaydi, aks holda exe
 * ichidagisini. Shu tufayli main process tuzatishlari ~96 MB exe o'rniga kichik zip bilan yetib boradi.
 *
 * Bu faylning o'zi faqat to'liq (exe) yangilanish bilan o'zgaradi.
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { verifyPatchDir, compareSemver, blockPatchVersion } from './patchVerify';

// Patch bilan ketma-ket shuncha marta oyna ochilmasa, patch buzuq deb hisoblanadi.
const MAX_UNCONFIRMED_BOOTS = 2;

declare global {
  // eslint-disable-next-line no-var
  var __subgameConfirmBoot: (() => void) | undefined;
}

function patchesEnabled(): boolean {
  if (app.isPackaged) return true;
  // Dev rejimida faqat sinov uchun, alohida userData bilan (haqiqiy launcher ma'lumotlariga tegmaslik uchun)
  if (process.env.SUBGAME_DEV_PATCHES === '1' && process.env.SUBGAME_USERDATA) {
    app.setPath('userData', process.env.SUBGAME_USERDATA);
    return true;
  }
  return false;
}

/** Patchdagi main kodni yuklasa true qaytaradi. */
function loadPatchedMain(): boolean {
  const userData = app.getPath('userData');
  const updateDir = path.join(userData, 'update');
  const distDir = path.join(updateDir, 'dist');
  const versionFile = path.join(distDir, 'version.json');
  if (!fs.existsSync(versionFile)) return false;

  let version = '';
  try {
    version = String(JSON.parse(fs.readFileSync(versionFile, 'utf8'))?.version || '');
  } catch {}

  const drop = (reason: string, block: boolean) => {
    console.warn(`[Bootstrap] Patch ${version || '?'} ishlatilmaydi: ${reason}`);
    if (block) blockPatchVersion(userData, version);
    try {
      fs.rmSync(updateDir, { recursive: true, force: true });
    } catch {}
  };

  // exe ichidagi versiyadan yangi bo'lmagan patch eskirgan (to'liq yangilanishdan qolgan)
  if (!version || compareSemver(version, app.getVersion()) <= 0) {
    drop('eskirgan', false);
    return false;
  }

  try {
    verifyPatchDir(distDir);
  } catch (err: any) {
    drop(err?.message || 'tekshiruvdan o\'tmadi', true);
    return false;
  }

  const patchedMain = path.join(distDir, 'electron', 'main', 'main.js');
  if (!fs.existsSync(patchedMain)) return false; // faqat interfeys patchi: main exe ichidagisi

  const marker = path.join(updateDir, 'boot-pending');
  let strikes = 0;
  try {
    strikes = parseInt(fs.readFileSync(marker, 'utf8'), 10) || 0;
  } catch {}
  if (strikes >= MAX_UNCONFIRMED_BOOTS) {
    drop('oldingi ishga tushirishlarda oyna ochilmadi', true);
    return false;
  }
  fs.writeFileSync(marker, String(strikes + 1));
  globalThis.__subgameConfirmBoot = () => {
    try {
      fs.unlinkSync(marker);
    } catch {}
  };

  try {
    require(patchedMain);
  } catch (err: any) {
    // Patch qisman ishga tushgan bo'lishi mumkin (IPC handlerlar ro'yxatdan o'tgan), shuning uchun
    // exe ichidagi kodni shu jarayonda yuklamaymiz: patchni o'chirib, launcherni qayta ochamiz.
    drop(`yuklashda xato: ${err?.message || err}`, true);
    app.relaunch();
    app.exit(0);
  }
  return true;
}

if (!(patchesEnabled() && loadPatchedMain())) {
  require('./main.js');
}
