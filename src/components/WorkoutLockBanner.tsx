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
      className="bg-[color-mix(in_srgb,var(--cal-warning)_12%,var(--cal-surface-elevated))] border border-[color-mix(in_srgb,var(--cal-warning)_30%,transparent)] rounded-[var(--cal-radius-lg)] p-3 mb-4 flex items-center justify-between gap-3"
    >
      <div className="flex items-center gap-3">
        <div className="bg-[color-mix(in_srgb,var(--cal-warning)_20%,transparent)] p-2 rounded-[var(--cal-radius-md)]">
          <Lock size={16} className="text-[var(--cal-warning)]" />
        </div>
        <div>
          <h4 className="text-[var(--cal-warning)] font-semibold text-sm tracking-tight leading-none mb-1">
            Read-only mode
          </h4>
          <p className="text-xs tnum text-[var(--cal-body)]">
            {body}
          </p>
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          data-testid="workout-lock-dismiss"
          onClick={onDismiss}
          className="h-8 w-8 flex items-center justify-center text-[var(--cal-muted)] hover:text-[var(--cal-ink)]"
          aria-label="Dismiss lock notice"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
