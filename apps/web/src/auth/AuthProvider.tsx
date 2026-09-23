import type { Session } from '@supabase/supabase-js';
import type { AppRole } from '@movensa/shared';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';

export interface AppUser {
  authUserId: string;
  userId: string;
  name: string;
  email: string;
  role: AppRole;
  companyId: string | null;
  phone: string | null;
  companyName: string | null;
  avatarUrl: string | null;
}

interface AuthState {
  session: Session | null;
  user: AppUser | null;
  loading: boolean;
  refreshUser(): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const syncVersion = useRef(0);
  useEffect(() => {
    let active = true;
    const sync = async (next: Session | null) => {
      const version = ++syncVersion.current;
      if (active) setLoading(true);
      if (!next) {
        if (active && version === syncVersion.current) {
          setProfile(null);
          setSession(null);
          setLoading(false);
        }
        return;
      }
      try {
        const remote = await api<AppUser>('/session');
        if (active && version === syncVersion.current) {
          setProfile(remote);
          setSession(next);
        }
      } catch {
        if (!active || version !== syncVersion.current) return;
        setProfile(null);
        setSession(null);
        await supabase.auth.signOut();
      } finally {
        if (active && version === syncVersion.current) setLoading(false);
      }
    };
    void supabase.auth.getSession().then(({ data }) => sync(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { void sync(next); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  const value = useMemo<AuthState>(() => ({
    session,
    user: profile,
    loading,
    refreshUser: async () => { setProfile(await api<AppUser>('/session')); },
    signOut: async () => { try { await api('/session/sign-out', { method: 'POST' }); } finally { await supabase.auth.signOut(); } },
  }), [session, profile, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
