"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import {
  clearSession,
  getAccessToken,
  getStoredUser,
  saveSession,
  updateStoredUser,
} from "@/lib/auth-storage";
import type { LoginResult, Role, User } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  isAdmin: boolean;
  isManager: boolean;
  isKasir: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Hydrate sesi dari localStorage + validasi ke /auth/me
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const token = getAccessToken();
      const stored = getStoredUser();
      if (!token) {
        setLoading(false);
        return;
      }
      setUser(stored);
      try {
        const { user: fresh } = await api.get<{ user: User }>("/auth/me");
        if (!cancelled) {
          setUser(fresh);
          updateStoredUser(fresh);
        }
      } catch {
        // token invalid → api() sudah handle refresh / redirect
        if (!cancelled && !getAccessToken()) {
          clearSession();
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    hydrate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<LoginResult>("/auth/login", { email, password });
    saveSession(data.accessToken, data.refreshToken, data.user);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      const refreshToken = localStorage.getItem("pos.refreshToken");
      if (refreshToken) {
        await api.post("/auth/logout", { refreshToken });
      }
    } catch {
      // abaikan error logout di server; tetap bersihkan lokal
    }
    clearSession();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { user: fresh } = await api.get<{ user: User }>("/auth/me");
      setUser(fresh);
      updateStoredUser(fresh);
    } catch {
      // biarkan api() menangani redirect
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      refreshUser,
      hasRole: (...roles) => (user ? roles.includes(user.role) : false),
      isAdmin: user?.role === "admin",
      isManager: user?.role === "admin" || user?.role === "manager",
      isKasir: user?.role === "kasir",
    }),
    [user, loading, login, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam <AuthProvider>");
  return ctx;
}
