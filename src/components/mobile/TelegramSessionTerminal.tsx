import React, { useState } from 'react';
import { RefreshCw, Volume2 } from 'lucide-react';
import { calculateE1RM } from '../../utils/mathUtils';

export default function TelegramSessionTerminal() {
  const [weight, setWeight] = useState(140);
  const [reps, setReps] = useState(5);
  const [rpe, setRpe] = useState(8);
  const [isLogged, setIsLogged] = useState(false);
  const [logs, setLogs] = useState<string[]>(['[System] Initialized Mini App sandbox.']);

  const triggerHaptic = (type: string) => {
    // Add to simulation logs
    setLogs(prev => [...prev, `[Haptic] Triggered vibration: ${type}`]);
  };

  const handleSave = () => {
    setIsLogged(true);
    triggerHaptic('Heavy Success Notification');
    setTimeout(() => {
      setIsLogged(false);
      setLogs(prev => [...prev, `[Queue] Set committed: ${weight}kg x ${reps} @ ${rpe}`]);
    }, 1500);
  };

  const currentE1RM = calculateE1RM(weight, reps, rpe);

  return (
    <div className="p-6 font-sans flex flex-col items-center justify-center min-h-[500px] text-gray-200">
      
      {/* Simulation Screen Bounding Box */}
      <div className="w-[360px] h-[640px] bg-[#0A0A0A] border-4 border-[#2C2C2E] rounded-[36px] overflow-hidden flex flex-col shadow-2xl relative">
        
        {/* iPhone Speaker & Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-[#2C2C2E] rounded-b-xl z-50 flex items-center justify-center gap-1.5">
          <div className="w-12 h-1 bg-black/40 rounded-full" />
          <div className="w-2.5 h-2.5 bg-black/40 rounded-full" />
        </div>

        {/* Telegram WebApp Header Bar */}
        <div className="pt-8 px-4 pb-3 bg-[#17212B] border-b border-black/20 shrink-0 flex items-center justify-between z-40">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-mac-blue flex items-center justify-center font-bold text-[10px] text-white">
              TG
            </div>
            <div className="flex flex-col justify-center">
              <h4 className="text-[11px] font-bold text-white leading-none mb-0.5">Obsidian Gym Logging</h4>
              <p className="text-[8px] text-zinc-400 leading-none">bot mini app companion</p>
            </div>
          </div>
          <button className="text-[10px] font-bold text-[#4F9CD8] hover:underline cursor-pointer pr-1">
            Close
          </button>
        </div>

        {/* Simulated WebApp Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0E1621] relative select-none">
          {/* Status Alert */}
          <div className="bg-[#182533] border border-white/5 rounded p-2.5 flex items-center justify-between text-[10px] font-mono">
            <span className="text-zinc-400">Environment:</span>
            <span className="text-mac-blue font-bold">TELEGRAM MINI APP</span>
          </div>

          {/* Active set card */}
          <div className="bg-[#202B36] border border-white/5 rounded-lg p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-black uppercase tracking-widest text-[#4F9CD8] font-mono">Active Set Logger</span>
              <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Low Bar Competition</span>
            </div>

            {/* Steppers */}
            <div className="space-y-4 pt-2">
              {/* Weight */}
              <div>
                <label className="text-[9px] font-mono uppercase text-zinc-400 tracking-wider block mb-1.5">Weight (kg)</label>
                <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded p-1">
                  <button 
                    onClick={() => { setWeight(prev => Math.max(0, prev - 2.5)); triggerHaptic('Light tap (-2.5)'); }}
                    className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded flex items-center justify-center text-sm font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <span className="text-sm font-black tabular-nums text-white flex-1 text-center">{weight} kg</span>
                  <button 
                    onClick={() => { setWeight(prev => prev + 2.5); triggerHaptic('Light tap (+2.5)'); }}
                    className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded flex items-center justify-center text-sm font-bold cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Reps */}
              <div>
                <label className="text-[9px] font-mono uppercase text-zinc-400 tracking-wider block mb-1.5">Reps (integers)</label>
                <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded p-1">
                  <button 
                    onClick={() => { setReps(prev => Math.max(1, prev - 1)); triggerHaptic('Light tap (-1)'); }}
                    className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded flex items-center justify-center text-sm font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <span className="text-sm font-black tabular-nums text-white flex-1 text-center">{reps} reps</span>
                  <button 
                    onClick={() => { setReps(prev => prev + 1); triggerHaptic('Light tap (+1)'); }}
                    className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded flex items-center justify-center text-sm font-bold cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* RPE */}
              <div>
                <label className="text-[9px] font-mono uppercase text-zinc-400 tracking-wider block mb-1.5">RPE (0.5 steps)</label>
                <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded p-1">
                  <button 
                    onClick={() => { setRpe(prev => Math.max(6, prev - 0.5)); triggerHaptic('Medium tick (-0.5)'); }}
                    className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded flex items-center justify-center text-sm font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <span className="text-sm font-black tabular-nums text-white flex-1 text-center">@ {rpe} RPE</span>
                  <button 
                    onClick={() => { setRpe(prev => Math.min(10, prev + 0.5)); triggerHaptic('Medium tick (+0.5)'); }}
                    className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded flex items-center justify-center text-sm font-bold cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Calculated e1RM Display */}
            <div className="bg-[#17212B] border border-white/5 rounded p-3 text-center mt-5">
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest block">RTS Brzycki e1RM Max</span>
              <span className="text-lg font-black text-[#4F9CD8] tabular-nums mt-0.5 block">
                {currentE1RM > 0 ? `${currentE1RM.toFixed(1)} kg` : '—'}
              </span>
            </div>

            {/* Commit Log button */}
            <button
              onClick={handleSave}
              disabled={isLogged}
              className="w-full py-3 bg-[#2481CC] hover:bg-[#2895E6] disabled:bg-green-500/20 text-white disabled:text-green-400 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer mt-8"
            >
              {isLogged ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Saving to local IndexedDB...</span>
                </>
              ) : (
                <span className="text-center w-full">LOG ACTIVE SESSION</span>
              )}
            </button>
          </div>
        </div>

        {/* Telegram WebApp Bottom Drawer Area */}
        <div className="h-10 bg-[#17212B] border-t border-black/20 shrink-0 flex items-center justify-center z-40">
          <div className="w-32 h-1 bg-white/20 rounded-full" />
        </div>
      </div>

      {/* Simulator Device Log Outputs */}
      <div className="w-[360px] mt-4 bg-[#111] border border-white/10 rounded-lg p-3 space-y-2">
        <h4 className="text-[10px] font-black text-white uppercase tracking-wider flex items-center gap-1">
          <Volume2 size={12} className="text-zinc-500" />
          <span>Haptic & Device telemetry feed</span>
        </h4>
        <div className="h-24 bg-black/40 rounded p-2 overflow-y-auto font-mono text-[9px] text-[#AEAEB2] space-y-1">
          {logs.map((log, idx) => (
            <div key={idx} className={log.includes('Haptic') ? 'text-[#FF9500]' : ''}>{log}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
