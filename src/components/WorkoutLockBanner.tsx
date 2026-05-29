import React from 'react';
import { Lock } from 'lucide-react';

interface WorkoutLockBannerProps {
  holderName: string;
  expiresAt: Date;
}

export const WorkoutLockBanner: React.FC<WorkoutLockBannerProps> = ({ holderName, expiresAt }) => {
  return (
    <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 mb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="bg-orange-500/20 p-2 rounded-lg">
          <Lock size={16} className="text-orange-500" />
        </div>
        <div>
          <h4 className="text-orange-400 font-bold text-sm uppercase tracking-widest leading-none mb-1">
            Read-Only Mode
          </h4>
          <p className="text-xs text-orange-200/70">
            Currently locked by {holderName}. Try again in {Math.ceil((expiresAt.getTime() - Date.now()) / 60000)}m.
          </p>
        </div>
      </div>
    </div>
  );
};
