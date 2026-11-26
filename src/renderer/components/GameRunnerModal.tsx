import React, { useState, useEffect } from 'react';
import { Play, FolderOpen, AlertCircle, X, CheckCircle2, Loader2, Sparkles, Globe, DownloadCloud, ExternalLink, ShieldCheck, Trash2, Mic, FileText } from 'lucide-react';
import { LauncherGame } from '../data/launcherGames';
import type { SubtitleRemovalInfo } from '../types';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes > 0) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return '0 MB';
}

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
  const [installedSubtitleVersion, setInstalledSubtitleVersion] = useState<string | null>(null);
  const [checkingVersion, setCheckingVersion] = useState(true);
  const [removalInfo, setRemovalInfo] = useState<SubtitleRemovalInfo | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [launchMode, setLaunchMode] = useState<'subtitle' | 'dubbing'>(game.hasDubbing ? 'dubbing' : 'subtitle');
  const [localDubInfo, setLocalDubInfo] = useState<{ installed: boolean; totalBytes: number } | null>(null);

  const isStandalone = Boolean(
    game.isStandalone ||
    game.skipSubtitleInjection ||
    game.id === 'level-devil' ||
    game.slug === 'level-devil' ||
    !game.targetFileName
  );

  const targetVersion = (game.version || '').trim();
  const hasSubtitleUrl = Boolean(game.subtitleDownloadUrl && game.subtitleDownloadUrl.startsWith('http'));

  // If game requires subtitles: verify whether current installed version equals the latest version
  const isSubtitleOutdated = !isStandalone && hasSubtitleUrl && Boolean(
    targetVersion && (!installedSubtitleVersion || installedSubtitleVersion !== targetVersion)
  );

  useEffect(() => {
    // Load previously saved path if exists
    const saved = localStorage.getItem(`subgame_exe_${game.id}`);
    if (saved) {
      setExePath(saved);
    }

    let isMounted = true;
    async function checkInstalledVersion() {
      setCheckingVersion(true);
      let ver: string | null = null;
      try {
        if (window.subgame?.getSubtitleVersion) {
          ver = await window.subgame.getSubtitleVersion(game.id);
        }
      } catch {}
      if (!ver) {
        ver = localStorage.getItem(`subgame_sub_version_${game.id}`);
      }
      if (isMounted) {
        setInstalledSubtitleVersion(ver || null);
        setCheckingVersion(false);
      }
    }
    checkInstalledVersion();
    return () => { isMounted = false; };
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

  const buildSubtitleConfig = () => ({
    gameId: game.id,
    gameExePath: exePath,
    targetSubtitleFileName: game.targetFileName,
    targetRelativeDir: game.targetRelativeDir,
    subtitleDownloadUrl: game.subtitleDownloadUrl,
    subtitleVersion: game.version,
    skipSubtitleInjection: Boolean(game.skipSubtitleInjection || !game.targetFileName),
    isAuthorized: true,
    useDubbing: Boolean(game.hasDubbing && launchMode === 'dubbing'),
    dubbingDownloadUrl: game.dubbingDownloadUrl,
    dubbingVersion: game.dubbingVersion,
  });

  // Eski (1.4.5 gacha) main kodda bu IPC yo'q: tugma ko'rinmaydi
  const canRemove = !isStandalone && Boolean(window.subgame?.getSubtitleRemovalInfo && window.subgame?.removeSubtitle);

  const refreshRemovalInfo = async () => {
    if (!canRemove) return null;
    try {
      const info = await window.subgame!.getSubtitleRemovalInfo!(buildSubtitleConfig());
      setRemovalInfo(info?.success ? info : null);
      return info;
    } catch {
      setRemovalInfo(null);
      return null;
    }
  };

  useEffect(() => {
    void refreshRemovalInfo();
    if (game.hasDubbing && exePath && window.subgame?.checkLocalDubbing) {
      window.subgame.checkLocalDubbing(game.id, exePath).then(setLocalDubInfo).catch(() => setLocalDubInfo(null));
    } else {
      setLocalDubInfo(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, exePath, installedSubtitleVersion]);

  const openRemoveConfirm = async () => {
    setRemoveError(null);
    setError(null);
    setSuccessMessage(null);
    await refreshRemovalInfo();
    setConfirmRemove(true);
  };

  const handleRemoveSubtitles = async (cacheOnly = false) => {
    if (!window.subgame?.removeSubtitle) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await window.subgame.removeSubtitle(buildSubtitleConfig(), { cacheOnly });
      if (res?.success) {
        try {
          localStorage.removeItem(`subgame_sub_version_${game.id}`);
        } catch {}
        setInstalledSubtitleVersion(null);
        setConfirmRemove(false);
        setSuccessMessage(res.message);
        await refreshRemovalInfo();
      } else {
        setRemoveError(res?.message || 'Subtitrlarni o‘chirib bo‘lmadi.');
        await refreshRemovalInfo();
      }
    } catch (err: any) {
      setRemoveError(err?.message || 'Kutilmagan xatolik yuz berdi.');
    } finally {
      setRemoving(false);
    }
  };

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
      const res = await window.subgame?.installSubtitle(buildSubtitleConfig());

      if (res?.success) {
        setInstalledSubtitleVersion(targetVersion);
        try {
          localStorage.setItem(`subgame_sub_version_${game.id}`, targetVersion);
        } catch {}
        setSuccessMessage(res.message || `O‘zbekcha subtitr (${targetVersion}) muvaffaqiyatli ulandi! Endi o‘yinni boshlashingiz mumkin.`);
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

    if (isSubtitleOutdated) {
      setError(`Subtitr yangilanmagan! O‘yinni o‘ynashdan oldin yangi versiyani (${targetVersion}) yuklab olishingiz shart.`);
      return;
    }

    setLaunching(true);
    setError(null);
    setSuccessMessage(null);
    setDownloadProgress(null);
    setDownloadInfo(null);
    setStatusMessage('Boshlanmoqda...');

    try {
      const res = await window.subgame?.launchGame(buildSubtitleConfig());

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

        {/* Subtitle Outdated / Missing Warning Notice */}
        {isSubtitleOutdated && (
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/40 rounded-xl text-xs mb-4">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-300">
                    {installedSubtitleVersion ? "Yangi subtitr versiyasi mavjud!" : "Subtitr hali yuklanmagan!"}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-amber-400/20 text-amber-300 font-mono text-[11px] font-bold border border-amber-400/30">
                    {targetVersion}
                  </span>
                </div>
                <p className="text-[11px] text-gray-300 mt-1 leading-relaxed">
                  {installedSubtitleVersion
                    ? `Sizdagi versiya: ${installedSubtitleVersion}. O‘yinni o‘ynashdan oldin yangi subtitr versiyasini yuklab olishingiz shart.`
                    : `Ushbu o‘yin o‘zbek tilida ishlashi uchun avval yangi subtitr paketini yuklab olishingiz shart.`}
                </p>
              </div>
            </div>
          </div>
        )}

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

        {/* Dubbing & Subtitle Mode Selector */}
        {game.hasDubbing && (
          <div className="mb-4 space-y-2">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-gray-400">
              O‘zbekcha paket tanlovi:
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLaunchMode('subtitle')}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  launchMode === 'subtitle'
                    ? 'bg-[#A3E635]/15 border-[#A3E635]'
                    : 'bg-[#141821] border-[#2A3245] hover:border-gray-500'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-white">
                  <span className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#A3E635]" />
                    Subtitr
                  </span>
                  <span className="font-mono text-[10px] text-gray-400">{game.subtitleSize}</span>
                </div>
                <span className="block text-[10px] text-gray-400 mt-0.5">Faqat matn tarjimasi</span>
              </button>

              <button
                type="button"
                onClick={() => setLaunchMode('dubbing')}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  launchMode === 'dubbing'
                    ? 'bg-violet-500/20 border-violet-400'
                    : 'bg-[#141821] border-[#2A3245] hover:border-gray-500'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-white">
                  <span className="flex items-center gap-1.5">
                    <Mic className="w-3.5 h-3.5 text-violet-400" />
                    Dublyaj + Subtitr
                  </span>
                  <span className="font-mono text-[10px] text-violet-300">{game.dubbingSize || '1.16 GB'}</span>
                </div>
                <span className="block text-[10px] text-violet-300/90 mt-0.5">
                  {localDubInfo?.installed
                    ? 'O‘rnatilgan (Tayyor)'
                    : 'O‘zbekcha ovoz + matn'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Protection / Status Notice */}
        <div className="p-3 bg-[#141821] border border-[#2A3245] rounded-xl text-xs text-gray-300 flex items-center justify-between gap-2.5 mb-5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#A3E635] shrink-0" />
            <span>
              Lokalizatsiya: <span className="text-[#A3E635] font-semibold">To‘liq o‘zbekcha</span>
              {game.isStandalone
                ? ' (Mustaqil o‘yin)'
                : game.hasDubbing && launchMode === 'dubbing'
                  ? ` (${game.dubbingSize || '1.16 GB'})`
                  : ` (${game.subtitleSize})`}
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

        {canRemove && removalInfo && !removalInfo.nothingToRemove && !launching && !installing && (
          <div className="flex items-center justify-between gap-2 -mt-3 mb-5 px-1 text-[11px] text-gray-400">
            <span>
              Subtitrlar kompyuteringizda <span className="text-gray-200 font-semibold">{formatSize(removalInfo.totalBytes)}</span> joy egallagan.
            </span>
            <button
              type="button"
              onClick={openRemoveConfirm}
              className="text-rose-300 hover:text-rose-200 hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
              title="O‘zbekcha subtitrlarni kompyuterdan o‘chirish (litsenziya saqlanadi)"
            >
              <Trash2 className="w-3 h-3" /> O‘chirish
            </button>
          </div>
        )}

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

          {isSubtitleOutdated ? (
            <button
              type="button"
              onClick={handleInstallSubtitle}
              disabled={installing || launching}
              className="flex-2 py-3 px-6 rounded-xl bg-gradient-to-r from-amber-400 via-lime-400 to-[#A3E635] hover:opacity-95 text-[#0B0D12] text-sm font-extrabold shadow-md shadow-amber-400/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
              title="O‘yinni o‘ynash uchun avval yangi subtitr paketini yuklab oling"
            >
              {installing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#0B0D12]" />
                  <span>
                    {downloadProgress !== null && downloadProgress >= 0
                      ? `Yuklanmoqda: ${downloadProgress}%`
                      : 'Yuklab olinmoqda...'}
                  </span>
                </>
              ) : (
                <>
                  <DownloadCloud className="w-4 h-4" />
                  <span>Yangi Subtitrni Yuklab Olish ({targetVersion})</span>
                </>
              )}
            </button>
          ) : (
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
          )}
        </div>

        {confirmRemove && removalInfo && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-5 bg-[#0B0D12]/90 backdrop-blur-sm">
            <div className="w-full bg-[#1A1F2A] border border-rose-500/40 rounded-2xl p-5 shadow-modal">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
                  <Trash2 className="w-4 h-4 text-rose-300" />
                </div>
                <h4 className="text-base font-bold text-[#F5F7FA]">O‘zbekcha subtitrlarni o‘chirish</h4>
              </div>

              <p className="text-xs text-gray-300 mb-3">
                <span className="font-semibold text-gray-100">{game.title}</span> uchun quyidagilar o‘chiriladi:
              </p>
              <ul className="text-xs text-gray-300 space-y-1.5 mb-3">
                {removalInfo.cacheBytes > 0 && (
                  <li className="flex justify-between gap-3">
                    <span>• Launcher yuklab olgan subtitr paketi</span>
                    <span className="font-mono text-gray-100 shrink-0">{formatSize(removalInfo.cacheBytes)}</span>
                  </li>
                )}
                {removalInfo.gameFolderFound && removalInfo.gameFolderItems > 0 && (
                  <li className="flex justify-between gap-3">
                    <span>• O‘yin papkasidagi launcher fayllari ({removalInfo.gameFolderItems} ta), asl fayllar tiklanadi</span>
                    <span className="font-mono text-gray-100 shrink-0">{formatSize(removalInfo.gameFolderBytes)}</span>
                  </li>
                )}
              </ul>
              <div className="flex justify-between text-xs font-bold text-[#F5F7FA] border-t border-[#2A3245] pt-2.5 mb-3">
                <span>Bo‘shaydigan joy</span>
                <span className="font-mono text-[#A3E635]">{formatSize(removalInfo.totalBytes)}</span>
              </div>

              <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
                O‘yinning o‘z fayllariga tegilmaydi. Litsenziyangiz shu kompyuterda saqlanib qoladi: keyinroq qayta o‘rnatish uchun yana to‘lash shart emas.
              </p>

              {removalInfo.gameRunning && (
                <div className="flex items-start gap-2 p-2.5 mb-3 bg-amber-500/10 border border-amber-500/40 rounded-xl text-amber-200 text-[11px]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>O‘yin hozir ochiq. Avval o‘yinni to‘liq yoping, keyin o‘chiring.</span>
                </div>
              )}
              {!removalInfo.gameRunning && removalInfo.filesLocked && (
                <div className="flex items-start gap-2 p-2.5 mb-3 bg-amber-500/10 border border-amber-500/40 rounded-xl text-amber-200 text-[11px]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Ba’zi subtitr fayllari band: o‘yin yoki boshqa dastur ularni ishlatmoqda. O‘yinni (va Steam/Epic launcherini) yopib, qaytadan oching.</span>
                </div>
              )}
              {!removalInfo.gameFolderFound && (
                <div className="flex items-start gap-2 p-2.5 mb-3 bg-amber-500/10 border border-amber-500/40 rounded-xl text-amber-200 text-[11px]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    O‘yin papkasi topilmadi. O‘yinni boshqa joyga ko‘chirgan bo‘lsangiz, avval yangi joydagi {game.defaultExeName} faylini tanlang. O‘yin o‘chirilgan bo‘lsa, faqat launcher yuklab olgan fayllar o‘chiriladi.
                  </span>
                </div>
              )}
              {removalInfo.gameFolderFound && removalInfo.needsVerify && (
                <div className="flex items-start gap-2 p-2.5 mb-3 bg-[#141821] border border-[#2A3245] rounded-xl text-gray-300 text-[11px]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-300" />
                  <span>Ba’zi fayllarning asl nusxasi saqlanmagan. O‘chirgandan keyin o‘yin ishlamasa, Steam/Epic’da o‘yin fayllarini tekshiring.</span>
                </div>
              )}

              {removeError && (
                <div className="flex items-start gap-2 p-2.5 mb-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-[11px]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-400" />
                  <span>{removeError}</span>
                </div>
              )}

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmRemove(false)}
                  disabled={removing}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#141821] hover:bg-white/10 text-gray-300 text-xs font-semibold border border-[#2A3245] transition-all cursor-pointer disabled:opacity-50"
                >
                  Bekor qilish
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveSubtitles(!removalInfo.gameFolderFound)}
                  disabled={removing || removalInfo.gameRunning || Boolean(removalInfo.filesLocked)}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                >
                  {removing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> O‘chirilmoqda...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      {removalInfo.gameFolderFound ? 'O‘chirish' : 'Faqat yuklangan fayllarni o‘chirish'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
