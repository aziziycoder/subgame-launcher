import { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { GameCard } from './components/GameCard';
import { ActivationModal } from './components/ActivationModal';
import { GameRunnerModal } from './components/GameRunnerModal';
import { DeviceConnectModal } from './components/DeviceConnectModal';
import { UpdateModal } from './components/UpdateModal';
import { LAUNCHER_GAMES, LauncherGame } from './data/launcherGames';
import { fetchLauncherGames } from './services/gamesService';
import { checkForAppUpdate, AppUpdateInfo } from './services/updateService';
import { useAuth } from './context/AuthContext';
import {
  Gamepad2,
  Cpu,
  Globe,
  Send,
  Search,
  KeyRound,
  ExternalLink,
  Info,
  Copy,
  Check,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  HeartHandshake,
  LogOut,
  AlertCircle,
  Loader2,
  Laptop,
  RefreshCw,
  Crown
} from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState<'library' | 'device' | 'about'>('library');
  const [hwidInfo, setHwidInfo] = useState<any>(null);
  const [licenses, setLicenses] = useState<Record<string, any>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'ready' | 'active'>('all');

  const [games, setGames] = useState<LauncherGame[]>([]);
  const [refreshingGames, setRefreshingGames] = useState(true);

  const [selectedGameForActivation, setSelectedGameForActivation] = useState<LauncherGame | null>(null);
  const [selectedGameForPlay, setSelectedGameForPlay] = useState<LauncherGame | null>(null);
  const [copiedHwid, setCopiedHwid] = useState(false);

  const {
    user,
    isAdmin,
    cloudLicenses,
    pairingCode,
    isPairing,
    startDevicePairing,
    cancelDevicePairing,
    openPairingInBrowser,
    signOut,
    bindDeviceToLicense,
  } = useAuth();

  const [deviceMismatchModal, setDeviceMismatchModal] = useState<{
    gameTitle: string;
    boundDevice: string;
  } | null>(null);

  const [deviceBindingLoading, setDeviceBindingLoading] = useState(false);

  // Auto-updater state
  const [updateData, setUpdateData] = useState<{
    updateAvailable: boolean;
    isForceUpdate: boolean;
    currentVersion: string;
    latestInfo?: AppUpdateInfo;
  }>({
    updateAvailable: false,
    isForceUpdate: false,
    currentVersion: '1.0.0',
  });
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [updateToast, setUpdateToast] = useState<string | null>(null);

  const loadData = async () => {
    if (window.subgame) {
      const hwid = await window.subgame.getHardwareId();
      setHwidInfo(hwid);

      const lic = await window.subgame.getLicenses();
      setLicenses(lic || {});
    } else {
      // Dev fallback for browser testing
      setHwidInfo({
        hwid: '0113680B7A18D15F77E09F61AFED5B29B141EE9E886731B3B13007960375D584',
        formattedHwid: 'SG-0113-680B-7A18-D15F',
        motherboardUuid: 'D703064C-AE42-E711-9BD2-9829A62F1DA8',
        processorId: 'BFEBFBFF000906E9',
        biosSerial: 'NHGM2ER0047230F5293400',
      });
    }
  };

  const loadDynamicGames = async () => {
    setRefreshingGames(true);
    try {
      const list = await fetchLauncherGames();
      setGames(list);
    } catch (err) {
      console.warn('Failed to load dynamic games:', err);
    } finally {
      setRefreshingGames(false);
    }
  };

  const handleCheckForUpdates = async (manual: boolean = false) => {
    setCheckingUpdate(true);
    try {
      const res = await checkForAppUpdate();
      setUpdateData(res);
      if (res.updateAvailable) {
        if (res.isForceUpdate || manual) {
          setIsUpdateModalOpen(true);
        }
      } else {
        if (manual) {
          setUpdateToast(`Sizda SubGame Launcherning eng so'nggi talqini o'rnatilgan (v${res.currentVersion})`);
          setTimeout(() => setUpdateToast(null), 4000);
        }
      }
    } catch (e) {
      if (manual) {
        setUpdateToast("Yangilanishlarni tekshirishda xatolik yuz berdi");
        setTimeout(() => setUpdateToast(null), 4000);
      }
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    loadData();
    loadDynamicGames();
    handleCheckForUpdates(false);
  }, []);

  const copyFullHwid = () => {
    if (hwidInfo?.hwid) {
      navigator.clipboard.writeText(hwidInfo.hwid);
      setCopiedHwid(true);
      setTimeout(() => setCopiedHwid(false), 2000);
    }
  };

  const openLink = (url: string) => {
    if (window.subgame?.openExternal) {
      window.subgame.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const handlePlayGame = async (game: LauncherGame) => {
    // 0. Force Update Check: If launcher is outdated, block playing
    if (updateData.isForceUpdate) {
      setIsUpdateModalOpen(true);
      return;
    }

    // 1. If not logged in, prompt Device Pairing via Website
    if (!user) {
      await startDevicePairing();
      return;
    }

    // 2. VIP Admin Bypass: Admins can test and play all games immediately
    if (isAdmin) {
      setSelectedGameForPlay(game);
      return;
    }

    // 3. Check if user already owns this game in cloudLicenses
    const cloudLic = cloudLicenses[game.id];
    if (!cloudLic || cloudLic.status !== 'active') {
      // User must first claim or purchase the game from the official website!
      openLink(`https://www.subgame.uz/games/${game.slug}`);
      return;
    }

    const currentHwid = hwidInfo?.hwid || 'LOCAL_HWID';
    const currentDeviceName = hwidInfo?.formattedHwid || 'Ushbu kompyuter';

    // 4. HWID Enforcement (1 device per account)
    if (cloudLic.hwid) {
      if (cloudLic.hwid !== currentHwid) {
        setDeviceMismatchModal({
          gameTitle: game.title,
          boundDevice: cloudLic.boundDeviceName || 'Boshqa kompyuter',
        });
        return;
      }
    } else {
      // First launch: bind to this PC!
      setDeviceBindingLoading(true);
      await bindDeviceToLicense(game.id, currentHwid, currentDeviceName);
      cloudLic.hwid = currentHwid;
      cloudLic.boundDeviceName = currentDeviceName;
      setDeviceBindingLoading(false);
    }

    // 5. Authorized for this device! Open GameRunnerModal
    setSelectedGameForPlay(game);
  };

  const filteredGames = games.filter((game) => {
    const matchesSearch = game.title.toLowerCase().includes(searchQuery.toLowerCase());
    const isAct = isAdmin || cloudLicenses[game.id]?.status === 'active';
    if (filter === 'active') return matchesSearch && isAct;
    if (filter === 'ready') return matchesSearch && game.status === 'Tayyor';
    return matchesSearch;
  });

  const readyCount = games.filter((g) => g.status === 'Tayyor').length;
  const activeCount = isAdmin
    ? games.filter((g) => g.status === 'Tayyor').length
    : user
    ? Object.values(cloudLicenses).filter((l) => l.status === 'active').length
    : Object.values(licenses).filter((l: any) => l.status === 'active').length;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0B0D12] text-[#F5F7FA] overflow-hidden font-sans">
      {/* Frameless Title Bar */}
      <TitleBar
        hwidInfo={hwidInfo}
        currentVersion={updateData.currentVersion}
        latestVersion={updateData.latestInfo?.version}
        updateAvailable={updateData.updateAvailable}
        checkingUpdate={checkingUpdate}
        onCheckUpdate={() => handleCheckForUpdates(true)}
        onOpenUpdateModal={() => setIsUpdateModalOpen(true)}
      />

      {/* Main Layout Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-[#141821] border-r border-[#2A3245] flex flex-col justify-between p-4 shrink-0">
          <div className="space-y-4">
            {/* User Account / Google Sign-in Card */}
            <div className="p-3 rounded-2xl bg-[#0B0D12] border border-[#2A3245] space-y-2">
              {user ? (
                <div>
                  <div className="flex items-center gap-2.5 pb-2 border-b border-[#1A1F2A]">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || 'User'}
                        className="w-8 h-8 rounded-full object-cover border border-[#A3E635]"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#A3E635] text-[#0B0D12] font-black text-xs flex items-center justify-center">
                        {user.displayName?.charAt(0) || user.email?.charAt(0) || 'U'}
                      </div>
                    )}
                    <div className="overflow-hidden flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-xs font-bold text-white truncate leading-tight">
                          {user.displayName || 'Foydalanuvchi'}
                        </h4>
                        {isAdmin && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gradient-to-r from-amber-400 to-[#A3E635] text-[#0B0D12] text-[9px] font-black uppercase tracking-wider shrink-0 shadow-sm">
                            <Crown className="w-2.5 h-2.5 fill-current" />
                            VIP
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400 truncate mt-0.5 leading-tight">{user.email}</p>
                    </div>
                    <button
                      onClick={signOut}
                      title="Chiqish"
                      className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-rose-400 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between pt-1.5 text-[10px]">
                    <span className={isAdmin ? "text-amber-300 flex items-center gap-1 font-bold" : "text-emerald-400 flex items-center gap-1 font-semibold"}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isAdmin ? 'bg-amber-400' : 'bg-emerald-400'} animate-pulse`} />
                      {isAdmin ? 'VIP Admin faol' : 'Google hisob faol'}
                    </span>
                    <span className="font-mono text-gray-400">
                      {isAdmin ? 'Barchasi ochiq' : `${activeCount} ta o‘yin`}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-[11px] text-gray-300">
                    <span className="font-semibold text-white">Hisobingizga kiring</span>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Litsenziyalar va 1-qurilma himoyasini ulash uchun
                    </p>
                  </div>
                  <button
                    onClick={() => startDevicePairing()}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-white hover:bg-gray-100 text-[#0B0D12] text-xs font-bold shadow-md transition-all cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>Google bilan ulash</span>
                  </button>
                </div>
              )}
            </div>

            {/* Navigation Tabs */}
            <nav className="space-y-1.5">
              <button
                onClick={() => setActiveTab('library')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === 'library'
                    ? 'bg-[#A3E635]/15 text-[#A3E635] border border-[#A3E635]/40 shadow-sm'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Gamepad2 className="w-4 h-4 text-[#A3E635]" />
                <span>Kutubxona</span>
                {activeCount > 0 && (
                  <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#A3E635]/20 text-[#A3E635] border border-[#A3E635]/30">
                    {activeCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('device')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === 'device'
                    ? 'bg-[#A3E635]/15 text-[#A3E635] border border-[#A3E635]/40 shadow-sm'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Cpu className="w-4 h-4 text-[#A3E635]" />
                <span>Qurilma Pasporti</span>
              </button>

              <button
                onClick={() => setActiveTab('about')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === 'about'
                    ? 'bg-[#A3E635]/15 text-[#A3E635] border border-[#A3E635]/40 shadow-sm'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Info className="w-4 h-4 text-[#A3E635]" />
                <span>Loyiha Haqida</span>
              </button>
            </nav>

            {/* Platform Stats Widget */}
            <div className="p-3.5 rounded-xl bg-[#0B0D12] border border-[#2A3245] space-y-2.5 text-xs">
              <div className="flex items-center justify-between text-gray-400">
                <span>Mavjud o‘yinlar:</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-white">{games.length} ta</span>
                  <button
                    onClick={loadDynamicGames}
                    title="O‘yinlar ro‘yxatini yangilash"
                    className="p-1 rounded hover:bg-[#1A202C] text-gray-400 hover:text-[#A3E635] transition-colors"
                  >
                    <RefreshCw className={`w-3 h-3 ${refreshingGames ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between text-gray-400">
                <span>Tayyor subtitrlar:</span>
                <span className="font-mono font-bold text-[#A3E635]">{readyCount} ta</span>
              </div>
              <div className="flex items-center justify-between text-gray-400">
                <span>Faol litsenziyalar:</span>
                <span className="font-mono font-bold text-sky-400">{activeCount} ta</span>
              </div>
            </div>
          </div>

          {/* Quick Links Footer */}
          <div className="pt-4 border-t border-[#2A3245] space-y-2">
            <button
              onClick={() => openLink('https://www.subgame.uz')}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#0B0D12] hover:bg-white/5 text-xs text-gray-300 border border-[#2A3245] hover:border-gray-400 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-[#A3E635]" />
                <span>Rasmiy Veb-Sayt</span>
              </div>
              <ExternalLink className="w-3 h-3 text-gray-500" />
            </button>

            <button
              onClick={() => openLink('https://t.me/tarjimaoyinlar')}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#0B0D12] hover:bg-white/5 text-xs text-gray-300 border border-[#2A3245] hover:border-gray-400 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Send className="w-3.5 h-3.5 text-sky-400" />
                <span>Telegram Kanal</span>
              </div>
              <ExternalLink className="w-3 h-3 text-gray-500" />
            </button>

            <button
              onClick={() => openLink('https://taps.uz/subgame')}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-xs text-amber-300 border border-amber-500/30 hover:border-amber-400 transition-all font-semibold shadow-sm"
              title="Loyihani qo‘llab-quvvatlash (Donat - taps.uz/subgame)"
            >
              <div className="flex items-center gap-2">
                <HeartHandshake className="w-3.5 h-3.5 text-amber-400" />
                <span>Donat (taps.uz)</span>
              </div>
              <ExternalLink className="w-3 h-3 text-amber-400/70" />
            </button>
          </div>
        </aside>

        {/* Content View */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#0B0D12]">
          {activeTab === 'library' && (
            <div>
              {/* Header & Filter Controls */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-5 border-b border-[#2A3245]">
                <div>
                  <h1 className="text-2xl font-extrabold text-[#F5F7FA] tracking-tight flex items-center gap-2.5">
                    O‘yinlar Kutubxonasi
                  </h1>
                  <p className="text-xs text-[#9CA3AF] mt-1">
                    SubGame rasmiy lokalizatsiyalari va 1-qurilma himoyasidagi o‘yinlar
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {/* Search */}
                  <div className="relative">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="O‘yin nomini qidirish..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-4 py-2 bg-[#141821] border border-[#2A3245] rounded-xl text-xs text-[#F5F7FA] placeholder:text-gray-500 focus:outline-none focus:border-[#A3E635] focus:ring-1 focus:ring-[#A3E635] transition-all w-52"
                    />
                  </div>

                  {/* Filter chips */}
                  <div className="flex items-center bg-[#141821] p-1 rounded-xl border border-[#2A3245] text-xs">
                    <button
                      onClick={() => setFilter('all')}
                      className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                        filter === 'all'
                          ? 'bg-[#A3E635] text-[#0B0D12] font-bold shadow-sm'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Barchasi
                    </button>
                    <button
                      onClick={() => setFilter('active')}
                      className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                        filter === 'active'
                          ? 'bg-[#A3E635] text-[#0B0D12] font-bold shadow-sm'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Faol ({activeCount})
                    </button>
                    <button
                      onClick={() => setFilter('ready')}
                      className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                        filter === 'ready'
                          ? 'bg-[#A3E635] text-[#0B0D12] font-bold shadow-sm'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Tayyor ({readyCount})
                    </button>
                  </div>
                </div>
              </div>

              {/* Games Grid: Compact card grid */}
              {refreshingGames && games.length === 0 ? (
                <div className="py-24 text-center flex flex-col items-center justify-center gap-3">
                  <RefreshCw className="w-8 h-8 text-[#A3E635] animate-spin" />
                  <p className="text-xs text-gray-400">O‘yinlar bazadan yuklanmoqda...</p>
                </div>
              ) : filteredGames.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-4 pb-16">
                  {filteredGames.map((game) => (
                    <GameCard
                      key={game.id}
                      game={game}
                      cloudLicense={cloudLicenses[game.id]}
                      currentHwid={hwidInfo?.hwid}
                      isActivated={isAdmin || cloudLicenses[game.id]?.status === 'active'}
                      isAdmin={isAdmin}
                      onActivate={() => openLink(`https://www.subgame.uz/games/${game.slug}`)}
                      onPlay={() => handlePlayGame(game)}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-20 text-center text-xs text-gray-500">
                  O‘yinlar topilmadi
                </div>
              )}
            </div>
          )}

          {activeTab === 'device' && (
            <div className="max-w-2xl">
              <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-[#A3E635]" />
                Kompyuter Texnik Pasporti (HWID)
              </h2>
              <p className="text-xs text-gray-400 mb-6">
                Ushbu apparat raqamlari orqali har bir litsenziya faqat sizning kompyuteringizga qulflanadi va o‘g‘irlanishdan himoyalanadi.
              </p>

              {hwidInfo ? (
                <div className="space-y-4">
                  <div className="p-4 bg-[#141821] border border-[#2A3245] rounded-2xl">
                    <div className="text-xs text-gray-400 mb-1">Unikal SubGame HWID:</div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-base font-bold text-[#A3E635]">
                        {hwidInfo.formattedHwid}
                      </span>
                      <button
                        onClick={copyFullHwid}
                        className="px-3 py-1.5 rounded-lg bg-[#1A1F2A] hover:bg-[#2A3245] border border-[#2A3245] text-xs text-gray-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        {copiedHwid ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedHwid ? 'Nusxalandi' : 'Nusxalash'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-[#141821] border border-[#2A3245] rounded-xl">
                      <span className="text-gray-500 block mb-0.5">Ona plata UUID:</span>
                      <span className="font-mono text-gray-300 truncate block">
                        {hwidInfo.motherboardUuid}
                      </span>
                    </div>

                    <div className="p-3 bg-[#141821] border border-[#2A3245] rounded-xl">
                      <span className="text-gray-500 block mb-0.5">Protsessor ID:</span>
                      <span className="font-mono text-gray-300 truncate block">
                        {hwidInfo.processorId}
                      </span>
                    </div>

                    <div className="p-3 bg-[#141821] border border-[#2A3245] rounded-xl md:col-span-2">
                      <span className="text-gray-500 block mb-0.5">BIOS Seriya Raqami:</span>
                      <span className="font-mono text-gray-300 truncate block">
                        {hwidInfo.biosSerial}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-500">HWID aniqlanmoqda...</div>
              )}
            </div>
          )}

          {activeTab === 'about' && (
            <div className="max-w-2xl space-y-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#A3E635]" />
                SubGame Loyihasi
              </h2>
              <p className="text-xs text-gray-300 leading-relaxed">
                SubGame — O‘zbekiston geymerlari uchun sifatli, adabiy va professional darajadagi o‘yin subtitrlari va lokalizatsiyalarini yaratuvchi rasmiy platforma.
              </p>
              <div className="p-4 bg-[#141821] border border-[#2A3245] rounded-2xl space-y-2 text-xs">
                <div className="font-semibold text-[#A3E635] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  1 Qurilma = 1 Nusxa (DRM Himoya):
                </div>
                <div className="text-gray-400 leading-relaxed">
                  Har bir litsenziya xaridor kompyuterining ona platasi va protsessoriga biriktiriladi. Subtitr fayllari AES-256 shifrlangan bo‘lib, noqonuniy tarqalish va o‘g‘irlanishdan himoyalangan.
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Activation Modal */}
      {selectedGameForActivation && (
        <ActivationModal
          game={selectedGameForActivation}
          hwidFormatted={hwidInfo?.formattedHwid || 'SG-XXXX'}
          onClose={() => setSelectedGameForActivation(null)}
          onActivated={() => {
            loadData();
          }}
        />
      )}

      {/* Game Runner Modal */}
      {selectedGameForPlay && (
        <GameRunnerModal
          game={selectedGameForPlay}
          onClose={() => setSelectedGameForPlay(null)}
        />
      )}

      {/* Device Binding Loading Overlay */}
      {deviceBindingLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="p-6 rounded-2xl bg-[#141821] border border-[#2A3245] flex items-center gap-3 text-white text-sm font-semibold shadow-modal">
            <Loader2 className="w-5 h-5 text-[#A3E635] animate-spin" />
            <span>Qurilma (HWID) biriktirilmoqda...</span>
          </div>
        </div>
      )}

      {/* Device Mismatch Error Modal */}
      {deviceMismatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="bg-[#141821] border border-rose-500/40 rounded-2xl max-w-sm sm:max-w-md w-full p-6 text-center space-y-4 shadow-modal">
            <div className="w-14 h-14 rounded-full bg-rose-500/20 text-rose-500 flex items-center justify-center mx-auto">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-white">
              Qurilma mos kelmadi!
            </h3>
            <p className="text-xs text-gray-300 leading-relaxed">
              <strong>{deviceMismatchModal.gameTitle}</strong> litsenziyasi allaqachon boshqa kompyuterga bog‘langan.
            </p>
            <div className="p-3 rounded-xl bg-[#0B0D12] border border-[#2A3245] text-xs font-mono text-rose-400 flex items-center justify-center gap-2">
              <Laptop className="w-4 h-4 text-rose-400" />
              <span>Bog‘langan: {deviceMismatchModal.boundDevice}</span>
            </div>
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-left text-[11px] text-amber-300 leading-relaxed">
              SubGame xavfsizlik qoidalariga ko‘ra, har bir litsenziya faqat <strong>1 ta kompyuterda</strong> ishlaydi. Noqonuniy nusxalash taqiqlanadi!
            </div>
            <button
              onClick={() => setDeviceMismatchModal(null)}
              className="w-full py-2.5 rounded-xl bg-rose-500 text-white font-bold text-xs hover:bg-rose-600 transition-colors cursor-pointer"
            >
              Tushundim
            </button>
          </div>
        </div>
      )}

      {/* Device Pairing Modal */}
      {isPairing && pairingCode && (
        <DeviceConnectModal
          code={pairingCode}
          onClose={cancelDevicePairing}
          onOpenBrowser={() => openPairingInBrowser(pairingCode)}
        />
      )}

      {/* Launcher Auto-Update Modal */}
      {isUpdateModalOpen && updateData.latestInfo && (
        <UpdateModal
          currentVersion={updateData.currentVersion}
          latestInfo={updateData.latestInfo}
          isForceUpdate={updateData.isForceUpdate}
          onClose={() => {
            if (!updateData.isForceUpdate) {
              setIsUpdateModalOpen(false);
            }
          }}
        />
      )}

      {/* Update Toast Alert */}
      {updateToast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-2 duration-300">
          <div className="bg-[#141821] border border-[#2A3245] text-white px-4 py-3 rounded-xl shadow-modal flex items-center gap-2.5 text-xs">
            <CheckCircle2 className="w-4 h-4 text-[#A3E635] shrink-0" />
            <span>{updateToast}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
