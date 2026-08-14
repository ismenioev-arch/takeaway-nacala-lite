import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AuthContextType, AuthSession } from '@/types/auth';
import { api } from '@/services/api';

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEYS = {
  accessToken: 'wim_access_token',
  refreshToken: 'wim_refresh_token',
  expiresAt: 'wim_expires_at',
  user: 'wim_user',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Carregar sessão do localStorage ao iniciar
  useEffect(() => {
    const storedSession = loadSessionFromStorage();
    if (storedSession) {
      setSession(storedSession);
    }
    setIsLoading(false);
  }, []);

  // Verificar se a sessão expirou a cada minuto
  useEffect(() => {
    if (!session) return;

    const interval = setInterval(() => {
      if (Date.now() >= session.expiresAt) {
        refreshSession();
      }
    }, 60_000);

    return () => clearInterval(interval);
  }, [session]);

  const saveSessionToStorage = (sess: AuthSession) => {
    localStorage.setItem(STORAGE_KEYS.accessToken, sess.accessToken);
    localStorage.setItem(STORAGE_KEYS.refreshToken, sess.refreshToken);
    localStorage.setItem(STORAGE_KEYS.expiresAt, String(sess.expiresAt));
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(sess.user));
  };

  const clearSessionFromStorage = () => {
    localStorage.removeItem(STORAGE_KEYS.accessToken);
    localStorage.removeItem(STORAGE_KEYS.refreshToken);
    localStorage.removeItem(STORAGE_KEYS.expiresAt);
    localStorage.removeItem(STORAGE_KEYS.user);
  };

  const loadSessionFromStorage = (): AuthSession | null => {
    const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken);
    const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
    const expiresAtStr = localStorage.getItem(STORAGE_KEYS.expiresAt);
    const userStr = localStorage.getItem(STORAGE_KEYS.user);

    if (!accessToken || !refreshToken || !expiresAtStr || !userStr) {
      return null;
    }

    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt)) return null;

    try {
      const user = JSON.parse(userStr);
      return { user, accessToken, refreshToken, expiresAt };
    } catch {
      return null;
    }
  };

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.auth.login(email, password);

    const expiresAt = Date.now() + result.expiresIn * 1000;
    const sess: AuthSession = {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt,
    };

    saveSessionToStorage(sess);
    setSession(sess);
  }, []);

  const refreshSession = useCallback(async () => {
    if (!session) return;

    try {
      const result = await api.auth.refresh(session.refreshToken);

      const expiresAt = Date.now() + result.expiresIn * 1000;
      const sess: AuthSession = {
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt,
      };

      saveSessionToStorage(sess);
      setSession(sess);
    } catch (error) {
      // Se a renovação falha, fazer logout
      clearSessionFromStorage();
      setSession(null);
      throw error;
    }
  }, [session]);

  const logout = useCallback(async () => {
    if (!session) return;

    try {
      await api.auth.logout(session.refreshToken);
    } catch {
      // Mesmo que falhe, limpar localmente
    } finally {
      clearSessionFromStorage();
      setSession(null);
    }
  }, [session]);

  const value: AuthContextType = {
    session,
    isLoading,
    isAuthenticated: session !== null,
    login,
    logout,
    refetchSession: refreshSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
