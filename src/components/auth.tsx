import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { me, type User } from "@/lib/client";

interface AuthState {
  user: User | null;
  /** Device slugs the user maintains. */
  maintains: string[];
  /** Repos (OWNER/REPO) the user maintains (v2; empty before it). */
  maintainsRepos: string[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Admin, or a maintainer of this device: may edit its areas and forks. */
  canEdit: (deviceSlug: string) => boolean;
  /** Admin, or the maintainer of this repo. */
  canManageRepo: (repo: string) => boolean;
  /** Admin, or a maintainer of any device: may add update posts. */
  canPost: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  maintains: [],
  maintainsRepos: [],
  loading: true,
  refresh: async () => {},
  canEdit: () => false,
  canManageRepo: () => false,
  canPost: false,
  isAdmin: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [maintains, setMaintains] = useState<string[]>([]);
  const [maintainsRepos, setMaintainsRepos] = useState<string[]>([]);
  const [apiCanPost, setApiCanPost] = useState<boolean | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await me();
      setUser(res.user);
      setMaintains(res.maintains);
      setMaintainsRepos(res.maintains_repos);
      setApiCanPost(res.can_post);
    } catch {
      setUser(null);
      setMaintains([]);
      setMaintainsRepos([]);
      setApiCanPost(undefined);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(() => {
    const isAdmin = user?.is_admin === true;
    const repos = new Set(maintainsRepos.map((r) => r.toLowerCase()));
    return {
      user,
      maintains,
      maintainsRepos,
      loading,
      refresh,
      isAdmin,
      canEdit: (slug) => !!user && (isAdmin || maintains.includes(slug)),
      canManageRepo: (repo) => !!user && (isAdmin || repos.has(repo.toLowerCase())),
      canPost: !!user && (apiCanPost ?? (isAdmin || maintains.length > 0)),
    };
  }, [user, maintains, maintainsRepos, apiCanPost, loading, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
