import React from 'react';
import { DownloadCloud } from 'lucide-react';

const DOWNLOAD_URL = 'https://www.subgame.uz/downloads/SubGame-Launcher.exe';

/**
 * Bu interfeys patch orqali 1.4.0 yoki undan eski launcherga tushgan bo'lsa (ularda getUpdateInfo yo'q),
 * ularning exe'si o'zini to'g'ri yangilay olmaydi. Foydalanuvchiga yangi launcherni bir marta saytdan
 * yuklab olishni aytamiz.
 */
export function isLegacyLauncher(): boolean {
  return Boolean(window.subgame) && typeof window.subgame?.getUpdateInfo !== 'function';
}

export const LegacyLauncherNotice: React.FC = () => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
    <div className="w-full max-w-md bg-[#141821] border border-[#2A3245] rounded-2xl shadow-2xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#A3E635]/15 border border-[#A3E635]/30 text-[#A3E635]">
          <DownloadCloud className="w-5 h-5" />
        </div>
        <h3 className="text-base font-bold text-white">Yangi launcherni yuklab oling</h3>
      </div>
      <p className="text-sm text-gray-300 leading-relaxed">
        Sizdagi launcher fayli eskirgan va o'zini avtomatik yangilay olmaydi. Yangi launcherni bir marta
        saytdan yuklab oling va bundan keyin shu fayldan foydalaning. Keyingi yangilanishlar avtomatik bo'ladi.
      </p>
      <p className="text-xs text-gray-400">Litsenziyalaringiz va o'yinlaringiz saqlanib qoladi. Eski launcher faylini o'chirib tashlashingiz mumkin.</p>
      <button
        onClick={() => window.subgame?.openExternal(DOWNLOAD_URL)}
        className="w-full py-3 rounded-xl bg-[#A3E635] text-[#0B0D12] font-extrabold hover:bg-[#84CC16] transition-colors"
      >
        Yangi launcherni yuklab olish
      </button>
    </div>
  </div>
);
