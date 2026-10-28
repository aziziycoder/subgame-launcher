import React from 'react';
import { Play, Lock, CheckCircle2, ShieldCheck, Sparkles, Clock, Globe, ExternalLink } from 'lucide-react';
import { LauncherGame } from '../data/launcherGames';
import type { GameLicense } from '../types';

interface GameCardProps {
  game: LauncherGame;
  cloudLicense?: GameLicense;
  currentHwid?: string;
  isActivated: boolean;
  onActivate: (game: LauncherGame) => void;
  onPlay: (game: LauncherGame) => void;
}

export const GameCard: React.FC<GameCardProps> = ({
  game,
  cloudLicense,
  currentHwid,
  isActivated,
  onActivate,
  onPlay,
}) => {
  const handleOpenWebsite = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = `https://www.subgame.uz/games/${game.slug}`;
    if (window.subgame?.openExternal) {
      window.subgame.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="group relative bg-[#1A1F2A] rounded-xl border border-[#2A3245] hover:border-[#A3E635]/60 transition-all duration-300 hover:shadow-card-glow flex flex-col overflow-hidden">
      {/* Top Header Bar: Status Badge, Version & DRM status */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#141821] border-b border-[#2A3245]">
        <div className="flex items-center gap-1.5">
          {/* Status Badge */}
          {game.status === 'Tayyor' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#A3E635]/15 text-[#A3E635] border border-[#A3E635]/40 text-[11px] px-2 py-0.5 font-medium">
              <CheckCircle2 className="w-3 h-3 shrink-0" />
              <span>Tayyor</span>
            </span>
          )}
          {game.status === 'Jarayonda' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30 text-[11px] px-2 py-0.5 font-medium">
              <Sparkles className="w-3 h-3 shrink-0 animate-pulse" />
              <span>Jarayonda</span>
            </span>
          )}
          {game.status === 'Tez kunda' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[11px] px-2 py-0.5 font-medium">
              <Clock className="w-3 h-3 shrink-0 animate-pulse" />
              <span>Tez kunda</span>
            </span>
          )}

          {game.status === 'Tayyor' && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-[#A3E635] bg-[#0B0D12] px-1.5 py-0.5 rounded border border-[#A3E635]/30">
              <ShieldCheck className="w-2.5 h-2.5" />
              <span>{game.version}</span>
            </span>
          )}
        </div>

        {/* License status chip */}
        <div>
          {game.status !== 'Tayyor' ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <Clock className="w-2.5 h-2.5" />
              <span>Tez kunda</span>
            </span>
          ) : isActivated ? (
            !cloudLicense?.hwid ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40">
                <Clock className="w-2.5 h-2.5" /> 1-Qurilma
              </span>
            ) : cloudLicense.hwid === currentHwid ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                <CheckCircle2 className="w-2.5 h-2.5" /> Faol
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40">
                <Lock className="w-2.5 h-2.5" /> Boshqa PC
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
              <Lock className="w-2.5 h-2.5" /> Litsenziyasiz
            </span>
          )}
        </div>
      </div>

      {/* Media / Poster: Steam Header 460:215 ratio like website */}
      <div
        className="relative block w-full bg-[#0B0D12] overflow-hidden"
        style={{ aspectRatio: '460 / 215' }}
      >
        <img
          src={game.cardImage}
          alt={game.title}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            const attempt = parseInt(target.dataset.attempt || '0', 10);
            if (attempt === 0) {
              target.dataset.attempt = '1';
              if (game.fallbackImage && game.fallbackImage !== target.src) {
                target.src = game.fallbackImage;
              } else if (game.cover && game.cover !== target.src) {
                target.src = game.cover;
              } else {
                target.src = 'https://www.subgame.uz/images/logo_doppi.png';
              }
            } else if (attempt === 1) {
              target.dataset.attempt = '2';
              target.src = 'https://www.subgame.uz/images/logo_doppi.png';
            }
          }}
          className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1A1F2A] via-transparent to-transparent opacity-60" />
      </div>

      {/* Content */}
      <div className="p-3 sm:p-3.5 flex-1 flex flex-col justify-between">
        <div>
          {/* Release year and Developer */}
          <div className="flex items-center justify-between text-[11px] text-[#9CA3AF] mb-1">
            <span className="font-medium text-gray-300">{game.developer}</span>
            <span className="font-mono bg-[#141821] px-1.5 py-0.5 rounded border border-[#2A3245]">
              {game.releaseYear}
            </span>
          </div>

          {/* Title */}
          <h3 className="text-sm sm:text-base font-bold text-[#F5F7FA] group-hover:text-[#A3E635] transition-colors line-clamp-1">
            {game.title}
          </h3>

          {/* Description */}
          <p className="text-[11px] text-[#9CA3AF] mt-1 line-clamp-2 leading-relaxed">
            {game.description}
          </p>

          {/* Genres */}
          <div className="flex flex-wrap gap-1 mt-2">
            {game.genres.map((genre) => (
              <span
                key={genre}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[#141821] text-gray-300 border border-[#2A3245]"
              >
                {genre}
              </span>
            ))}
          </div>
        </div>

        {/* Footer info & Buttons */}
        <div className="pt-2.5 mt-2.5 border-t border-[#2A3245]/60 flex items-center justify-between gap-2">
          {/* Subtitle Price */}
          <div className="text-[11px] font-semibold text-gray-400 flex items-center gap-1">
            Narxi: <span className="text-[#A3E635] font-bold">{game.price || 'Bepul'}</span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Saytda ko'rish button */}
            <button
              onClick={handleOpenWebsite}
              title="Ushbu o'yinni sub-game.vercel.app saytida ochish"
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg bg-[#141821] text-gray-300 hover:text-white hover:bg-white/10 border border-[#2A3245] hover:border-gray-400 transition-all"
            >
              <Globe className="w-3 h-3 text-[#A3E635]" />
              <span className="hidden sm:inline">Saytda</span>
            </button>

            {/* Action button */}
            {game.status === 'Tayyor' ? (
              !isActivated ? (
                /* No license in user account: must acquire from website first */
                <button
                  onClick={handleOpenWebsite}
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-[#141821] text-[#A3E635] border border-[#A3E635]/40 hover:bg-[#A3E635]/15 transition-all hover:scale-105 cursor-pointer shadow-sm"
                  title="Saytga o‘tib litsenziyani faollashtiring yoki xarid qiling"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>{game.price && game.price !== 'Bepul' ? 'Sotib olish' : 'Saytdan olish'}</span>
                </button>
              ) : cloudLicense && cloudLicense.hwid && cloudLicense.hwid !== currentHwid ? (
                <button
                  onClick={() => onPlay(game)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/40 hover:bg-rose-500/25 transition-all cursor-pointer"
                  title="Ushbu o‘yin boshqa kompyuterga bog‘langan"
                >
                  <Lock className="w-2.5 h-2.5" />
                  <span>Boshqa PC</span>
                </button>
              ) : (
                <button
                  onClick={() => onPlay(game)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-[#A3E635] text-[#0B0D12] hover:bg-[#84CC16] shadow-sm shadow-[#A3E635]/25 transition-all hover:scale-105 cursor-pointer"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>O‘ynash</span>
                </button>
              )
            ) : (
              <button
                disabled
                className="text-[11px] px-2.5 py-1 rounded-lg bg-[#141821] text-gray-400 border border-[#2A3245] cursor-not-allowed font-medium"
              >
                {game.status === 'Jarayonda' ? 'Jarayonda' : 'Tez kunda'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
