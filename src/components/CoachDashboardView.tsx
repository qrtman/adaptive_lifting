import React, { useState } from 'react';
import { UI_KEYS, getUiPref } from '../storage/uiPrefs';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { addLocalAthlete, DuplicateAthleteNameError } from '../services/localRoster';

interface CoachDashboardViewProps {
  onOpenSessions: () => void;
}

export const CoachDashboardView: React.FC<CoachDashboardViewProps> = ({ onOpenSessions }) => {
  const { athletes, rosterReady, selectAthlete, refreshRoster } = usePeriodization();
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [userEmail] = useState(getUiPref(UI_KEYS.email) || '');
  const [linkSuccess, setLinkSuccess] = useState('');

  const handleAddAthlete = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = addName.trim();
    if (!name) {
      setAddError('Name is required.');
      return;
    }
    setAddError(null);
    try {
      await addLocalAthlete({
        name,
        email: addEmail.trim() || null,
        currentBlock: null,
        activeMicrocycles: 0,
        peakE1RM: { squat: null, bench: null, deadlift: null },
      });
    } catch (err) {
      setAddError(err instanceof DuplicateAthleteNameError ? err.message : 'Could not add athlete.');
      return;
    }
    setAddName('');
    setAddEmail('');
    await refreshRoster();
  };

  const copyLinkCode = () => {
    navigator.clipboard.writeText(userEmail);
    setLinkSuccess('Copied to clipboard!');
    setTimeout(() => setLinkSuccess(''), 3000);
  };

  return (
    <div className="h-full w-full bg-[#000000] text-white overflow-y-auto pb-32 font-sans flex flex-col p-6">
      <div className="mb-8 mt-4">
        <h1 className="text-3xl font-black tracking-tight">Roster</h1>
        <p className="text-zinc-400 text-sm mt-2">Identities. Click a name to open their sessions.</p>
      </div>

      <div className="border border-white/10 bg-[#131313] p-4 mb-6">
        <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4">Active Roster</h2>

        {!rosterReady ? (
          <div className="flex justify-center p-8">
            <span className="h-6 w-6 border-2 border-mac-blue border-t-transparent rounded-full animate-spin" />
          </div>
        ) : athletes.length === 0 ? (
          <div className="text-center py-10 border border-white/10">
            <p className="text-sm text-[#AEAEB2]">No athletes on this roster.</p>
            <p className="text-xs text-[#636366] mt-1">Add a name, or share the invite code so an athlete can link an account.</p>
          </div>
        ) : (
          <div className="space-y-1" data-testid="roster-list">
            {athletes.map((athlete) => (
              <button
                type="button"
                key={athlete.id}
                data-testid={`roster-athlete-${athlete.id}`}
                onClick={() => {
                  selectAthlete(athlete.id);
                  onOpenSessions();
                }}
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

      <div className="border border-white/10 bg-[#131313] p-4">
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
              placeholder="Athlete name"
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
            <code className="flex-1 bg-[#161616] border border-white/10 px-3 py-2 text-sm text-[#007AFF] font-mono">
              {userEmail}
            </code>
            <button
              onClick={copyLinkCode}
              className="h-10 px-3 text-xs text-white bg-[#007AFF]"
            >
              Copy
            </button>
          </div>
          {linkSuccess && <p className="text-[#75ff9e] text-[10px] mt-2 font-bold">{linkSuccess}</p>}
          <p className="text-[10px] text-zinc-500 mt-3">Athletes can enter this code in their settings to link to your roster.</p>
        </div>
      </div>
    </div>
  );
};
