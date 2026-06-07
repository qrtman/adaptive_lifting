import React from 'react';
import { Lock, Unlock } from 'lucide-react';

interface WorkoutLockBannerProps {
  holder: string;
  expiresAt: string;
  mode: 'locked_by_me' | 'locked_by_other' | 'expired' | 'completed';
  canRelease?: boolean;
  canReopen?: boolean;
  onRelease?: () => void;
  onReopen?: () => void;
  onRequestUnlock?: () => void;
}

export function WorkoutLockBanner({
  holder,
  expiresAt,
  mode,
  canRelease = false,
  canReopen = false,
  onRelease,
  onReopen,
  onRequestUnlock,
}: WorkoutLockBannerProps) {
  if (mode === 'expired') return null;

  return (
    <div className="bg-[#1A1110] border border-[#FF3B30]/30 rounded-lg p-4 h-full text-sm font-sans flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-[#FF3B30] shrink-0">
          <Lock size={16} />
        </div>
        <div>
          <h4 className="font-bold text-white uppercase tracking-wider text-xs flex items-center gap-1.5">
            Workout Session Locked
            {mode === 'locked_by_me' && <span className="text-[10px] lowercase font-normal bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded border border-green-500/20">locked by you</span>}
          </h4>
          <p className="text-[#AEAEB2] mt-2 text-xs">
            {mode === 'locked_by_me'
              ? `You hold the active lock for this session ${expiresAt && expiresAt !== 'undefined' ? `(expires in ${expiresAt})` : ''}`
              : mode === 'locked_by_other'
              ? `Coach ${holder} is currently designing your program (expires in ${expiresAt}).` 
              : mode === 'completed'
              ? `This workout has been completed and locked. Edits are disabled.`
              : `You hold the active lock for this session (expires in ${expiresAt}).`}
          </p>
          {mode === 'locked_by_other' && (
            <p className="text-[#FF453A]/80 text-[11px] font-bold mt-1">
              [!] ALL INPUTS LOCKED. You can view workouts, but edits are paused to prevent merge collisions.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {mode === 'locked_by_other' && onRequestUnlock && (
          <button
            onClick={onRequestUnlock}
            className="px-3 py-1.5 bg-[#FF3B30]/15 hover:bg-[#FF3B30]/25 border border-[#FF3B30]/30 hover:border-[#FF3B30]/50 text-[#FF3B30] text-xs font-bold rounded transition-all tracking-wider uppercase cursor-pointer"
          >
            Request Unlock
          </button>
        )}
        {mode === 'locked_by_me' && canRelease && onRelease && (
          <button
            onClick={onRelease}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/15 hover:border-white/30 text-white text-xs font-bold rounded transition-all tracking-wider uppercase flex items-center gap-1.5 cursor-pointer"
          >
            <Unlock size={12} />
            <span>Release Lock</span>
          </button>
        )}
        {mode === 'completed' && canReopen && onReopen && (
          <button
            onClick={onReopen}
            className="px-3 py-1.5 bg-mac-blue/15 hover:bg-mac-blue/25 border border-mac-blue/30 hover:border-mac-blue/50 text-mac-blue text-xs font-bold rounded transition-all tracking-wider uppercase flex items-center gap-1.5 cursor-pointer"
          >
            <Unlock size={12} />
            <span>Reopen Workout</span>
          </button>
        )}
      </div>
    </div>
  );
}
