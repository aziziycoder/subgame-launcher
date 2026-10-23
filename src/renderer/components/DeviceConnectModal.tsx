import React, { useState } from 'react';
import { Laptop, ExternalLink, Copy, Check, X, Loader2 } from 'lucide-react';

interface DeviceConnectModalProps {
  code: string;
  onClose: () => void;
  onOpenBrowser: () => void;
}

export const DeviceConnectModal: React.FC<DeviceConnectModalProps> = ({
  code,
  onClose,
  onOpenBrowser,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-md bg-[#141821] border border-[#2A3245] rounded-3xl p-6 text-center space-y-5 shadow-2xl overflow-hidden">
        {/* Glow */}
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-48 h-48 bg-[#A3E635]/15 rounded-full blur-3xl pointer-events-none" />

        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-14 h-14 rounded-2xl bg-[#A3E635]/15 text-[#A3E635] border border-[#A3E635]/30 flex items-center justify-center mx-auto shadow-inner">
          <Laptop className="w-7 h-7" />
        </div>

        <div>
          <h3 className="text-xl font-extrabold text-white">
            Launcherni Saytga Ulash
          </h3>
          <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto leading-relaxed">
            Google hisobingiz va litsenziyalaringizni ulash uchun quyidagi 6 xonali koddan foydalaning.
          </p>
        </div>

        {/* 6-Digit Code Display */}
        <div className="p-4 rounded-2xl bg-[#0B0D12] border border-[#2A3245] flex items-center justify-center gap-3">
          <span className="font-mono text-3xl font-black text-[#A3E635] tracking-widest selection:bg-transparent">
            {code.slice(0, 3)} {code.slice(3)}
          </span>
          <button
            onClick={handleCopy}
            title="Kodni nusxalash"
            className="p-2 rounded-xl bg-[#1A1F2A] hover:bg-[#2A3245] text-gray-300 hover:text-white transition-colors cursor-pointer ml-1"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        {/* Live waiting indicator */}
        <div className="flex items-center justify-center gap-2 text-xs text-gray-300 bg-[#1A1F2A]/60 py-2.5 px-3 rounded-xl border border-[#2A3245]/60">
          <Loader2 className="w-4 h-4 text-[#A3E635] animate-spin" />
          <span>Saytda tasdiqlash kutilmoqda...</span>
        </div>

        {/* Actions */}
        <div className="space-y-2 pt-1">
          <button
            onClick={onOpenBrowser}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#A3E635] text-[#0B0D12] font-black text-xs hover:bg-[#84CC16] transition-all hover:scale-[1.02] shadow-sm shadow-[#A3E635]/30 cursor-pointer"
          >
            <ExternalLink className="w-4 h-4" />
            <span>Brauzerda ochish va tasdiqlash</span>
          </button>

          <p className="text-[11px] text-gray-400">
            Brauzerda Google hisobingiz orqali tasdiqlaganingiz zahoti ushbu oyna avtomatik yopiladi.
          </p>
        </div>
      </div>
    </div>
  );
};
