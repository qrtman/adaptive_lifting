import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { apiService, type WorkspaceAccess } from '../services/api';

type AccessStatus = 'idle' | 'loading' | 'resolved' | 'error';
type AccessState = {
  access: WorkspaceAccess | null;
  status: AccessStatus;
  error: string | null;
  refreshAccess: () => Promise<void>;
  isCoach: boolean;
  hasActiveCoachAccess: boolean | null;
  canProgram: boolean | null;
  canUseAnalytics: boolean | null;
  canUseIntegrations: boolean | null;
  athleteLimitReached: boolean;
};

const AccessContext = createContext<AccessState | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Key on identity, not the user object: AuthContext re-creates the object
  // (e.g. on reconnect), which must not wipe access that is already held.
  const userId: string | null = user?.id ?? null;
  const userRole = String(user?.role || '').toUpperCase();
  const isCoach = userRole === 'COACH';
  const [held, setHeld] = useState<{ userId: string; role: string; access: WorkspaceAccess } | null>(null);
  const [fetchStatus, setFetchStatus] = useState<AccessStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const heldKey = useRef<string | null>(null);

  const refreshAccess = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    const key = userId ? `${userId}|${userRole}` : null;
    if (!key) {
      heldKey.current = null;
      setHeld(null);
      setFetchStatus('idle');
      setError(null);
      return;
    }
    // Background refresh (e.g. after redeeming a voucher) keeps the last known
    // access on screen instead of unmounting billing/access panels.
    const background = heldKey.current === key;
    if (!background) setFetchStatus('loading');
    setError(null);
    try {
      const nextAccess = await apiService.fetchAccountAccess();
      if (requestId.current !== currentRequestId) return;
      heldKey.current = key;
      setHeld({ userId: userId!, role: userRole, access: nextAccess });
      setFetchStatus('resolved');
    } catch (err) {
      if (requestId.current !== currentRequestId) return;
      // A failed background refresh keeps the held access; only report the error.
      if (!background) setFetchStatus('error');
      setError(err instanceof Error ? err.message : 'Access status unavailable');
    }
  }, [userId, userRole]);

  useEffect(() => {
    void refreshAccess();
  }, [refreshAccess]);

  // Access fetched for another user or role is never shown; treat it as loading.
  const matches = !!held && held.userId === userId && held.role === userRole;
  const access = matches ? held!.access : null;
  const status: AccessStatus = !userId ? 'idle'
    : matches ? 'resolved'
    : fetchStatus === 'error' ? 'error' : 'loading';

  useEffect(() => {
    const onSaasError = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      if (code === 'WORKSPACE_ACCESS_REQUIRED') void refreshAccess();
    };
    window.addEventListener('saas-access-error', onSaasError);
    return () => window.removeEventListener('saas-access-error', onSaasError);
  }, [refreshAccess]);

  const entitlements = access?.entitlements;
  const value = useMemo<AccessState>(() => ({
    access,
    status,
    error,
    refreshAccess,
    isCoach,
    hasActiveCoachAccess: !isCoach ? null : status === 'resolved' ? entitlements?.active === true : null,
    canProgram: !isCoach ? null : status === 'resolved' ? entitlements?.canProgram === true : null,
    canUseAnalytics: !isCoach ? null : status === 'resolved' ? entitlements?.canUseAnalytics === true : null,
    canUseIntegrations: !isCoach ? null : status === 'resolved' ? entitlements?.canUseIntegrations === true : null,
    athleteLimitReached: isCoach && status === 'resolved' && !!access?.usage &&
      access.usage.maxActiveAthletes !== null && access.usage.activeAthletes >= access.usage.maxActiveAthletes,
  }), [access, status, error, refreshAccess, isCoach, entitlements]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccountAccess(): AccessState {
  const value = useContext(AccessContext);
  if (!value) throw new Error('useAccountAccess must be used inside AccessProvider');
  return value;
}
