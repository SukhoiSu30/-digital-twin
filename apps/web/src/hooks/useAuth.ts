import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { api } from "@/lib/api";

interface User {
  id: string;
  email: string;
  displayName: string;
  connectedServices: Array<{
    provider: string;
    connected: boolean;
    expiresAt: string;
  }>;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  microsoftConnected: boolean;
  zoomConnected: boolean;
  login: (provider: "microsoft" | "zoom") => void;
  logout: () => void;
  refresh: () => Promise<void>;
}

// Token key in memory (not localStorage per artifact rules, but this is a real app file)
const TOKEN_KEY = "dt_token";

function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage not available
  }
}

function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage not available
  }
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }

    api.setToken(token);

    try {
      const response = await api.getMe();
      setUser(response.data as User);
    } catch {
      // Token invalid — clear it
      clearStoredToken();
      api.clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Check URL for token on mount (OAuth callback redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      storeToken(token);
      api.setToken(token);
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
      fetchUser();
    }
  }, [fetchUser]);

  const login = useCallback((provider: "microsoft" | "zoom") => {
    window.location.href = api.getAuthUrl(provider);
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    api.clearToken();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    await fetchUser();
  }, [fetchUser]);

  const microsoftConnected =
    user?.connectedServices.some(
      (s) => s.provider === "microsoft" && s.connected
    ) ?? false;

  const zoomConnected =
    user?.connectedServices.some(
      (s) => s.provider === "zoom" && s.connected
    ) ?? false;

  return {
    user,
    loading,
    isAuthenticated: !!user,
    microsoftConnected,
    zoomConnected,
    login,
    logout,
    refresh,
  };
}
