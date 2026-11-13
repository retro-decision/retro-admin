import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isAdmin } from '../lib/api';
import { authRedirectTo, supabase } from '../lib/supabase';

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  admin: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAdmin = useCallback(async (next: Session | null) => {
    if (!next?.user) {
      setAdmin(false);
      return;
    }
    setAdmin(await isAdmin());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;
      if (sessionError) setError('無法讀取登入狀態，請重新整理。');
      setSession(data.session ?? null);
      await refreshAdmin(data.session ?? null);
      if (!cancelled) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void refreshAdmin(next);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [refreshAdmin]);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: authRedirectTo() },
    });
    if (oauthError) {
      setError(oauthError.message || 'Google 登入失敗。');
      throw oauthError;
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    await supabase.auth.signOut();
    setAdmin(false);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      admin,
      error,
      signInWithGoogle,
      signOut,
    }),
    [loading, session, admin, error, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
