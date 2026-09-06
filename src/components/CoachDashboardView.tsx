import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { UI_KEYS, getUiPref } from '../storage/uiPrefs';

export const CoachDashboardView: React.FC = () => {
  const [roster, setRoster] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState(getUiPref(UI_KEYS.email) || '');
  const [linkSuccess, setLinkSuccess] = useState('');

  // Drill-down state
  const [selectedAthlete, setSelectedAthlete] = useState<any | null>(null);
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushTemplate, setPushTemplate] = useState('Hypertrophy Block (4 Weeks)');
  const [isPushing, setIsPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState('');

  // Powerlifting Analytics state
  const [analytics, setAnalytics] = useState<any>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [attemptPlannerInput, setAttemptPlannerInput] = useState<number>(200);
  const [attemptPlannerProfile, setAttemptPlannerProfile] = useState<'squat_dl'|'bench'>('squat_dl');

  useEffect(() => {
    if (selectedAthlete) {
      fetchAnalytics();
    }
  }, [selectedAthlete]);

  const fetchAnalytics = async () => {
    setLoadingAnalytics(true);
    try {
      const data = await apiService.fetchAnalyticsTrends(selectedAthlete.id);
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
    try {
      const data = await apiService.fetchRoster();
      setRoster(data);
      // Update selected athlete data if viewing one
      if (selectedAthlete) {
        const updated = data.find((a: any) => a.id === selectedAthlete.id);
        if (updated) setSelectedAthlete(updated);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const copyLinkCode = () => {
    navigator.clipboard.writeText(userEmail);
    setLinkSuccess('Copied to clipboard!');
    setTimeout(() => setLinkSuccess(''), 3000);
  };

  const handlePushProgram = async () => {
    if (!selectedAthlete) return;
    setIsPushing(true);
    setPushSuccess('');
    try {
      await apiService.pushProgramming(selectedAthlete.id, pushTemplate);
      setPushSuccess('Program pushed successfully!');
      setTimeout(() => {
        setShowPushModal(false);
        setPushSuccess('');
      }, 2000);
      await fetchRoster(); // Refresh stats
    } catch (err) {
      console.error('Failed to push program', err);
      alert('Failed to push programming');
    } finally {
      setIsPushing(false);
    }
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
          {selectedAthlete ? `Managing programming for ${selectedAthlete.email}` : 'Managing your roster and program deployment.'}
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
              <div className="text-center py-10 bg-zinc-950 rounded-2xl border border-zinc-800">
                <span className="material-symbols-outlined text-zinc-600 text-4xl mb-2">group_off</span>
                <p className="text-zinc-400 text-sm font-bold">No athletes linked yet.</p>
                <p className="text-zinc-600 text-xs mt-1">Share your link code to onboard athletes.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {roster.map((athlete) => (
                  <div 
                    key={athlete.id} 
                    onClick={() => setSelectedAthlete(athlete)}
                    className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between hover:border-mac-blue/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-mac-blue/20 text-mac-blue flex items-center justify-center font-bold">
                        {athlete.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-sm">{athlete.email}</h3>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-0.5">
                          {athlete.activeMicrocycles} Active Block{athlete.activeMicrocycles !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <button className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center hover:bg-zinc-700 transition-colors">
                      <span className="material-symbols-outlined text-[16px] text-zinc-400">chevron_right</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Onboarding Toolkit */}
          <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden">
            <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4">Onboarding Tools</h2>
            
            <div className="bg-zinc-900/50 rounded-2xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-400 mb-2">Your Coach Link Code:</p>
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
                <h2 className="text-xl font-bold">{selectedAthlete.email}</h2>
                <p className="text-sm text-zinc-400 mt-1">
                  Currently executing {selectedAthlete.activeMicrocycles} active microcycles.
                </p>
              </div>
              <button 
                onClick={() => setShowPushModal(true)}
                className="bg-mac-blue hover:bg-blue-600 text-white rounded-xl px-4 py-2 text-sm font-bold transition-all shadow-[0_0_20px_rgba(0,122,255,0.3)] hover:shadow-[0_0_30px_rgba(0,122,255,0.5)] flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
                Push Program
              </button>
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
               <p className="text-zinc-500">Analytics could not be generated. Ensure athlete has logged data.</p>
             </div>
          )}
        </div>
      )}

      {/* Push Programming Modal */}
      {showPushModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden animate-in fade-in slide-in-from-bottom-8 duration-300">
            <div className="p-6 border-b border-zinc-800/50 flex justify-between items-center bg-zinc-900/30">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <span className="material-symbols-outlined text-mac-blue">send</span>
                Deploy Program
              </h3>
              <button onClick={() => setShowPushModal(false)} className="text-zinc-500 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              {pushSuccess ? (
                <div className="bg-[#75ff9e]/10 border border-[#75ff9e]/30 rounded-xl p-4 text-center">
                  <span className="material-symbols-outlined text-[#75ff9e] text-4xl mb-2">check_circle</span>
                  <p className="text-[#75ff9e] font-bold">{pushSuccess}</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider mb-2 block">
                      Target Athlete
                    </label>
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 text-sm font-medium text-zinc-300">
                      {selectedAthlete?.email}
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider mb-2 block">
                      Select Template
                    </label>
                    <select 
                      value={pushTemplate}
                      onChange={(e) => setPushTemplate(e.target.value)}
                      className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-mac-blue appearance-none"
                    >
                      <option value="Hypertrophy Block (4 Weeks)">Hypertrophy Block (4 Weeks)</option>
                      <option value="Peaking Block (3 Weeks)">Peaking Block (3 Weeks)</option>
                      <option value="Base Building (6 Weeks)">Base Building (6 Weeks)</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            {!pushSuccess && (
              <div className="p-4 border-t border-zinc-800/50 bg-zinc-900/30 flex gap-3">
                <button 
                  onClick={() => setShowPushModal(false)}
                  className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-bold transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handlePushProgram}
                  disabled={isPushing}
                  className="flex-1 py-3 rounded-xl bg-mac-blue hover:bg-blue-600 text-sm font-bold transition-colors flex justify-center items-center gap-2"
                >
                  {isPushing ? (
                    <span className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    'Deploy'
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

