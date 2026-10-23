import React, { useState } from 'react';
import { KeyRound, ShieldCheck, AlertCircle, X, CheckCircle2 } from 'lucide-react';
import { LauncherGame } from '../data/launcherGames';

interface ActivationModalProps {
  game: LauncherGame;
  hwidFormatted: string;
  onClose: () => void;
  onActivated: () => void;
}

export const ActivationModal: React.FC<ActivationModalProps> = ({
  game,
  hwidFormatted,
  onClose,
  onActivated,
}) => {
  const [keyInput, setKeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) {
      setError('Iltimos, litsenziya kalitini kiriting!');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await window.subgame?.activateLicense(keyInput.trim(), game.title);
      if (res?.success) {
        setSuccess(res.message);
        setTimeout(() => {
          onActivated();
          onClose();
        }, 1800);
      } else {
        setError(res?.message || 'Kalit noto\'g\'ri yoki ushbu o\'yinga mos kelmadi.');
      }
    } catch (err: any) {
      setError(err?.message || 'Faollashtirishda kutilmagan xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-lg bg-[#1A1F2A] border border-[#2A3245] rounded-2xl shadow-modal p-6 overflow-hidden">
        {/* Glow ambient background */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#A3E635]/15 rounded-full blur-3xl pointer-events-none" />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3.5 mb-5">
          <div className="w-12 h-12 rounded-xl bg-[#A3E635]/15 border border-[#A3E635]/30 flex items-center justify-center text-[#A3E635]">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[#F5F7FA]">{game.title}</h3>
            <p className="text-xs text-gray-400">1 qurilma = 1 litsenziya himoyalangan faollashtirish</p>
          </div>
        </div>

        {/* HWID Binding Alert */}
        <div className="bg-[#141821] border border-[#2A3245] rounded-xl p-3.5 mb-5 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-[#A3E635] shrink-0 mt-0.5" />
          <div className="text-xs">
            <div className="text-gray-200 font-semibold mb-0.5">Qurilmaga bog‘lanish (Hardware Lock):</div>
            <div className="text-gray-400 leading-relaxed">
              Kalit faqat ushbu kompyuterga (<span className="text-[#A3E635] font-mono font-bold">{hwidFormatted}</span>) biriktiriladi va boshqa qurilmalarda ishlamaydi.
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleActivate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
              Litsenziya Kaliti (Format: {game.keyPrefix}-XXXX-XXXX)
            </label>
            <input
              type="text"
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value.toUpperCase());
                setError(null);
              }}
              placeholder={`${game.keyPrefix}-8492-XK91`}
              className="w-full px-4 py-3 bg-[#0B0D12] border border-[#2A3245] rounded-xl text-[#A3E635] font-mono text-center font-bold tracking-widest text-base focus:outline-none focus:border-[#A3E635] focus:ring-1 focus:ring-[#A3E635] transition-all placeholder:text-gray-600 uppercase"
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{success}</span>
            </div>
          )}

          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl bg-[#141821] hover:bg-white/10 text-gray-300 text-sm font-semibold border border-[#2A3245] transition-all"
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              disabled={loading || !!success}
              className="flex-1 py-3 px-4 rounded-xl bg-[#A3E635] hover:bg-[#84CC16] text-[#0B0D12] text-sm font-extrabold shadow-sm shadow-[#A3E635]/30 transition-all disabled:opacity-50"
            >
              {loading ? 'Tekshirilmoqda...' : 'Faollashtirish'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
