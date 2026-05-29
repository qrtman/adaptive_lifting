import React from 'react';
import { AlertCircle, Check, X } from 'lucide-react';

interface ConflictReviewCardProps {
  entityType: string;
  field: string;
  serverValue: string;
  clientValue: string;
  onResolve: (action: 'keep_server' | 'force_client') => void;
}

export const ConflictReviewCard: React.FC<ConflictReviewCardProps> = ({
  entityType,
  field,
  serverValue,
  clientValue,
  onResolve
}) => {
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={20} />
        <div className="flex-1">
          <h4 className="text-red-400 font-bold text-sm uppercase tracking-widest mb-1">
            Sync Conflict Detected
          </h4>
          <p className="text-xs text-gray-300 mb-3 leading-relaxed">
            Another device modified the <span className="font-mono text-white">{field}</span> on this <span className="font-mono text-white">{entityType}</span>.
          </p>
          
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-black/40 rounded p-2 border border-white/5">
              <div className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Server (Current)</div>
              <div className="text-sm font-mono text-white break-all">{serverValue || '—'}</div>
            </div>
            <div className="bg-black/40 rounded p-2 border border-white/5">
              <div className="text-[10px] text-mac-blue uppercase font-bold tracking-widest mb-1">Your Edit</div>
              <div className="text-sm font-mono text-white break-all">{clientValue || '—'}</div>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={() => onResolve('keep_server')}
              className="flex items-center justify-center gap-1.5 flex-1 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold uppercase tracking-wider rounded transition-colors"
            >
              <Check size={14} /> Keep Server
            </button>
            <button 
              onClick={() => onResolve('force_client')}
              className="flex items-center justify-center gap-1.5 flex-1 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold uppercase tracking-wider rounded transition-colors"
            >
              <X size={14} /> Force Mine
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
