import React from 'react';
import { Lock, X } from 'lucide-react';

interface WorkoutLockBannerProps {
  holderName?: string;
  expiresAt?: Date | null;
  message?: string;
  onDismiss?: () => void;
}

export const WorkoutLockBanner: React.FC<WorkoutLockBannerProps> = ({
  holderName,
  expiresAt,
  message,
  onDismiss,
}) => {
  const minutesLeft = expiresAt ? Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 60000)) : null;
  const body = message
    || (holderName
      ? `Currently locked by ${holderName}.${minutesLeft ? ` Try again in ${minutesLeft}m.` : ''}`
      : 'This workout is locked right now. Inputs stay read-only until the lock is released.');

  return (
    <div
      data-testid="workout-lock-banner"
      data-mode="other_writer"
      className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 mb-4 flex items-center justify-between gap-3"
    >
      <div className="flex items-center gap-3">
        <div className="bg-orange-500/20 p-2 rounded-lg">
          <Lock size={16} className="text-orange-500" />
        </div>
        <div>
          <h4 className="text-orange-400 font-bold text-sm uppercase tracking-widest leading-none mb-1">
            Read-only mode
          </h4>
          <p className="text-xs text-orange-200/70">
            {body}
          </p>
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          data-testid="workout-lock-dismiss"
          onClick={onDismiss}
          className="h-8 w-8 flex items-center justify-center text-orange-200/70 hover:text-white"
          aria-label="Dismiss lock notice"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
