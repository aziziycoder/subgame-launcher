import React, { useState } from 'react';
import { Minus, Square, X, Shield, Copy, Check, Sparkles, RefreshCw, HeartHandshake } from 'lucide-react';

interface TitleBarProps {
  hwidInfo: {
    formattedHwid: string;
    hwid: string;
  } | null;
  currentVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  checkingUpdate?: boolean;
  onCheckUpdate?: () => void;
  onOpenUpdateModal?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  hwidInfo,
  currentVersion = '1.0.0',
  latestVersion,
  updateAvailable = false,
  checkingUpdate = false,
  onCheckUpdate,
  onOpenUpdateModal,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyHwid = () => {
    if (hwidInfo?.formattedHwid) {
      navigator.clipboard.writeText(hwidInfo.formattedHwid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleWindow = (action: 'minimize' | 'maximize' | 'close') => {
    window.subgame?.windowControl(action);
  };

  return (
    <div className="h-12 bg-[#0B0D12] border-b border-[#2A3245] flex items-center justify-between px-4 select-none app-drag-region z-50">
      {/* Brand & Logo */}
      <div className="flex items-center gap-2.5 app-no-drag">
        <img
          src="./images/logo_doppi.png"
          alt="SubGame"
          className="w-7 h-7 object-contain"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-base tracking-wider text-white">
            SUB<span className="text-[#A3E635]">GAME</span>
          </span>
          <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded font-mono font-bold bg-[#A3E635]/15 text-[#A3E635] border border-[#A3E635]/30">
            LAUNCHER
          </span>
        </div>
      </div>

      {/* HWID Device Passport Indicator */}
      {hwidInfo && (
        <div className="hidden sm:flex items-center gap-2 app-no-drag">
          <div
            onClick={handleCopyHwid}
            title="HWID (Kompyuter Pasporti) - Nusxalash uchun bosing"
            className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[#141821] border border-[#2A3245] hover:border-[#A3E635]/60 transition-all cursor-pointer group text-xs text-gray-300"
          >
            <Shield className="w-3.5 h-3.5 text-[#A3E635] group-hover:scale-110 transition-transform" />
            <span className="text-gray-400 font-mono text-[11px]">Qurilma:</span>
            <span className="font-mono font-bold text-[#A3E635] text-[11px]">
              {hwidInfo.formattedHwid}
            </span>
            {copied ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3 text-gray-500 group-hover:text-gray-300" />
            )}
          </div>
        </div>
      )}

      {/* Right Actions: Update Check & Window Controls */}
      <div className="flex items-center gap-2.5 app-no-drag">
        {/* Donate Button */}
        <button
          onClick={() => {
            if (window.subgame?.openExternal) {
              window.subgame.openExternal('https://taps.uz/subgame');
            } else {
              window.open('https://taps.uz/subgame', '_blank');
            }
          }}
          title="Loyihani qo‘llab-quvvatlash (Donat - taps.uz/subgame)"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/35 hover:bg-amber-500/25 text-amber-300 text-[11px] font-bold transition-all cursor-pointer shadow-sm hover:scale-105"
        >
          <HeartHandshake className="w-3.5 h-3.5 text-amber-400" />
          <span>Donat</span>
        </button>

        {/* Version / Update button */}
        {updateAvailable ? (
          <button
            onClick={onOpenUpdateModal}
            title={`Yangi talqin (v${latestVersion}) mavjud! Yangilash uchun bosing.`}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#A3E635]/15 border border-[#A3E635]/40 text-[#A3E635] text-[11px] font-bold hover:bg-[#A3E635]/25 transition-all cursor-pointer animate-pulse"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#A3E635]" />
            <span>Yangi talqin: v{latestVersion}</span>
          </button>
        ) : (
          <button
            onClick={onCheckUpdate}
            disabled={checkingUpdate}
            title="SubGame Launcher versiyasi. Yangilanishlarni tekshirish uchun bosing"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141821] border border-[#2A3245] hover:border-[#A3E635]/40 text-gray-400 hover:text-gray-200 text-[11px] font-mono transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 text-[#A3E635] ${checkingUpdate ? 'animate-spin' : ''}`} />
            <span>v{currentVersion}</span>
          </button>
        )}

        {/* Window Controls */}
        <div className="flex items-center gap-0.5">
        <button
          onClick={() => handleWindow('minimize')}
          className="w-9 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#1A1F2A] transition-colors rounded"
          title="Kichraytirish"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => handleWindow('maximize')}
          className="w-9 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#1A1F2A] transition-colors rounded"
          title="Kattalashtirish"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => handleWindow('close')}
          className="w-9 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-rose-600 transition-colors rounded"
          title="Yopish"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
);
};
