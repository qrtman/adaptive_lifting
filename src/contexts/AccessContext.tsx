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
  const isCoach = String(user?.role || '').toUpperCase() === 'COACH';
  const [access, setAccess] = useState<WorkspaceAccess | null>(null);
  const [status, setStatus] = useState<AccessStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const refreshAccess = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    if (!user) {
      setAccess(null);
      setStatus('idle');
      setError(null);
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const nextAccess = await apiService.fetchAccountAccess();
      if (requestId.current !== currentRequestId) return;
      setAccess(nextAccess);
      setStatus('resolved');
    } catch (err) {
      if (requestId.current !== currentRequestId) return;
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Access status unavailable');
    }
  }, [user]);

  useEffect(() => {
    setAccess(null);
    void refreshAccess();
  }, [refreshAccess]);

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
