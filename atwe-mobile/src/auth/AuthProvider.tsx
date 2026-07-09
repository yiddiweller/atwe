import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { api, ApiError, setAuthTokenGetter, setUnauthorizedHandler } from '@/api/client';
import type { AuthResponse, TwoFactorChallenge, User } from '@/api/types';
import { saveToken, loadToken, clearToken } from './storage';
import { realtime } from '@/api/sse';

interface LoginArgs {
  identifier: string;
  password: string;
  code?: string; // TOTP / recovery code for the 2FA challenge
}

interface AuthContextValue {
  user: User | null;
  /** True until the initial token bootstrap finishes (show splash). */
  loading: boolean;
  signedIn: boolean;
  login: (args: LoginArgs) => Promise<{ twoFactorRequired?: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef<string | null>(null);

  // Give the API client a synchronous way to read the token.
  useEffect(() => {
    setAuthTokenGetter(() => tokenRef.current);
    setUnauthorizedHandler(() => {
      // Global 401 → drop the session.
      void hardLogout();
    });
    return () => setUnauthorizedHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hardLogout = useCallback(async () => {
    tokenRef.current = null;
    setUserState(null);
    realtime.close();
    await clearToken();
  }, []);

  // Bootstrap: restore token → hydrate user → open realtime.
  useEffect(() => {
    (async () => {
      const token = await loadToken();
      if (token) {
        tokenRef.current = token;
        try {
          const me = await api.get<User>('/api/auth/me');
          setUserState(me);
          realtime.connect();
        } catch {
          await hardLogout();
        }
      }
      setLoading(false);
    })();
  }, [hardLogout]);

  const login = useCallback<AuthContextValue['login']>(async ({ identifier, password, code }) => {
    try {
      const res = await api.post<AuthResponse>(
        '/api/auth/login',
        { email: identifier, password, ...(code ? { code } : {}) },
        { noAuth: true },
      );
      tokenRef.current = res.token;
      await saveToken(res.token);
      setUserState(res.user);
      realtime.connect();
      return {};
    } catch (err) {
      // 401 { twoFactorRequired:true } → prompt for a code, don't treat as failure.
      if (err instanceof ApiError && (err.body as TwoFactorChallenge)?.twoFactorRequired) {
        return { twoFactorRequired: true };
      }
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await hardLogout();
  }, [hardLogout]);

  const refresh = useCallback(async () => {
    if (!tokenRef.current) return;
    const me = await api.get<User>('/api/auth/me');
    setUserState(me);
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    signedIn: !!user,
    login,
    logout,
    refresh,
    setUser: setUserState,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
