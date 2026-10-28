import React, { useState, useEffect } from 'react';
import { Play, FolderOpen, AlertCircle, X, CheckCircle2, Loader2, Sparkles, Globe, DownloadCloud, ExternalLink, ShieldCheck } from 'lucide-react';
import { LauncherGame } from '../data/launcherGames';

interface GameRunnerModalProps {
  game: LauncherGame;
  onClose: () => void;
}

export const GameRunnerModal: React.FC<GameRunnerModalProps> = ({ game, onClose }) => {
  const [exePath, setExePath] = useState('');
  const [launching, setLaunching] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadInfo, setDownloadInfo] = useState<{ transferredMb: string; totalMb: string } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load previously saved path if exists
    const saved = localStorage.getItem(`subgame_exe_${game.id}`);
    if (saved) {
      setExePath(saved);
    }
  }, [game.id]);

  useEffect(() => {
    // Subscribe to IPC status updates (supports both text string and 0-100% progress object)
    const unsubscribe = window.subgame?.onStatusUpdate((data: any) => {
      if (typeof data === 'object' && data?.type === 'download-progress') {
        setDownloadProgress(data.percent);
        if (data.transferredMb) {
          setDownloadInfo({
            transferredMb: data.transferredMb,
            totalMb: data.totalMb || '?'
          });
        }
        setStatusMessage(data.message || '');
      } else if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.type === 'download-progress') {
            setDownloadProgress(parsed.percent);
            if (parsed.transferredMb) {
              setDownloadInfo({
                transferredMb: parsed.transferredMb,
                totalMb: parsed.totalMb || '?'
              });
            }
            setStatusMessage(parsed.message || '');
            return;
          }
        } catch {}
        setStatusMessage(data);
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleSelectExe = async () => {
    const selected = await window.subgame?.selectGameExecutable();
    if (selected) {
      setExePath(selected);
      localStorage.setItem(`subgame_exe_${game.id}`, selected);
      setError(null);
      setSuccessMessage(null);
    }
  };

  const handleOpenFolder = async () => {
    if (!exePath) {
      setError(`Avval o'yin ijro faylini (${game.defaultExeName}) tanlang.`);
      return;
    }
    const opened = await window.subgame?.openGameFolder(exePath);
    if (!opened) {
      setError("O'yin papkasi topilmadi yoki ochilmadi.");
    }
  };

  const handleInstallSubtitle = async () => {
    if (!exePath) {
      setError(`Iltimos, avval o'yin ijro faylini (${game.defaultExeName}) tanlang.`);
      return;
    }

    setInstalling(true);
    setError(null);
    setSuccessMessage(null);
    setDownloadProgress(null);
    setDownloadInfo(null);
    setStatusMessage("Subtitr tayyorlanmoqda...");

    try {
      const skipInjection = Boolean(game.skipSubtitleInjection || !game.targetFileName);
      const res = await window.subgame?.installSubtitle({
        gameId: game.id,
        gameExePath: exePath,
        targetSubtitleFileName: game.targetFileName,
        targetRelativeDir: game.targetRelativeDir,
        subtitleDownloadUrl: game.subtitleDownloadUrl,
        subtitleVersion: game.version,
        skipSubtitleInjection: skipInjection,
        isAuthorized: true,
      });

      if (res?.success) {
        setSuccessMessage(res.message || "O‘zbekcha subtitr paketi o‘yinga muvaffaqiyatli ulandi!");
        setStatusMessage('');
      } else {
        setError(res?.message || "Subtitrni joylashda xatolik yuz berdi.");
      }
    } catch (err: any) {
      setError(err?.message || "Kutilmagan xatolik yuz berdi.");
    } finally {
      setInstalling(false);
    }
  };

  const handleOpenWebsite = () => {
    const url = `https://www.subgame.uz/games/${game.slug}`;
    if (window.subgame?.openExternal) {
      window.subgame.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const handleLaunch = async () => {
    if (!exePath) {
      setError(`Iltimos, avval o'yin ijro faylini (${game.defaultExeName}) tanlang.`);
      return;
    }

    setLaunching(true);
    setError(null);
    setSuccessMessage(null);
    setDownloadProgress(null);
    setDownloadInfo(null);
    setStatusMessage('Boshlanmoqda...');

    try {
      const skipInjection = Boolean(game.skipSubtitleInjection || !game.targetFileName);
      const res = await window.subgame?.launchGame({
        gameId: game.id,
        gameExePath: exePath,
        targetSubtitleFileName: game.targetFileName,
        targetRelativeDir: game.targetRelativeDir,
        subtitleDownloadUrl: game.subtitleDownloadUrl,
        subtitleVersion: game.version,
        skipSubtitleInjection: skipInjection,
        isAuthorized: true,
      });

      if (!res?.success) {
        setError(res?.message || "O'yinni ishga tushirishda xatolik yuz berdi");
        setLaunching(false);
      } else {
        setSuccessMessage("O'yin o'zbekcha subtitrlar bilan ishga tushirildi!");
      }
    } catch (err: any) {
      setError(err?.message || 'Kutilmagan xatolik yuz berdi');
      setLaunching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-lg bg-[#1A1F2A] border border-[#2A3245] rounded-2xl shadow-modal p-6 overflow-hidden">
        {/* Glow */}
        <div className="absolute -top-20 -right-20 w-44 h-44 bg-[#A3E635]/15 rounded-full blur-3xl pointer-events-none" />

        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3.5 mb-5">
          <img
            src={game.cardImage}
            alt={game.title}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              if (game.fallbackImage) target.src = game.fallbackImage;
            }}
            className="w-16 h-12 object-cover rounded-lg border border-[#2A3245] shadow-md"
          />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-[#F5F7FA]">{game.title}</h3>
              <span className="text-[10px] font-bold text-[#A3E635] bg-[#A3E635]/15 border border-[#A3E635]/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Faol
              </span>
            </div>
            <p className="text-xs text-gray-400">O‘zbekcha subtitrlar bilan xavfsiz ishga tushirish</p>
          </div>
        </div>

        {/* Executable selection */}
        <div className="space-y-3 mb-5">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-gray-300">
              Kompyuteringizdagi O‘yin Fayli (.exe):
            </label>
            {exePath && (
              <button
                type="button"
                onClick={handleOpenFolder}
                className="text-[11px] text-[#A3E635] hover:underline flex items-center gap-1 cursor-pointer"
                title="O'yin joylashgan papkani Windows Explorerda ochish"
              >
                <ExternalLink className="w-3 h-3" /> Papkani ochish
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={exePath}
              onChange={(e) => {
                setExePath(e.target.value);
                localStorage.setItem(`subgame_exe_${game.id}`, e.target.value);
                setError(null);
                setSuccessMessage(null);
              }}
              placeholder={`Masalan: C:\\Games\\${game.title}\\${game.defaultExeName}`}
              className="flex-1 px-3.5 py-2.5 bg-[#0B0D12] border border-[#2A3245] rounded-xl text-xs text-gray-200 focus:outline-none focus:border-[#A3E635] font-mono truncate"
            />
            <button
              onClick={handleSelectExe}
              className="px-3.5 py-2.5 bg-[#141821] hover:bg-white/10 text-gray-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 border border-[#2A3245] cursor-pointer"
            >
              <FolderOpen className="w-4 h-4 text-[#A3E635]" />
              Tanlash
            </button>
          </div>
          <div className="flex items-center justify-between text-[11px] text-gray-400">
            <span>
              O‘rnatilgan papkadagi <code className="text-[#A3E635] font-mono">{game.defaultExeName}</code> faylini ko‘rsating.
            </span>
            <button
              type="button"
              onClick={handleOpenWebsite}
              className="text-[#A3E635] hover:underline flex items-center gap-1 shrink-0 ml-2 cursor-pointer"
            >
              <Globe className="w-3 h-3" /> Saytda ko‘rish
            </button>
          </div>
        </div>

        {/* Protection / Status Notice */}
        <div className="p-3 bg-[#141821] border border-[#2A3245] rounded-xl text-xs text-gray-300 flex items-center justify-between gap-2.5 mb-5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#A3E635] shrink-0" />
            <span>
              Lokalizatsiya: <span className="text-[#A3E635] font-semibold">To‘liq o‘zbekcha</span>
              {game.isStandalone ? ' (Mustaqil o‘yin)' : ` (${game.subtitleSize})`}
            </span>
          </div>
          {game.isStandalone || game.skipSubtitleInjection ? (
            <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Tayyor
            </span>
          ) : (
            <span
              className="px-2.5 py-1 text-[11px] font-semibold bg-[#A3E635]/10 border border-[#A3E635]/25 text-[#A3E635] rounded-lg flex items-center gap-1.5"
              title="SubGame DRM xavfsiz himoyasi: o'yin faqat Launcher orqali o'zbekcha ishlaydi va yopilganda asl holiga qaytadi"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-[#A3E635]" />
              <span>Avtomatik DRM Himoyasi</span>
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs mb-4">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs mb-4">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Subtitle Download Progress Card (0-100%) */}
        {downloadProgress !== null && (
          <div className="space-y-2.5 p-4 rounded-xl bg-[#0B0D12] border border-[#2A3245] shadow-inner mb-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-200 flex items-center gap-2 font-medium">
                <DownloadCloud className="w-4 h-4 text-[#A3E635] animate-bounce" />
                <span>Subtitr serverdan yuklanmoqda...</span>
              </span>
              <span className="font-mono font-bold text-[#A3E635] text-sm">
                {downloadProgress >= 0 ? `${downloadProgress}%` : 'Yuklanmoqda'}
              </span>
            </div>

            {/* Visual Progress Bar Track */}
            <div className="w-full h-2.5 bg-[#1A1F2A] rounded-full overflow-hidden border border-[#2A3245]/60 p-0.5">
              <div
                className={`h-full bg-gradient-to-r from-[#84CC16] to-[#A3E635] transition-all duration-150 rounded-full shadow-sm shadow-[#A3E635]/50 ${
                  downloadProgress < 0 ? 'w-full animate-pulse' : ''
                }`}
                style={{ width: downloadProgress >= 0 ? `${downloadProgress}%` : '100%' }}
              />
            </div>

            {downloadInfo && (
              <div className="flex items-center justify-between text-[11px] text-gray-400 font-mono pt-0.5">
                <span>Yuklab olish</span>
                <span className="text-gray-300">
                  {downloadInfo.transferredMb} MB {downloadInfo.totalMb !== '?' ? `/ ${downloadInfo.totalMb} MB` : ''}
                </span>
              </div>
            )}
          </div>
        )}

        {statusMessage && downloadProgress === null && (
          <div className="flex items-center gap-2.5 p-3 bg-[#0B0D12] border border-[#A3E635]/40 rounded-xl text-[#A3E635] text-xs mb-4">
            <Loader2 className="w-4 h-4 shrink-0 animate-spin text-[#A3E635]" />
            <span>{statusMessage}</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl bg-[#141821] hover:bg-white/10 text-gray-300 text-sm font-semibold border border-[#2A3245] transition-all cursor-pointer"
          >
            Yopish
          </button>
          <button
            type="button"
            onClick={handleLaunch}
            disabled={launching || installing}
            className="flex-2 py-3 px-6 rounded-xl bg-[#A3E635] hover:bg-[#84CC16] text-[#0B0D12] text-sm font-extrabold shadow-sm shadow-[#A3E635]/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
          >
            {launching || installing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#0B0D12]" />
                <span>
                  {downloadProgress !== null && downloadProgress >= 0
                    ? `Yuklanmoqda: ${downloadProgress}%`
                    : 'Ishga tushmoqda...'}
                </span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>O‘yinni Boshlash</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
