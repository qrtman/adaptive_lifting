import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConflictReviewCardProps {
  entityType: string;
  field: string;
  serverValue: string;
  clientValue: string;
  onResolve: (action: 'force' | 'discard') => void;
}

export function ConflictReviewCard({
  entityType,
  field,
  serverValue,
  clientValue,
  onResolve,
}: ConflictReviewCardProps) {
  return (
    <div className="bg-transparent p-4 flex flex-col h-full font-sans overflow-hidden">
      {/* Header */}
      <div className="bg-red-500/10 px-4 py-3 border-b border-red-500/20 flex items-center gap-2">
        <AlertTriangle className="text-[#FF3B30] shrink-0" size={18} />
        <span className="font-bold text-white uppercase tracking-wider text-xs">
          Tombstone Conflict (409) — {entityType} {field}
        </span>
      </div>

      {/* Body Content */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Local changes */}
        <div className="bg-[#2C2C2E]/30 p-3 rounded border border-white/5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono text-[#AEAEB2] uppercase tracking-wider">Local Cache (Your Device)</span>
              <span className="text-[10px] bg-[#FF9500]/20 text-[#FF9500] px-1.5 py-0.5 rounded font-mono">PENDING</span>
            </div>
            <div className="space-y-1 font-mono text-xs">
              <p className="text-white">Value: <span className="text-[#FF9500] font-bold">{clientValue}</span></p>
              <p className="text-zinc-500 text-[11px]">Uncommitted local edit</p>
            </div>
          </div>
          <button
            onClick={() => onResolve('force')}
            className="mt-4 w-full py-2 bg-[#FF9500]/20 hover:bg-[#FF9500]/30 border border-[#FF9500]/30 hover:border-[#FF9500]/50 text-[#FF9500] rounded font-bold transition-all text-xs tracking-wider uppercase cursor-pointer"
          >
            Force Local Changes
          </button>
        </div>

        {/* Server state */}
        <div className="bg-[#2C2C2E]/30 p-3 rounded border border-white/5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono text-[#AEAEB2] uppercase tracking-wider">Server State (Database)</span>
              <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-mono">CANONICAL</span>
            </div>
            <div className="space-y-1 font-mono text-xs">
              <p className="text-white">Value: <span className="text-green-400 font-bold">{serverValue}</span></p>
              <p className="text-zinc-500 text-[11px]">Database canonical version</p>
            </div>
          </div>
          <button
            onClick={() => onResolve('discard')}
            className="mt-4 w-full py-2 bg-white/5 hover:bg-white/10 border border-white/15 hover:border-white/30 text-white rounded font-bold transition-all text-xs tracking-wider uppercase cursor-pointer"
          >
            Discard & Keep Server
          </button>
        </div>
      </div>
    </div>
  );
}
