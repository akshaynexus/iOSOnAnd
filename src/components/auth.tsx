import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { me, type User } from "@/lib/client";

interface AuthState {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, refresh: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await me();
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <AuthContext.Provider value={{ user, loading, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
