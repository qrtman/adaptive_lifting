import React, { useEffect, useState } from 'react';
import { Copy, Link2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiService } from '../services/api';

function accountRole(user: { role?: string } | null): 'COACH' | 'ATHLETE' | null {
  const role = String(user?.role || '').toUpperCase();
  if (role === 'COACH' || role === 'ATHLETE') return role;
  return null;
}

export const CoachLinkPanel: React.FC = () => {
  const { user } = useAuth();
  const role = accountRole(user);

  const [codeLoading, setCodeLoading] = useState(role === 'COACH');
  const [generatingCode, setGeneratingCode] = useState(false);
  const [coachCode, setCoachCode] = useState<string | null>(null);
  const [codeActive, setCodeActive] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachSuccess, setCoachSuccess] = useState<string | null>(null);
  const [coachDenied, setCoachDenied] = useState(false);

  const [coachCodeInput, setCoachCodeInput] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (role !== 'COACH') return;
    let cancelled = false;
    setCodeLoading(true);
    setCoachError(null);
    setCoachDenied(false);
    apiService.getCoachCodeStatus()
      .then((status) => {
        if (cancelled) return;
        setCodeActive(Boolean(status.active));
        if (status.code) setCoachCode(status.code);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load coach code';
        if (/only coaches/i.test(message) || /not authorized/i.test(message)) {
          setCoachDenied(true);
        } else {
          setCoachError(message);
        }
      })
      .finally(() => {
        if (!cancelled) setCodeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  const generateCoachCode = async () => {
    setGeneratingCode(true);
    setCoachError(null);
    setCoachSuccess(null);
    try {
      const result = await apiService.createCoachCode();
      setCoachCode(result.code);
      setCodeActive(true);
      setCoachSuccess('Coach code ready. Share it with the athlete.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate coach code';
      if (/only coaches/i.test(message) || /not authorized/i.test(message)) {
        setCoachDenied(true);
      }
      setCoachError(message);
    } finally {
      setGeneratingCode(false);
    }
  };

  const copyCoachCode = async () => {
    if (!coachCode) return;
    setCoachError(null);
    try {
      await navigator.clipboard.writeText(coachCode);
      setCoachSuccess('Coach code copied.');
    } catch {
      setCoachError('Copy failed. Select the coach code and copy it manually.');
    }
  };

  const handleLinkCoach = async () => {
    if (!coachCodeInput.trim()) return;
    setLinkLoading(true);
    setLinkError(null);
    setLinkSuccess(null);
    try {
      const result = await apiService.linkAthlete(coachCodeInput.trim());
      setLinkSuccess(result.message || 'Linked to coach.');
      setCoachCodeInput('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to link coach';
      if (/only athletes/i.test(message) || /not authorized/i.test(message)) {
        setLinkError('You do not have permission to link a coach.');
      } else {
        setLinkError(message);
      }
    } finally {
      setLinkLoading(false);
    }
  };

  const handleUnlinkCoach = async () => {
    if (!window.confirm('Unlink from your coach? Your plan stays in your account.')) return;
    setUnlinkLoading(true);
    setLinkError(null);
    setLinkSuccess(null);
    try {
      const result = await apiService.unlinkCoach();
      setLinkSuccess(result.message || 'Unlinked from coach. Plan stays in your account.');
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : 'Failed to unlink coach');
    } finally {
      setUnlinkLoading(false);
    }
  };

  if (!role) {
    return (
      <section
        data-testid="coach-link-panel"
        data-state="denied"
        className="mb-6 border border-white/10 rounded-[8px] bg-[#131313] p-4"
      >
        <h2 className="text-sm font-semibold text-white mb-1">Coach link</h2>
        <p data-testid="coach-link-denied" className="text-xs text-[#AEAEB2]">
          You do not have permission to link coach and athlete accounts.
        </p>
      </section>
    );
  }

  if (role === 'COACH') {
    const panelState = coachDenied
      ? 'denied'
      : codeLoading
        ? 'loading'
        : coachError
          ? 'error'
          : coachCode
            ? 'ready'
            : codeActive
              ? 'active'
              : 'empty';

    return (
      <section
        data-testid="coach-link-panel"
        data-state={panelState}
        className="mb-6 border border-white/10 rounded-[8px] bg-[#131313] p-4"
      >
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Link2 size={14} className="text-[#007AFF]" />
          Coach code
        </h2>
        <p className="text-xs text-[#AEAEB2] mb-3">
          Generate a coach code and share it with an athlete. They enter it in Security to link. Unlink keeps the athlete plan.
        </p>

        {codeLoading && (
          <p data-testid="coach-code-loading" className="text-xs text-[#AEAEB2]">
            Loading coach code…
          </p>
        )}

        {coachDenied && (
          <p data-testid="coach-link-denied" className="text-xs text-[#FF453A]">
            You do not have permission to generate a coach code.
          </p>
        )}

        {!codeLoading && !coachDenied && (
          <>
            {coachCode ? (
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <code
                  data-testid="coach-code-value"
                  className="flex-1 min-w-[120px] h-9 px-3 rounded bg-[#161616] border border-white/10 text-sm text-white tracking-widest flex items-center"
                >
                  {coachCode}
                </code>
                <button
                  type="button"
                  data-testid="coach-code-copy"
                  onClick={() => void copyCoachCode()}
                  className="h-9 px-3 rounded bg-[#007AFF] text-white text-xs font-semibold inline-flex items-center gap-1"
                >
                  <Copy size={12} />
                  Copy
                </button>
              </div>
            ) : codeActive ? (
              <p data-testid="coach-code-active-hint" className="text-xs text-[#AEAEB2] mb-2">
                An active coach code exists. Rotate to reveal a new code.
              </p>
            ) : (
              <p data-testid="coach-code-empty" className="text-xs text-[#AEAEB2] mb-2">
                No active coach code yet.
              </p>
            )}

            <button
              type="button"
              data-testid="coach-code-generate"
              onClick={() => void generateCoachCode()}
              disabled={generatingCode}
              className="h-9 px-3 rounded bg-white/10 hover:bg-white/15 text-white text-xs font-semibold disabled:opacity-50"
            >
              {generatingCode ? 'Generating…' : coachCode || codeActive ? 'Rotate code' : 'Generate code'}
            </button>
          </>
        )}

        {coachError && (
          <p data-testid="coach-code-error" className="text-xs text-[#FF453A] mt-2">
            {coachError}
          </p>
        )}
        {coachSuccess && (
          <p data-testid="coach-code-success" className="text-xs text-[#34C759] mt-2">
            {coachSuccess}
          </p>
        )}
      </section>
    );
  }

  return (
    <section
      data-testid="coach-link-panel"
      data-state={linkError ? 'error' : linkSuccess ? 'success' : 'empty'}
      className="mb-6 border border-white/10 rounded-[8px] bg-[#131313] p-4"
    >
      <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
        <Link2 size={14} className="text-[#007AFF]" />
        Coach link
      </h2>
      <p className="text-xs text-[#AEAEB2] mb-3">
        Enter the coach code (not an email) to link. Unlink keeps your plan.
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          type="text"
          data-testid="athlete-link-input"
          value={coachCodeInput}
          onChange={(e) => setCoachCodeInput(e.target.value.toUpperCase())}
          placeholder="Coach code"
          autoCapitalize="characters"
          className="flex-1 min-w-[160px] h-9 px-3 rounded bg-[#161616] border border-white/10 text-sm text-white uppercase tracking-widest"
        />
        <button
          type="button"
          data-testid="athlete-link-submit"
          onClick={() => void handleLinkCoach()}
          disabled={linkLoading || !coachCodeInput.trim()}
          className="h-9 px-4 rounded bg-[#007AFF] text-white text-xs font-semibold disabled:opacity-50"
        >
          {linkLoading ? 'Linking…' : 'Link coach'}
        </button>
        <button
          type="button"
          data-testid="athlete-unlink"
          onClick={() => void handleUnlinkCoach()}
          disabled={unlinkLoading}
          className="h-9 px-4 rounded border border-[#FF453A]/30 text-[#FF453A] text-xs font-semibold disabled:opacity-50"
        >
          {unlinkLoading ? 'Unlinking…' : 'Unlink coach'}
        </button>
      </div>
      {!coachCodeInput && !linkSuccess && !linkError && (
        <p data-testid="athlete-link-empty" className="text-xs text-[#636366]">
          No coach linked from this screen yet. Enter a coach code to link.
        </p>
      )}
      {linkError && (
        <p data-testid="athlete-link-error" className="text-xs text-[#FF453A]">
          {linkError}
        </p>
      )}
      {linkSuccess && (
        <p data-testid="athlete-link-success" className="text-xs text-[#34C759]">
          {linkSuccess}
        </p>
      )}
    </section>
  );
};
