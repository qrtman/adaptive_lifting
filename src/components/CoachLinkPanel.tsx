import React, { useEffect, useState } from 'react';
import { Copy, Link2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiService } from '../services/api';
import { useAccountAccess } from '../contexts/AccessContext';
import { saasErrorMessage } from '../services/saasErrors';

function accountRole(user: { role?: string } | null): 'COACH' | 'ATHLETE' | null {
  const role = String(user?.role || '').toUpperCase();
  if (role === 'COACH' || role === 'ATHLETE') return role;
  return null;
}

/** Server timestamps are UTC; older payloads omit the zone suffix. */
function parseCoachCodeExpiry(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

function formatExpiryTime(time: number): string {
  const date = new Date(time);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// setTimeout overflows past ~24.8 days; legacy codes may expire later than that.
const MAX_EXPIRY_TIMER_MS = 60 * 60 * 1000;

const PANEL = 'mb-6 cal-nested-card';
const MUTED = 'text-xs text-[var(--cal-muted)]';
const ERROR = 'text-xs text-[var(--cal-error)]';
const SUCCESS = 'text-xs text-[var(--cal-success)]';
const PRIMARY =
  'h-9 px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-primary)] text-[var(--cal-on-primary)] text-xs font-medium inline-flex items-center gap-1 hover:bg-[var(--cal-primary-active)] disabled:opacity-50';
const SECONDARY =
  'h-9 px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-strong)] text-[var(--cal-ink)] text-xs font-medium disabled:opacity-50';
const FIELD =
  'flex-1 min-w-[160px] h-9 px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] text-sm text-[var(--cal-ink)] tracking-widest tnum focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]';

export const CoachLinkPanel: React.FC = () => {
  const { user } = useAuth();
  const { canProgram, athleteLimitReached } = useAccountAccess();
  const role = accountRole(user);

  const [codeLoading, setCodeLoading] = useState(role === 'COACH');
  const [generatingCode, setGeneratingCode] = useState(false);
  const [coachCode, setCoachCode] = useState<string | null>(null);
  const [codeActive, setCodeActive] = useState(false);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [codeExpired, setCodeExpired] = useState(false);
  const [expiryTick, setExpiryTick] = useState(0);
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
        setCodeExpiresAt(status.active ? parseCoachCodeExpiry(status.expires_at) : null);
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

  // Codes are short-lived; retire the shown code once its expiry passes.
  useEffect(() => {
    if (codeExpiresAt === null) return;
    const expire = () => {
      setCoachCode(null);
      setCodeActive(false);
      setCodeExpiresAt(null);
      setCodeExpired(true);
      setCoachSuccess(null);
    };
    const remaining = codeExpiresAt - Date.now();
    if (remaining <= 0) {
      expire();
      return;
    }
    const timer = window.setTimeout(
      () => (Date.now() >= codeExpiresAt ? expire() : setExpiryTick((tick) => tick + 1)),
      Math.min(remaining, MAX_EXPIRY_TIMER_MS),
    );
    return () => window.clearTimeout(timer);
  }, [codeExpiresAt, expiryTick]);

  const generateCoachCode = async () => {
    setGeneratingCode(true);
    setCoachError(null);
    setCoachSuccess(null);
    try {
      const result = await apiService.createCoachCode();
      setCoachCode(result.code);
      setCodeActive(true);
      setCodeExpired(false);
      setCodeExpiresAt(parseCoachCodeExpiry(result.expires_at));
      setCoachSuccess('Coach code ready. Share it with the athlete now — it works once and expires in 15 minutes.');
    } catch (err: unknown) {
      const message = saasErrorMessage(err) || (err instanceof Error ? err.message : 'Failed to generate coach code');
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
      await apiService.linkAthlete(coachCodeInput.trim());
      setLinkSuccess('Linked to your coach.');
      setCoachCodeInput('');
    } catch (err: unknown) {
      const message = saasErrorMessage(err) || (err instanceof Error ? err.message : 'Failed to link coach');
      if (/only athletes/i.test(message) || /not authorized/i.test(message)) {
        setLinkError('You do not have permission to link a coach.');
      } else if (/invalid or expired/i.test(message)) {
        setLinkError('Invalid or expired code. Ask your coach for a new one.');
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
        className={PANEL}
      >
        <h2 className="text-sm font-semibold text-[var(--cal-ink)] mb-1">Coach link</h2>
        <p data-testid="coach-link-denied" className={MUTED}>
          You do not have permission to link coach and athlete accounts.
        </p>
      </section>
    );
  }

  if (role === 'COACH') {
    const coachingUnavailable = canProgram === false;
    const atCapacity = athleteLimitReached;
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
        className={PANEL}
      >
        <h2 className="text-sm font-semibold text-[var(--cal-ink)] mb-1 flex items-center gap-2">
          <Link2 size={14} className="text-[var(--cal-accent)]" />
          Coach code
        </h2>
        <p className={`${MUTED} mb-3`}>
          Generate a coach code and share it with an athlete. They enter it in Security to link. Each code works once and expires 15 minutes after you generate it. Unlink keeps the athlete plan.
        </p>

        {codeLoading && (
          <p data-testid="coach-code-loading" className={MUTED}>
            Loading coach code…
          </p>
        )}

        {coachDenied && (
          <p data-testid="coach-link-denied" className={ERROR}>
            You do not have permission to generate a coach code.
          </p>
        )}

        {!codeLoading && !coachDenied && (
          <>
            {coachCode ? (
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <code
                  data-testid="coach-code-value"
                  className="flex-1 min-w-[120px] h-9 px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] text-sm text-[var(--cal-ink)] tracking-widest tnum flex items-center"
                >
                  {coachCode}
                </code>
                <button
                  type="button"
                  data-testid="coach-code-copy"
                  onClick={() => void copyCoachCode()}
                  className={PRIMARY}
                >
                  <Copy size={12} />
                  Copy
                </button>
              </div>
            ) : null}
            {coachCode && codeExpiresAt !== null && (
              <p data-testid="coach-code-expiry" className={`${MUTED} mb-2`}>
                Expires at {formatExpiryTime(codeExpiresAt)}. Single use.
              </p>
            )}
            {coachCode ? null : codeActive ? (
              <p data-testid="coach-code-active-hint" className={`${MUTED} mb-2`}>
                An active coach code exists{codeExpiresAt !== null ? ` until ${formatExpiryTime(codeExpiresAt)}` : ''}. Rotate to reveal a new code.
              </p>
            ) : codeExpired ? (
              <p data-testid="coach-code-expired" className={`${MUTED} mb-2`}>
                Coach code expired. Generate a new one when the athlete is ready to link.
              </p>
            ) : (
              <p data-testid="coach-code-empty" className={`${MUTED} mb-2`}>
                No active coach code yet.
              </p>
            )}

            <button
              type="button"
              data-testid="coach-code-generate"
              onClick={() => void generateCoachCode()}
              disabled={generatingCode || coachingUnavailable || atCapacity}
              title={coachingUnavailable ? 'Active coaching access is required to create invite codes.' : atCapacity ? 'Athlete limit reached.' : undefined}
              className={SECONDARY}
            >
              {generatingCode ? 'Generating…' : coachCode || codeActive ? 'Rotate code' : 'Generate code'}
            </button>
            {coachingUnavailable && <p className={`${MUTED} mt-2`}>Active coaching access is required to create invite codes.</p>}
            {!coachingUnavailable && atCapacity && <p className={`${MUTED} mt-2`}>Athlete limit reached. Existing coach codes may not add another athlete.</p>}
          </>
        )}

        {coachError && (
          <p data-testid="coach-code-error" className={`${ERROR} mt-2`}>
            {coachError}
          </p>
        )}
        {coachSuccess && (
          <p data-testid="coach-code-success" className={`${SUCCESS} mt-2`}>
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
      className={PANEL}
    >
      <h2 className="text-sm font-semibold text-[var(--cal-ink)] mb-1 flex items-center gap-2">
        <Link2 size={14} className="text-[var(--cal-accent)]" />
        Coach link
      </h2>
      <p className={`${MUTED} mb-3`}>
        Enter the coach code (not an email) to link. Codes expire 15 minutes after your coach generates them. Unlink keeps your plan.
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          type="text"
          data-testid="athlete-link-input"
          aria-label="Coach code"
          value={coachCodeInput}
          onChange={(e) => setCoachCodeInput(e.target.value.toUpperCase())}
          placeholder="XXXXX-XXXXX"
          maxLength={16}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          className={`${FIELD} uppercase`}
        />
        <button
          type="button"
          data-testid="athlete-link-submit"
          onClick={() => void handleLinkCoach()}
          disabled={linkLoading || !coachCodeInput.trim()}
          className={PRIMARY}
        >
          {linkLoading ? 'Linking…' : 'Link coach'}
        </button>
        <button
          type="button"
          data-testid="athlete-unlink"
          onClick={() => void handleUnlinkCoach()}
          disabled={unlinkLoading}
          className="h-9 px-4 rounded-[var(--cal-radius-md)] border border-[color-mix(in_srgb,var(--cal-error)_30%,transparent)] text-[var(--cal-error)] text-xs font-medium disabled:opacity-50"
        >
          {unlinkLoading ? 'Unlinking…' : 'Unlink coach'}
        </button>
      </div>
      {!coachCodeInput && !linkSuccess && !linkError && (
        <p data-testid="athlete-link-empty" className="text-xs text-[var(--cal-muted-soft)]">
          No coach linked from this screen yet. Enter a coach code to link.
        </p>
      )}
      {linkError && (
        <p data-testid="athlete-link-error" className={ERROR}>
          {linkError}
        </p>
      )}
      {linkSuccess && (
        <p data-testid="athlete-link-success" className={SUCCESS}>
          {linkSuccess}
        </p>
      )}
    </section>
  );
};
