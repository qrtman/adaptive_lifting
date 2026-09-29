import { authorizationExpiresAt, clearAuthorization, rememberOfflineGrant, restoreOfflineAuthorization, setOnlineAuthorization } from '../services/authAuthorization';
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { UI_KEYS, getUiPref, removeUiPref, setUiPref } from '../storage/uiPrefs';
import { ApiRequestError, apiService } from '../services/api';

export type RoleMode = 'coach' | 'athlete';

interface AuthState {
  user: any | null;
  roleMode: RoleMode;
  setRoleMode: (role: RoleMode) => void;
  signIn: (user: any) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}

function roleFromPref(): RoleMode {
  const stored = getUiPref(UI_KEYS.roleMode);
  return stored === 'athlete' || stored === 'coach' ? stored : 'coach';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const authGeneration = useRef(0);
  const [roleMode, setRoleMode] = useState<RoleMode>(() => roleFromPref());

  useEffect(() => {
    if (!user) return;
    setUiPref(UI_KEYS.roleMode, roleMode);
  }, [roleMode, user]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const generation = ++authGeneration.current;
      try {
        const data = await apiService.session();
        if (!active || generation !== authGeneration.current) return;
        setOnlineAuthorization(data.user, data.sessionExpiresAt, data.scopes);
        await rememberOfflineGrant(data.offlineGrant);
        if (active && generation === authGeneration.current) {
          setUser(data.user);
          setRoleMode(String(data.user.role).toLowerCase() === 'coach' ? 'coach' : 'athlete');
        }
      } catch (error) {
        if (!active || generation !== authGeneration.current) return;
        if (error instanceof ApiRequestError && error.status < 500) {
          await clearAuthorization();
          if (active && generation === authGeneration.current) setUser(null);
        } else {
          const restored = await restoreOfflineAuthorization();
          if (active && generation === authGeneration.current) setUser(restored);
        }
      }
    };
    const deny = () => { authGeneration.current++; void clearAuthorization(); setUser(null); };
    void refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('auth-access-denied', deny);
    window.addEventListener('auth-session-revoked', deny);
    return () => {
      active = false;
      window.removeEventListener('online', refresh);
      window.removeEventListener('auth-access-denied', deny);
      window.removeEventListener('auth-session-revoked', deny);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => {
      authGeneration.current++;
      void clearAuthorization();
      setUser(null);
    }, Math.max(0, authorizationExpiresAt() * 1000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [user]);

  const signIn = async (_nextUser: any) => {
    const generation = ++authGeneration.current;
    // Profile objects are never sufficient to establish authorization.
    const data = await apiService.session();
    if (generation !== authGeneration.current) return;
    const nextUser = data.user;
    setOnlineAuthorization(nextUser, data.sessionExpiresAt, data.scopes);
    await rememberOfflineGrant(data.offlineGrant);
    if (generation !== authGeneration.current) return;
    if (nextUser?.role) {
      const role = String(nextUser.role).toLowerCase();
      if (role === 'athlete' || role === 'coach') {
        setRoleMode(role);
        setUiPref(UI_KEYS.role, String(nextUser.role).toUpperCase());
      }
    }
    if (nextUser?.email) {
      setUiPref(UI_KEYS.email, nextUser.email);
    }
    if (nextUser?.displayName) {
      setUiPref(UI_KEYS.displayName, nextUser.displayName);
    } else if (nextUser?.displayName === null || nextUser?.displayName === '') {
      removeUiPref(UI_KEYS.displayName);
    }
    if (nextUser?.id) {
      setUiPref(UI_KEYS.userId, String(nextUser.id));
    }
    setUser(nextUser);
  };

  const signOut = () => {
    authGeneration.current++;
    void clearAuthorization();
    void apiService.logout();
    removeUiPref(UI_KEYS.roleMode);
    removeUiPref(UI_KEYS.role);
    removeUiPref(UI_KEYS.email);
    removeUiPref(UI_KEYS.displayName);
    removeUiPref(UI_KEYS.userId);
    removeUiPref(UI_KEYS.activeAthleteId);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, roleMode, setRoleMode, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
