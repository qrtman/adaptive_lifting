import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, EyeOff, LayoutGrid } from 'lucide-react';
import { useAgentMutation } from '../contexts/AgentProvider';

const VisionWrapper = ({ children, visionMode, className, visionClassName, roleLabel, id, style }: any) => {
  return (
    <div className={`${className} ${visionMode ? `relative ${visionClassName} border-2 border-dashed border-[#54e083]/40 bg-[#54e083]/5` : ''}`} style={style}>
      {children}
      {visionMode && (
        <div className="absolute -top-3 -left-2 bg-black text-white px-1.5 py-0.5 text-[8px] font-mono border border-white/20 rounded z-50 whitespace-nowrap opacity-100 shadow-xl pointer-events-none">
          <span className="text-[#54e083] font-bold">{roleLabel}</span> <span className="text-zinc-400">[{id}]</span>
        </div>
      )}
    </div>
  );
};

export const DashboardPlaceholders: React.FC = () => {
  const [visionMode, setVisionMode] = useState(false);
  
  const workspaceMutations = useAgentMutation('agent-workspace');
  const dayMutations = useAgentMutation('day-cell');
  const sessionMutations = useAgentMutation('session-block');

  const week = {
    id: 'wk-m2',
    name: 'MESO_02 • MICRO_01 (Accumulation)',
    days: Array.from({ length: 7 }).map((_, d) => ({
      id: `day-0${d + 1}`,
      date: `DAY 0${d + 1}`,
      isRest: d === 2 || d === 4 || d === 6,
      sessions: (d === 2 || d === 4 || d === 6) ? [] : [
        {
          id: `sess-${d}-1`,
          name: d === 0 ? 'SQUAT DOMINANT' : d === 1 ? 'H. PUSH' : d === 3 ? 'HINGE/PULL' : 'ACC FLOW',
          exercises: [
            {
              id: `ex-${d}-sq`,
              name: 'Primary Main Lift',
              sets: Array.from({ length: 3 }).map((_, s) => ({
                id: `set-${d}-${s}`, weight: '140.0kg', reps: 5, rpe: '8.0'
              }))
            },
            {
              id: `ex-${d}-acc`,
              name: 'Secondary Volume',
              sets: Array.from({ length: 2 }).map((_, s) => ({
                id: `set-acc-${d}-${s}`, weight: '90.0kg', reps: 8, rpe: '7.5'
              }))
            }
          ]
        }
      ]
    }))
  };

  return (
    <div className={`w-full min-h-full p-4 sm:p-8 md:p-12 lg:p-20 overflow-y-auto flex flex-col items-center ${visionMode ? 'bg-[#050505]' : 'bg-[#030303]'}`}>
      <div className="w-full max-w-[1600px] flex flex-col relative overflow-hidden transition-all duration-700">
        
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#54e083]/5 rounded-full blur-[150px] pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-10 gap-6 relative z-10 w-full px-4">
           <div className="flex flex-col items-start">
             <h2 className="text-3xl md:text-4xl font-black text-white tracking-tighter uppercase mb-2 flex items-center gap-3">
                Agent Workspace
                <span className="px-2 py-0.5 rounded text-[10px] bg-[#54e083]/20 text-[#54e083] tracking-widest font-mono shadow-[0_0_15px_rgba(84,224,131,0.2)]">BENTO GRID</span>
             </h2>
             <p className="text-[#AEAEB2] font-mono text-xs uppercase tracking-widest max-w-md border-l-2 border-[#54e083]/50 pl-3">
               Brain Loop Active. Complex masonry architecture rendered.
             </p>
           </div>
           
           <button 
             onClick={() => setVisionMode(!visionMode)}
             className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-xs font-bold uppercase tracking-wider cursor-pointer border transition-all duration-300 shadow-xl ${
               visionMode ? 'bg-[#54e083] text-black border-[#54e083] shadow-[#54e083]/20 scale-105' 
                          : 'bg-zinc-900 text-white border-white/5 hover:bg-zinc-800'
             }`}
           >
             {visionMode ? <LayoutGrid size={18} /> : <Eye size={18} />}
             Vision: {visionMode ? 'ON' : 'OFF'}
           </button>
        </div>

        <div className="w-full relative z-10">
          <VisionWrapper id={week.id} roleLabel="WeekGrid" visionMode={visionMode} className="w-full" visionClassName="p-2 rounded-3xl">
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 auto-rows-min" style={workspaceMutations}>
              {/* Header Tile */}
              <div className="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-4 bg-zinc-900/40 backdrop-blur-md border border-white/5 rounded-3xl p-6 flex items-center justify-between shadow-2xl">
                 <span className="text-lg font-black text-white uppercase tracking-widest">{week.name}</span>
                 <span className="text-[10px] text-[#54e083] font-mono tracking-widest border border-[#54e083]/30 px-3 py-1 rounded-full">ID: {week.id}</span>
              </div>

              {week.days.map((day: any, idx: number) => {
                // Bento logic: Training days are tall and wide, Rest days are small tiles
                const isTall = !day.isRest;
                const bentoSpan = isTall ? 'col-span-1 md:col-span-2 row-span-2' : 'col-span-1 row-span-1';

                return (
                  <VisionWrapper 
                    key={day.id} 
                    id={day.id} 
                    roleLabel="DayTile" 
                    visionMode={visionMode} 
                    style={dayMutations}
                    className={`${bentoSpan} bg-zinc-900/60 backdrop-blur-xl border border-white/5 rounded-3xl p-6 flex flex-col shadow-2xl transition-all duration-500 hover:border-white/10 group`} 
                    visionClassName="shadow-lg"
                  >
                    <div className="flex items-center justify-between mb-6">
                      <div className="text-sm font-black text-zinc-100 uppercase tracking-widest group-hover:text-[#54e083] transition-colors">
                        {day.date}
                      </div>
                      {day.isRest && (
                        <div className="text-[10px] font-black text-zinc-500 bg-zinc-800/50 px-3 py-1 rounded-full uppercase tracking-widest">Rest</div>
                      )}
                    </div>

                    <div className="flex-1 overflow-hidden" style={sessionMutations}>
                      <AnimatePresence>
                        {!day.isRest && day.sessions.map((sess: any) => (
                          <VisionWrapper 
                            key={sess.id} 
                            id={sess.id} 
                            roleLabel="SessionGlass" 
                            visionMode={visionMode} 
                            className="h-full flex flex-col gap-4"
                            visionClassName="p-2 bg-black/20 rounded-xl"
                          >
                            <div className="text-xs font-bold text-mac-blue bg-mac-blue/10 px-3 py-1.5 rounded-lg inline-flex w-max shadow-sm">
                              {sess.name}
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1">
                              {sess.exercises.map((ex: any) => (
                                <VisionWrapper 
                                  key={ex.id} 
                                  id={ex.id} 
                                  roleLabel="ExTile" 
                                  visionMode={visionMode} 
                                  className="bg-black/40 rounded-2xl p-4 border border-white/[0.02]"
                                  visionClassName="ring-1 ring-white/10"
                                >
                                  <div className="text-[11px] font-black text-white mb-4 uppercase tracking-wider opacity-80">
                                    {ex.name}
                                  </div>
                                  <div className="flex flex-col gap-2">
                                    <AnimatePresence>
                                      {ex.sets.map((set: any, i: number) => (
                                        <motion.div 
                                          key={set.id}
                                          initial={{ opacity: 0, x: -10 }}
                                          animate={{ opacity: 1, x: 0 }}
                                          transition={{ delay: i * 0.1 }}
                                        >
                                          <VisionWrapper 
                                            id={set.id} 
                                            roleLabel="SetRow" 
                                            visionMode={visionMode}
                                            className="flex items-center justify-between text-[11px] font-mono p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                                          >
                                            <span className="text-zinc-500 font-bold">S{i + 1}</span>
                                            <span className="text-white font-semibold tracking-wider">{set.weight} <span className="text-zinc-600 px-1">×</span> {set.reps}</span>
                                            <span className="text-amber-400/90 bg-amber-400/10 px-2 py-0.5 rounded shadow-sm">RPE {set.rpe}</span>
                                          </VisionWrapper>
                                        </motion.div>
                                      ))}
                                    </AnimatePresence>
                                  </div>
                                </VisionWrapper>
                              ))}
                            </div>
                          </VisionWrapper>
                        ))}
                      </AnimatePresence>
                    </div>
                  </VisionWrapper>
                );
              })}
            </div>

          </VisionWrapper>
        </div>
      </div>
    </div>
  );
};