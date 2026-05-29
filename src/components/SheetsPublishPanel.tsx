import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { 
  FileSpreadsheet, CheckCircle2, XCircle, RefreshCw, 
  Trash2, Send, ExternalLink, Calendar, CheckSquare, Square, ChevronDown 
} from 'lucide-react';

interface OutboxJob {
  id: string;
  sheet_name: string;
  status: string;
  attempts: number;
  error?: string | null;
}

export const SheetsPublishPanel: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'disconnected' | 'connected' | 'error'>('idle');
  const [roster, setRoster] = useState<any[]>([]);
  const [selectedAthlete, setSelectedAthlete] = useState<string>('');
  const [sheetName, setSheetName] = useState<string>('Obsidian Kinetic Export');
  const [selectedTabs, setSelectedTabs] = useState<string[]>(['Sets', 'Workouts', 'INOL', 'ACWR', 'e1RM']);
  const [recentJobs, setRecentJobs] = useState<OutboxJob[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);

  const fetchStatusAndJobs = async (silent = false) => {
    if (!silent) setStatus('loading');
    try {
      const res = await fetch('http://localhost:8000/api/integrations/google-sheets/status', {
        headers: { 'credentials': 'include' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'connected') {
          setStatus('connected');
          setRecentJobs(data.jobs || []);
        } else {
          setStatus('disconnected');
        }
      } else {
        throw new Error("Unable to read integration connection status");
      }
    } catch (e: any) {
      console.error(e);
      if (!silent) {
        setStatus('error');
        setErrorMsg("Failed to read connection status. Ensure API server is online.");
      }
    }
  };

  const fetchRoster = async () => {
    try {
      const data = await apiService.fetchRoster();
      setRoster(data || []);
      if (data && data.length > 0) {
        setSelectedAthlete(data[0].id);
        const emailPrefix = data[0].email.split('@')[0];
        setSheetName(`Obsidian Kinetic - ${emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1)}`);
      }
    } catch (e) {
      console.error("Failed to load roster", e);
      // Fallback roster for mock mode
      const mockRoster = [{ id: 'mock-athlete-1', email: 'athlete@obsidian.com' }];
      setRoster(mockRoster);
      setSelectedAthlete(mockRoster[0].id);
    }
  };

  const connectOAuth = async () => {
    setErrorMsg(null);
    try {
      const res = await fetch('http://localhost:8000/api/integrations/google-sheets/auth-url', {
        headers: { 'credentials': 'include' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.auth_url) {
          // Open authorization consent screen in a popup or new tab
          window.open(data.auth_url, '_blank', 'width=600,height=700');
        }
      } else {
        throw new Error("OAuth authorization request rejected by backend");
      }
    } catch (e: any) {
      console.error(e);
      setStatus('error');
      setErrorMsg("Unable to retrieve authorization link. Ensure keys are configured.");
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Google Sheets? Scheduled and outbox exports will be halted.")) {
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch('http://localhost:8000/api/integrations/google-sheets', {
        method: 'DELETE',
        headers: { 'credentials': 'include' }
      });
      if (res.ok) {
        setStatus('disconnected');
        setRecentJobs([]);
      } else {
        throw new Error("Failed to sever OAuth connection");
      }
    } catch (e) {
      console.error(e);
      setStatus('error');
      setErrorMsg("Failed to disconnect sheets. Please try again.");
    }
  };

  const publishActiveMesocycle = async () => {
    if (!selectedAthlete) {
      alert("Please select an athlete from the active roster first.");
      return;
    }
    setIsPublishing(true);
    try {
      const athleteObj = roster.find(a => a.id === selectedAthlete);
      // Mock or fetch active mesocycle ID
      const mockMesoId = athleteObj?.activeMesocycleId || "mesocycle-active-alpha-09";
      
      const res = await fetch('http://localhost:8000/api/integrations/google-sheets/publish', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'credentials': 'include'
        },
        body: JSON.stringify({
          athlete_id: selectedAthlete,
          mesocycle_id: mockMesoId,
          sheetName: sheetName,
          tabs: selectedTabs
        })
      });
      
      if (res.ok) {
        // Trigger immediate background sync fetch to show queued row
        fetchStatusAndJobs(true);
        alert("Mesocycle publication job successfully queued to Outbox!");
      } else {
        const err = await res.json();
        throw new Error(err.detail || "Server rejected queue request");
      }
    } catch (e: any) {
      console.error(e);
      alert(`Publishing failed: ${e.message}`);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleAthleteChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const aid = e.target.value;
    setSelectedAthlete(aid);
    const athleteObj = roster.find(a => a.id === aid);
    if (athleteObj) {
      const emailPrefix = athleteObj.email.split('@')[0];
      setSheetName(`Obsidian Kinetic - ${emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1)}`);
    }
  };

  const toggleTab = (tabName: string) => {
    setSelectedTabs(prev => 
      prev.includes(tabName) 
        ? prev.filter(t => t !== tabName)
        : [...prev, tabName]
    );
  };

  // Initial load
  useEffect(() => {
    fetchStatusAndJobs();
    fetchRoster();
  }, []);

  // Poll job outbox progress when connected
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status === 'connected') {
      interval = setInterval(() => {
        fetchStatusAndJobs(true); // Silent poll
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [status]);

  return (
    <div className="bg-[#131313] p-6 rounded-xl border border-white/10 relative overflow-hidden transition-all duration-300">
      {/* Dynamic Top Glow */}
      <div className={`absolute top-0 left-0 w-full h-[3px] ${
        status === 'connected' ? 'bg-[#34C759]' : 'bg-white/10'
      }`} />

      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            Google Sheets Report Publisher
            {status === 'connected' && (
              <span className="px-2 py-0.5 bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/20 rounded-full text-[10px] uppercase font-bold tracking-wider">
                Syncing Outbox
              </span>
            )}
          </h3>
          <p className="text-gray-400 text-sm mt-1">
            One-way structured publishing of lifter workouts, daily tonnage, INOL fatigue, and attempt planner diagnostics.
          </p>
        </div>
      </div>

      {status === 'loading' && (
        <div className="flex items-center gap-3 py-6 justify-center text-gray-400">
          <RefreshCw size={18} className="animate-spin text-mac-blue" />
          <span className="text-sm font-semibold tracking-wide">Syncing service connection...</span>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg flex items-start gap-3 mb-4">
          <XCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-200 font-medium">{errorMsg}</p>
            <button onClick={() => fetchStatusAndJobs()} className="text-xs text-red-400 hover:text-red-300 font-bold underline mt-2 cursor-pointer">
              Retry Sync
            </button>
          </div>
        </div>
      )}

      {status === 'disconnected' && (
        <div className="mt-4 space-y-4">
          <div className="bg-black/20 p-4 rounded-lg border border-white/5 text-sm text-gray-400">
            <p className="font-bold text-white mb-2">Spreadsheet Publishing Rule Constraints:</p>
            <ul className="list-disc list-inside space-y-1 pl-1 text-xs">
              <li><strong>One-way Export Only:</strong> Sheet updates never alter PWA canonical workout trees.</li>
              <li><strong>Calculations Preservation:</strong> Backend recomputes raw values to ensure INOL / ACWR formulas stay identical.</li>
              <li><strong>Authentication Scopes:</strong> Minimal Google API scopes requested (only sheets edit privileges).</li>
            </ul>
          </div>
          <button 
            onClick={connectOAuth}
            className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white border border-white/15 rounded-lg font-bold text-sm transition-all flex items-center gap-2 cursor-pointer"
          >
            <FileSpreadsheet size={16} className="text-mac-green" />
            Connect Google Spreadsheet Account
          </button>
        </div>
      )}

      {status === 'connected' && (
        <div className="mt-6 space-y-6">
          {/* Main Controls Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-black/20 p-5 rounded-xl border border-white/5">
            
            {/* Left side: Export Target Profile */}
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-black block mb-2">Select Athlete</label>
                <div className="relative">
                  <select 
                    value={selectedAthlete} 
                    onChange={handleAthleteChange}
                    className="w-full bg-[#1A1A1A] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-mac-blue appearance-none pr-8 cursor-pointer"
                  >
                    {roster.map(a => (
                      <option key={a.id} value={a.id}>{a.email}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="text-gray-400 absolute right-3 top-3.5 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-black block mb-2">Spreadsheet Name</label>
                <input 
                  type="text" 
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  className="w-full bg-[#1A1A1A] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-mac-blue"
                  placeholder="e.g. Athlete Mesocycle Export"
                />
              </div>
            </div>

            {/* Right side: Tabs Checklist */}
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-widest font-black block mb-2">Export Worksheets</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {['Sets', 'Workouts', 'INOL', 'ACWR', 'e1RM'].map(tab => {
                  const isChecked = selectedTabs.includes(tab);
                  return (
                    <button 
                      key={tab} 
                      onClick={() => toggleTab(tab)}
                      className={`flex items-center gap-2 p-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                        isChecked 
                          ? 'bg-mac-blue/5 border-mac-blue/20 text-white' 
                          : 'bg-transparent border-white/5 text-gray-500 hover:border-white/10'
                      }`}
                    >
                      {isChecked ? <CheckSquare size={14} className="text-mac-blue" /> : <Square size={14} />}
                      {tab} tab
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <button 
              onClick={publishActiveMesocycle}
              disabled={isPublishing || selectedTabs.length === 0}
              className="px-5 py-2.5 bg-[#34C759] hover:bg-green-600 text-white rounded-lg font-bold text-sm transition-all shadow-md shadow-green-500/10 cursor-pointer disabled:opacity-50 flex items-center gap-2"
            >
              {isPublishing ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
              Publish Active Mesocycle
            </button>

            <button 
              onClick={disconnect}
              className="px-4 py-2 bg-red-500/5 hover:bg-red-500/15 text-red-500 rounded-lg font-bold text-xs border border-red-500/10 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Trash2 size={13} /> Sever Integration Connection
            </button>
          </div>

          {/* Recent Outbox Logs */}
          <div className="border-t border-white/5 pt-4">
            <h4 className="text-[10px] text-gray-500 uppercase tracking-widest font-black mb-3">Outbox Publication Status</h4>
            {recentJobs.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No publications queued in this session.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {recentJobs.map(job => (
                  <div key={job.id} className="bg-black/30 border border-white/5 rounded-lg p-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {job.status === 'success' ? (
                        <CheckCircle2 size={16} className="text-[#34C759] shrink-0" />
                      ) : job.status === 'failed' ? (
                        <XCircle size={16} className="text-red-500 shrink-0" />
                      ) : (
                        <RefreshCw size={16} className="text-mac-blue animate-spin shrink-0" />
                      )}
                      <div className="min-w-0 text-xs">
                        <p className="font-bold text-white truncate">{job.sheet_name}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          Status: <span className={
                            job.status === 'success' ? 'text-mac-green' : job.status === 'failed' ? 'text-red-400' : 'text-mac-blue'
                          }>{job.status.toUpperCase()}</span> (Attempts: {job.attempts}/3)
                        </p>
                      </div>
                    </div>

                    {job.status === 'success' && job.error && (
                      <a 
                        href={job.error} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="px-3 py-1 bg-mac-green/10 hover:bg-mac-green/20 text-mac-green rounded font-bold text-[10px] border border-mac-green/20 flex items-center gap-1 transition-all shrink-0 cursor-pointer"
                      >
                        Open Sheet <ExternalLink size={10} />
                      </a>
                    )}

                    {job.status === 'failed' && job.error && (
                      <div className="text-[10px] text-red-400 italic max-w-xs truncate" title={job.error}>
                        {job.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
};
