import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowRight, DownloadCloud, Loader2, RefreshCw, X, AlertCircle, CheckCircle2, Zap } from 'lucide-react';
import { AppUpdateInfo } from '../services/updateService';

interface UpdateModalProps {
  currentVersion: string;
  latestInfo: AppUpdateInfo;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ currentVersion, latestInfo, onClose }) => {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [transferredMb, setTransferredMb] = useState('0');
  const [totalMb, setTotalMb] = useState('0');
  const [downloadedTempPath, setDownloadedTempPath] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = window.subgame?.onUpdateProgress((p) => {
      setProgress(p.percent || 0);
      if (p.transferred) {
        setTransferredMb((p.transferred / (1024 * 1024)).toFixed(1));
      }
      if (p.total) {
        setTotalMb((p.total / (1024 * 1024)).toFixed(1));
      }
    });
    return () => {
      unsub?.();
    };
  }, []);

  const isPatch = Boolean(latestInfo.patchUrl);

  const handleStartDownload = async () => {
    setDownloading(true);
    setError(null);
    setProgress(0);

    try {
      const targetUrl = latestInfo.patchUrl || latestInfo.downloadUrl;
      const res = await window.subgame?.downloadUpdate(targetUrl);
      if (res?.success && res.tempPath) {
        setDownloadedTempPath(res.tempPath);
      } else {
        setError(res?.error || 'Yangilanishni yuklab olishda xatolik yuz berdi');
      }
    } catch (err: any) {
      setError(err?.message || 'Yuklab olishda kutilmagan xatolik yuz berdi');
    } finally {
      setDownloading(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (!downloadedTempPath) return;
    setApplying(true);
    setError(null);

    try {
      const res = await window.subgame?.applyUpdate(downloadedTempPath);
      if (!res?.success) {
        setError(res?.error || 'Yangilanishni qo‘llashda xatolik');
        setApplying(false);
      }
    } catch (err: any) {
      setError(err?.message || 'Qayta ishga tushirishda xatolik');
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-[#141821] border border-[#2A3245] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-[#2A3245] flex items-center justify-between bg-[#0B0D12]/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#A3E635]/15 border border-[#A3E635]/30 text-[#A3E635] flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Yangi talqin mavjud!</h3>
              <p className="text-xs text-gray-400">SubGame Launcher avtomatik yangilanishi</p>
            </div>
          </div>
          {!downloading && !applying && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#1A202C] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Version badge */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#0B0D12] border border-[#2A3245]">
            <div className="text-center">
              <span className="text-[10px] uppercase font-bold text-gray-500 block">Joriy</span>
              <span className="text-xs font-mono font-bold text-gray-300">v{currentVersion}</span>
            </div>
            <ArrowRight className="w-4 h-4 text-[#A3E635]" />
            <div className="text-center">
              <span className="text-[10px] uppercase font-bold text-[#A3E635] block">Yangi</span>
              <span className="text-xs font-mono font-bold text-[#A3E635]">v{latestInfo.version}</span>
            </div>
          </div>

          {/* Update Type Pill */}
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-gray-400">Yangilanish turi:</span>
            {isPatch ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#A3E635]/15 text-[#A3E635] border border-[#A3E635]/30 text-[11px] font-bold">
                <Zap className="w-3 h-3 fill-current" />
                Tezkor Patch ({latestInfo.patchSize || '~950 KB'})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/10 text-gray-300 border border-white/20 text-[11px] font-medium">
                To‘liq yangilanish (~96 MB)
              </span>
            )}
          </div>

          {/* Changelog */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-gray-300 uppercase tracking-wider block">
              Yangilanishlar ro‘yxati:
            </span>
            <div className="p-3.5 rounded-xl bg-[#0B0D12] border border-[#2A3245] text-xs text-gray-300 font-sans leading-relaxed whitespace-pre-line max-h-36 overflow-y-auto">
              {latestInfo.changelog || 'Barqarorlik va ishlash tezligi yaxshilandi.'}
            </div>
          </div>

          {/* Download Progress */}
          {downloading && (
            <div className="space-y-2 p-3.5 rounded-xl bg-[#0B0D12] border border-[#2A3245]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 flex items-center gap-1.5 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#A3E635]" />
                  Yangilanish yuklanmoqda...
                </span>
                <span className="font-mono font-bold text-[#A3E635]">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-[#1E2533] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#A3E635] transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-[11px] text-gray-500 font-mono text-right">
                {transferredMb} MB / {totalMb} MB
              </div>
            </div>
          )}

          {/* Downloaded Success Notification */}
          {downloadedTempPath && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>
                Yangi versiya muvaffaqiyatli yuklab olindi! Yangilashni yakunlash uchun qayta ishga tushiring.
              </span>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-[#2A3245] bg-[#0B0D12]/60 flex items-center justify-end gap-2.5">
          {!downloading && !applying && (
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-[#1E2533] hover:bg-[#2A3245] text-xs font-semibold text-gray-300 transition-colors cursor-pointer"
            >
              Keyinroq
            </button>
          )}

          {downloadedTempPath ? (
            <button
              onClick={handleApplyUpdate}
              disabled={applying}
              className="px-5 py-2.5 rounded-xl bg-[#A3E635] hover:bg-[#84CC16] text-[#0B0D12] text-xs font-black flex items-center gap-2 shadow-accent-glow transition-all hover:scale-[1.02] cursor-pointer disabled:opacity-50"
            >
              {applying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Yangilanmoqda...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 stroke-[2.5]" />
                  <span>Qayta ishga tushirish</span>
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleStartDownload}
              disabled={downloading}
              className="px-5 py-2.5 rounded-xl bg-[#A3E635] hover:bg-[#84CC16] text-[#0B0D12] text-xs font-black flex items-center gap-2 shadow-accent-glow transition-all hover:scale-[1.02] cursor-pointer disabled:opacity-50"
            >
              {downloading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Yuklanmoqda ({progress}%)</span>
                </>
              ) : (
                <>
                  <DownloadCloud className="w-4 h-4 stroke-[2.5]" />
                  <span>Hozir yangilash</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
