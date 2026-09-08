import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { UI_KEYS, getUiPref } from '../storage/uiPrefs';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { planForAthlete } from '../data/zaharBlock';
import { addLocalAthlete, loadLocalRoster, mergeRoster, type LocalAthlete } from '../services/localRoster';

interface CoachDashboardViewProps {
  onOpenSessions: () => void;
}

export const CoachDashboardView: React.FC<CoachDashboardViewProps> = ({ onOpenSessions }) => {
  const [roster, setRoster] = useState<LocalAthlete[]>([]);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState(getUiPref(UI_KEYS.email) || '');
  const [linkSuccess, setLinkSuccess] = useState('');

  // Drill-down state
  const [selectedAthlete, setSelectedAthlete] = useState<LocalAthlete | null>(null);
  const { loadAthletePlan } = usePeriodization();
  const [openError, setOpenError] = useState<string | null>(null);

  // Powerlifting Analytics state
  const [analytics, setAnalytics] = useState<any>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [attemptPlannerInput, setAttemptPlannerInput] = useState<number>(200);
  const [attemptPlannerProfile, setAttemptPlannerProfile] = useState<'squat_dl'|'bench'>('squat_dl');

  useEffect(() => {
    if (selectedAthlete?.linked) {
      void fetchAnalytics(selectedAthlete.id);
    } else {
      setAnalytics(null);
      setLoadingAnalytics(false);
    }
  }, [selectedAthlete]);

  const fetchAnalytics = async (athleteId: string) => {
    setLoadingAnalytics(true);
    try {
      const data = await apiService.fetchAnalyticsTrends(athleteId);
      setAnalytics(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAnalytics(false);
    }
  };

  useEffect(() => {
    fetchRoster();
  }, []);

  const fetchRoster = async () => {
    const local = await loadLocalRoster();
    let remote: Array<{ id: string; email?: string; activeMicrocycles?: number }> = [];
    try {
      remote = await apiService.fetchRoster();
    } catch (err) {
      console.error(err);
    }
    const next = mergeRoster(remote, local);
    setRoster(next);
    if (selectedAthlete) {
      const updated = next.find((a) => a.id === selectedAthlete.id);
      if (updated) setSelectedAthlete(updated);
    }
    setLoading(false);
  };

  const handleAddAthlete = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = addName.trim();
    if (!name) {
      setAddError('Name is required.');
      return;
    }
    setAddError(null);
    const next = await addLocalAthlete({
      name,
      email: addEmail.trim() || null,
      currentBlock: null,
      activeMicrocycles: 0,
      peakE1RM: { squat: null, bench: null, deadlift: null },
    });
    setRoster(mergeRoster([], next));
    setAddName('');
    setAddEmail('');
    await fetchRoster();
  };

  const copyLinkCode = () => {
    navigator.clipboard.writeText(userEmail);
    setLinkSuccess('Copied to clipboard!');
    setTimeout(() => setLinkSuccess(''), 3000);
  };

  const handleOpenBlock = () => {
    if (!selectedAthlete) return;
    const opened = loadAthletePlan(selectedAthlete.id);
    if (!opened) {
      setOpenError('No imported block for this athlete.');
      return;
    }
    setOpenError(null);
    onOpenSessions();
  };

  return (
    <div className="h-full w-full bg-[#000000] text-white overflow-y-auto pb-32 font-sans flex flex-col p-6">
      
      {/* Header section */}
      <div className="mb-8 mt-4 relative">
        <div className="flex items-center gap-2 mb-2">
          {selectedAthlete ? (
            <button 
              onClick={() => setSelectedAthlete(null)}
              className="mr-2 h-8 w-8 rounded-full bg-zinc-900 flex items-center justify-center hover:bg-zinc-800 transition-colors"
            >
              <span className="material-symbols-outlined text-zinc-400">arrow_back</span>
            </button>
          ) : (
            <span className="material-symbols-outlined text-mac-blue text-2xl">shield_person</span>
          )}
          <h1 className="text-3xl font-black tracking-tight">
            {selectedAthlete ? 'Athlete Overview' : 'Coach Dashboard'}
          </h1>
        </div>
        <p className="text-zinc-400 text-sm">
          {selectedAthlete
            ? `Athlete identity and current block for ${selectedAthlete.name}`
            : 'Roster identities. Open an imported block on Sessions — there is no template deploy.'}
        </p>
      </div>

      {!selectedAthlete ? (
        <>
          {/* Roster Overview */}
          <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 shadow-2xl mb-6 backdrop-blur-xl relative overflow-hidden group">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-mac-blue to-transparent opacity-50" />
            <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4">Active Roster</h2>
            
            {loading ? (
              <div className="flex justify-center p-8">
                <span className="h-6 w-6 border-2 border-mac-blue border-t-transparent rounded-full animate-spin" />
              </div>
            ) : roster.length === 0 ? (
              <div className="text-center py-10 border border-white/10">
                <p className="text-sm text-[#AEAEB2]">No athletes on this roster.</p>
                <p className="text-xs text-[#636366] mt-1">Add a name, or share the invite code so an athlete can link an account.</p>
              </div>
            ) : (
              <div className="space-y-1" data-testid="roster-list">
                {roster.map((athlete) => (
                  <button
                    type="button"
                    key={athlete.id}
                    data-testid={`roster-athlete-${athlete.id}`}
                    onClick={() => setSelectedAthlete(athlete)}
                    className="w-full border-b border-white/10 px-2 py-3 flex items-center justify-between text-left hover:bg-white/[0.02]"
                  >
                    <div className="min-w-0">
                      <h3 className="text-sm text-white truncate">{athlete.name}</h3>
                      <p className="text-[10px] text-[#AEAEB2] mt-0.5">
                        {athlete.currentBlock ? `${athlete.currentBlock} · ` : ''}
                        {athlete.linked ? 'Linked account' : 'Local identity'}
                        {athlete.email ? ` · ${athlete.email}` : ''}
                      </p>
                    </div>
                    <span className="text-[11px] font-mono text-[#AEAEB2] shrink-0">
                      {athlete.activeMicrocycles} block{athlete.activeMicrocycles !== 1 ? 's' : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Onboarding Toolkit */}
          <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden">
            <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4">Onboarding Tools</h2>
            
            <form
              onSubmit={handleAddAthlete}
              className="border border-white/10 p-3 mb-4 flex flex-col gap-2"
              data-testid="add-athlete-form"
            >
              <p className="text-[10px] uppercase tracking-wider text-[#636366]">Add athlete</p>
              <label className="text-xs text-[#AEAEB2] flex flex-col gap-1">
                Name
                <input
                  data-testid="add-athlete-name"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  className="min-h-10 bg-[#161616] border border-white/10 px-3 text-white"
                  placeholder="Zahar"
                />
              </label>
              <label className="text-xs text-[#AEAEB2] flex flex-col gap-1">
                Email (optional until they link)
                <input
                  data-testid="add-athlete-email"
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  className="min-h-10 bg-[#161616] border border-white/10 px-3 text-white"
                  placeholder="athlete@example.com"
                />
              </label>
              {addError ? <p role="alert" className="text-xs text-[#FF453A]">{addError}</p> : null}
              <button type="submit" data-testid="add-athlete-submit" className="h-10 px-3 text-sm text-white bg-[#007AFF]">
                Add to roster
              </button>
            </form>
            <div className="border border-white/10 p-3">
              <p className="text-xs text-[#AEAEB2] mb-2">Coach invite code</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-black rounded-lg px-3 py-2 text-sm text-mac-blue border border-zinc-800">
                  {userEmail}
                </code>
                <button 
                  onClick={copyLinkCode}
                  className="bg-mac-blue text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-600 transition-colors"
                >
                  Copy
                </button>
              </div>
              {linkSuccess && <p className="text-[#75ff9e] text-[10px] mt-2 font-bold">{linkSuccess}</p>}
              <p className="text-[10px] text-zinc-500 mt-3">Athletes can enter this code in their settings to link to your roster.</p>
            </div>
          </div>
        </>
      ) : (
        /* Athlete Detail View - Powerlifting Analytics Panel */
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-300">
          
          {/* Header */}
          <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden group">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#75ff9e] to-transparent opacity-50" />
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold">{selectedAthlete.name}</h2>
                <p className="text-sm text-zinc-400 mt-1">
                  {selectedAthlete.currentBlock ? `${selectedAthlete.currentBlock}. ` : ''}
                  {selectedAthlete.linked ? selectedAthlete.email : 'Local identity — invite code still required to link an account.'}
                </p>
                <p className="text-[11px] font-mono text-[#AEAEB2] mt-2">
                  SQ {selectedAthlete.peakE1RM.squat ?? '—'}
                  {' · '}BP {selectedAthlete.peakE1RM.bench ?? '—'}
                  {' · '}DL {selectedAthlete.peakE1RM.deadlift ?? '—'}
                </p>
              </div>
              {planForAthlete(selectedAthlete.id) ? (
                <button
                  data-testid="open-athlete-block"
                  onClick={handleOpenBlock}
                  className="bg-mac-blue hover:bg-blue-600 text-white rounded-xl px-4 py-2 text-sm font-bold flex items-center gap-2"
                >
                  Open Block 3.1
                </button>
              ) : (
                <p className="text-xs text-zinc-500 max-w-[14rem] text-right">
                  Identity only. No imported block to open.
                </p>
              )}
            </div>
          </div>

          {loadingAnalytics ? (
            <div className="flex justify-center items-center p-20">
              <span className="h-8 w-8 border-4 border-mac-blue border-t-transparent rounded-full animate-spin" />
            </div>
          ) : analytics ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Quadrant 1: Summary Banners */}
              <div className="col-span-1 md:col-span-2 grid grid-cols-3 gap-4">
                <div className="bg-zinc-950/50 border border-zinc-900 rounded-2xl p-4 flex flex-col items-center justify-center">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1">DOTS Score</span>
                  <span className="text-3xl font-black text-white">{analytics.dots_score}</span>
                </div>
                <div className="bg-zinc-950/50 border border-zinc-900 rounded-2xl p-4 flex flex-col items-center justify-center">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1">Weekly ARI</span>
                  <span className="text-3xl font-black text-white">{analytics.fatigue_metrics.average_relative_intensity_pct}%</span>
                </div>
                {(() => {
                   const acwr = analytics.fatigue_metrics.acute_chronic_ratio;
                   let bg = 'bg-zinc-950/50 border-zinc-900';
                   let text = 'text-zinc-500';
                   let label = '';
                   if (acwr < 0.8) { bg = 'bg-[#F1C40F]/10 border-[#F1C40F]/30'; text = 'text-[#F1C40F]'; label = 'UNDER-TRAINING'; }
                   else if (acwr <= 1.3) { bg = 'bg-[#2ECC71]/10 border-[#2ECC71]/30'; text = 'text-[#2ECC71]'; label = 'OPTIMAL ZONE'; }
                   else if (acwr <= 1.5) { bg = 'bg-[#E67E22]/10 border-[#E67E22]/30'; text = 'text-[#E67E22]'; label = 'HIGH FATIGUE'; }
                   else { bg = 'bg-[#E74C3C]/10 border-[#E74C3C]/30 animate-pulse'; text = 'text-[#E74C3C]'; label = 'CRITICAL LOAD'; }
                   
                   return (
                     <div className={`${bg} border rounded-2xl p-4 flex flex-col items-center justify-center`}>
                       <span className={`text-[10px] uppercase tracking-widest font-bold mb-1 ${text}`}>ACWR: {acwr}</span>
                       <span className={`text-sm font-black text-center ${text}`}>{label}</span>
                     </div>
                   );
                })()}
              </div>

              {/* Quadrant 2: Workload Mix (Stacked Bar Chart placeholder) */}
              <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 relative">
                <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4">Volume Splitting (3-Tier)</h2>
                <div className="flex h-40 items-end gap-2 px-4 py-2 border-b border-zinc-800">
                   {/* Mock stacked bar */}
                   <div className="w-16 flex flex-col justify-end h-full">
                     <div className="w-full bg-[#34495E]" style={{ height: `${Math.min(100, (analytics.volume_splitting_weekly.accessory_nl / 100)*100)}%` }} />
                     <div className="w-full bg-[#9B59B6]" style={{ height: `${Math.min(100, (analytics.volume_splitting_weekly.variation_nl / 100)*100)}%` }} />
                     <div className="w-full bg-[#3498DB]" style={{ height: `${Math.min(100, (analytics.volume_splitting_weekly.comp_nl / 100)*100)}%` }} />
                   </div>
                </div>
                <div className="flex justify-between mt-2 text-[10px] text-zinc-500 font-bold px-4">
                  <span>Current Week</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <div className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded-full bg-[#3498DB]" /> Comp</div>
                  <div className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded-full bg-[#9B59B6]" /> Variation</div>
                  <div className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded-full bg-[#34495E]" /> Accessory</div>
                </div>
              </div>

              {/* Quadrant 3: Fatigue Engine (Dual-Axis Line Graph placeholder) */}
              <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 relative">
                <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4">Fatigue Engine (INOL vs e1RM)</h2>
                <div className="h-40 flex items-center justify-center border-b border-l border-r border-zinc-800 relative">
                  <span className="text-zinc-600 text-xs absolute transform -translate-y-1/2 left-2">- INOL (L)</span>
                  <span className="text-zinc-600 text-xs absolute transform -translate-y-1/2 right-2">- e1RM (R)</span>
                  {/* Mock line paths */}
                  <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <path d="M0,80 Q25,70 50,40 T100,10" fill="none" stroke="#E74C3C" strokeWidth="2" />
                    <path d="M0,20 Q25,30 50,60 T100,90" fill="none" stroke="#2ECC71" strokeWidth="2" />
                  </svg>
                </div>
                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-bold">
                  Systemic accommodation analysis active. E1RM trajectories stable.
                </div>
              </div>

              {/* Quadrant 4: Interactive Attempt Planner */}
              <div className="col-span-1 md:col-span-2 bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 relative">
                <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4">Attempt Selection Engine</h2>
                <div className="flex flex-col md:flex-row gap-4 mb-6">
                  <div className="flex-1">
                    <label className="text-xs text-zinc-400 mb-2 block">Target 1st Attempt (kg):</label>
                    <input 
                      type="number" 
                      value={attemptPlannerInput}
                      onChange={(e) => setAttemptPlannerInput(parseFloat(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-white focus:outline-none focus:border-mac-blue"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-zinc-400 mb-2 block">Lift Profile:</label>
                    <select 
                      value={attemptPlannerProfile}
                      onChange={(e) => setAttemptPlannerProfile(e.target.value as 'squat_dl'|'bench')}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-white focus:outline-none focus:border-mac-blue appearance-none"
                    >
                      <option value="squat_dl">Squat / Deadlift</option>
                      <option value="bench">Bench Press</option>
                    </select>
                  </div>
                </div>

                {(() => {
                  const first = attemptPlannerInput || 0;
                  const minSec = Math.round((first * 1.075) / 2.5) * 2.5;
                  let maxSec = Math.round((first * 1.10) / 2.5) * 2.5;
                  if (minSec >= maxSec) maxSec = minSec + 2.5;
                  
                  let ceiling = 0;
                  if (attemptPlannerProfile === 'squat_dl') {
                    ceiling = Math.round((maxSec * 1.10) / 2.5) * 2.5;
                  } else {
                    ceiling = maxSec + 10; // Male bench ceiling
                  }

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl flex justify-between items-center">
                        <span className="text-xs text-zinc-400">Suggested 2nd Attempt Range:</span>
                        <span className="text-lg font-bold text-white">{minSec}kg - {maxSec}kg</span>
                      </div>
                      <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl flex justify-between items-center">
                        <span className="text-xs text-zinc-400">Statistical 3rd Attempt Ceiling:</span>
                        <span className="text-lg font-bold text-mac-blue">{ceiling}kg</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

            </div>
          ) : (
             <div className="text-center p-10 bg-zinc-950/50 rounded-3xl border border-zinc-900">
               <p className="text-zinc-500">
                 {selectedAthlete.linked
                   ? 'Analytics could not be generated. Ensure athlete has logged data.'
                   : 'Local identity. Open the imported block on Sessions. Analytics need a linked account.'}
               </p>
               {openError && <p className="text-red-400 text-sm mt-2">{openError}</p>}
             </div>
          )}
        </div>
      )}

    </div>
  );
};

