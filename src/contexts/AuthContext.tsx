import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { UI_KEYS, getUiPref, removeUiPref, setUiPref } from '../storage/uiPrefs';

export type RoleMode = 'coach' | 'athlete';

interface AuthState {
  user: any | null;
  roleMode: RoleMode;
  setRoleMode: (role: RoleMode) => void;
  signIn: (user: any) => void;
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
  const [user, setUser] = useState<any | null>(() => {
    const stored = getUiPref(UI_KEYS.roleMode);
    return stored === 'athlete' || stored === 'coach' ? { role: stored.toUpperCase() } : null;
  });
  const [roleMode, setRoleMode] = useState<RoleMode>(() => roleFromPref());

  useEffect(() => {
    if (!user) return;
    setUiPref(UI_KEYS.roleMode, roleMode);
  }, [roleMode, user]);

  useEffect(() => {
    const handleSessionRevoked = () => {
      alert('Your session has been terminated or revoked remotely. Please sign in again.');
      removeUiPref(UI_KEYS.roleMode);
      removeUiPref(UI_KEYS.role);
      removeUiPref(UI_KEYS.email);
      setUser(null);
      window.location.reload();
    };
    window.addEventListener('auth-session-revoked', handleSessionRevoked);
    return () => window.removeEventListener('auth-session-revoked', handleSessionRevoked);
  }, []);

  const signIn = (nextUser: any) => {
    if (nextUser?.role) {
      const role = String(nextUser.role).toLowerCase();
      if (role === 'athlete' || role === 'coach') {
        setRoleMode(role);
      }
    }
    if (nextUser?.email) {
      setUiPref(UI_KEYS.email, nextUser.email);
    }
    setUser(nextUser);
  };

  const signOut = () => {
    removeUiPref(UI_KEYS.roleMode);
    removeUiPref(UI_KEYS.role);
    removeUiPref(UI_KEYS.email);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, roleMode, setRoleMode, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
