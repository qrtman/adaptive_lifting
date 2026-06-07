import React, { useState } from 'react';
import { ShieldAlert, Copy, Check, Users, Sparkles, RefreshCw } from 'lucide-react';

interface Athlete {
  id: string;
  name: string;
  bw: number;
  dots: number;
  activeCycle: string;
  status: 'optimal' | 'fatigued' | 'caution';
  acwr: number;
  lastLogged: string;
}

interface CoachDashboardViewProps {
  activeAthleteId: string | null;
  setActiveAthleteId: (id: string) => void;
  onboardAthlete?: (name: string, email: string) => void;
}

export function CoachDashboardView({
  activeAthleteId,
  setActiveAthleteId,
}: CoachDashboardViewProps) {
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Sample data
  const athletes: Athlete[] = [
    { id: 'ath-1', name: 'John Doe', bw: 93.4, dots: 412.5, activeCycle: 'Alpha-09 Strength Phase', status: 'optimal', acwr: 1.12, lastLogged: 'Today, 10:15 AM' },
    { id: 'ath-2', name: 'Jane Smith', bw: 68.2, dots: 388.9, activeCycle: 'Beta-10 Peaking Cycle', status: 'caution', acwr: 1.42, lastLogged: 'Yesterday, 6:30 PM' },
    { id: 'ath-3', name: 'Mike Ross', bw: 104.8, dots: 425.1, activeCycle: 'Alpha-09 Strength Phase', status: 'fatigued', acwr: 1.65, lastLogged: '2 days ago' },
  ];

  const handleGenerateInvite = () => {
    setGenerating(true);
    setTimeout(() => {
      const randomCode = `OBSIDIAN-${Math.floor(1000 + Math.random() * 9000)}-INV`;
      setInviteCode(randomCode);
      setGenerating(false);
    }, 800);
  };

  const handleCopyInvite = () => {
    if (inviteCode) {
      navigator.clipboard.writeText(inviteCode);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500);
    }
  };

  return (
    <div className="p-6 font-sans space-y-6 overflow-y-auto h-full text-sm">
      {/* Upper Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Active Athlete Roster Panel */}
        <div className="lg:col-span-2 bg-[#111] border border-white/10 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
              <Users size={16} className="text-mac-blue" />
              <span>Active Athletes Roster</span>
            </h3>
            <span className="text-[10px] font-mono bg-white/5 border border-white/10 text-zinc-400 px-2 py-0.5 rounded uppercase">
              {athletes.length} Athletes linked
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-white/10 text-zinc-500 uppercase text-[9px] tracking-widest">
                  <th className="pb-3">Athlete</th>
                  <th className="pb-3 text-right">BW (kg)</th>
                  <th className="pb-3 text-right">DOTS</th>
                  <th className="pb-3 text-left pl-4">Current Mesocycle</th>
                  <th className="pb-3 text-center">ACWR</th>
                  <th className="pb-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {athletes.map((ath) => {
                  const isActive = activeAthleteId === ath.id;
                  return (
                    <tr 
                      key={ath.id}
                      onClick={() => setActiveAthleteId(ath.id)}
                      className={`hover:bg-white/2 cursor-pointer transition-colors ${
                        isActive ? 'bg-white/5 border-l-2 border-mac-blue' : ''
                      }`}
                    >
                      <td className="py-3 pr-2">
                        <div className="font-bold text-white text-xs">{ath.name}</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">Logged: {ath.lastLogged}</div>
                      </td>
                      <td className="py-3 text-right text-gray-300 tabular-nums">{ath.bw.toFixed(1)}</td>
                      <td className="py-3 text-right text-gray-300 tabular-nums">{ath.dots.toFixed(1)}</td>
                      <td className="py-3 text-left pl-4 text-[#AEAEB2] truncate max-w-[150px]">
                        {ath.activeCycle}
                      </td>
                      <td className={`py-3 text-center font-bold tabular-nums ${
                        ath.acwr > 1.5 ? 'text-[#FF453A]' : ath.acwr > 1.3 ? 'text-[#FF9500]' : 'text-[#34C759]'
                      }`}>
                        {ath.acwr.toFixed(2)}
                      </td>
                      <td className="py-3 text-center">
                        <span className={`inline-block text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                          ath.status === 'optimal'
                            ? 'bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/20'
                            : ath.status === 'caution'
                            ? 'bg-[#FF9500]/10 text-[#FF9500] border border-[#FF9500]/20'
                            : 'bg-[#FF453A]/10 text-[#FF453A] border border-[#FF453A]/20'
                        }`}>
                          {ath.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Invite Generator Card (Required by design.md Section 8.3.1) */}
        <div className="bg-[#111] border border-white/10 rounded-lg p-5 flex flex-col justify-between h-[200px]">
          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles size={14} className="text-[#FF9500]" />
              <span>Athlete Invite Linker</span>
            </h3>
            <p className="text-[11px] text-zinc-500 font-mono uppercase tracking-widest mt-1">
              Onboard new lifters to roster
            </p>
          </div>

          <div className="bg-black/30 border border-white/5 rounded p-2.5 flex items-center justify-between font-mono text-xs">
            {generating ? (
              <span className="text-zinc-500 animate-pulse flex items-center gap-1.5">
                <RefreshCw size={12} className="animate-spin" />
                Encrypting Token...
              </span>
            ) : inviteCode ? (
              <span className="text-white font-bold">{inviteCode}</span>
            ) : (
              <span className="text-zinc-600">No active link</span>
            )}
            {inviteCode && (
              <button 
                onClick={handleCopyInvite}
                className="text-gray-400 hover:text-white p-1 hover:bg-white/5 rounded cursor-pointer"
              >
                {isCopied ? <Check size={14} className="text-[#34C759]" /> : <Copy size={14} />}
              </button>
            )}
          </div>

          <button
            onClick={handleGenerateInvite}
            className="w-full py-2 bg-mac-blue hover:bg-blue-600 text-white rounded text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-[0_0_15px_rgba(0,122,255,0.4)]"
          >
            Generate Link Token
          </button>
        </div>
      </div>

      {/* Roster Alerts & Compliance Deck */}
      <div className="bg-[#111] border border-white/10 rounded-lg p-5">
        <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2 mb-4">
          <ShieldAlert size={14} className="text-[#FF453A]" />
          <span>Lifting Compliance & Readiness Alerts</span>
        </h3>

        <div className="space-y-2 font-mono text-xs">
          <div className="flex items-center justify-between p-3 bg-[#FF453A]/10 border border-[#FF453A]/20 rounded">
            <div className="flex items-center gap-2.5">
              <span className="font-bold text-[#FF453A]">FATIGUE EXCEEDED:</span>
              <span className="text-white">Mike Ross has hit a rolling ACWR of 1.65 (Danger threshold &gt; 1.5).</span>
            </div>
            <button className="text-[10px] uppercase font-bold text-[#FF453A] hover:underline cursor-pointer">Adjust program</button>
          </div>

          <div className="flex items-center justify-between p-3 bg-[#FF9500]/10 border border-[#FF9500]/20 rounded">
            <div className="flex items-center gap-2.5">
              <span className="font-bold text-[#FF9500]">OVERREACHING:</span>
              <span className="text-white">Jane Smith logged paused squats at RPE 9.5 (Prescribed RPE 8.0).</span>
            </div>
            <button className="text-[10px] uppercase font-bold text-[#FF9500] hover:underline cursor-pointer">View Set Log</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const SampleDefault = () => {
  const [activeId, setActiveId] = useState<string | null>('ath-1');
  return (
    <CoachDashboardView 
      activeAthleteId={activeId}
      setActiveAthleteId={setActiveId}
    />
  );
};
