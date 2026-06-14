'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, setTokens, clearTokens, User } from './api';

// ─── Auth store ───────────────────────────────────────────────────────────────
interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const res = await api.auth.login(email, password);
          const { accessToken, refreshToken, user } = res.data.data;

          setTokens(accessToken, refreshToken);

          set({
            user,
            accessToken,
            refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      logout: async () => {
        const { refreshToken } = get();
        try {
          if (refreshToken) await api.auth.logout(refreshToken);
        } catch {
          // Ignore logout API errors
        } finally {
          clearTokens();
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
          });
        }
      },

      hydrate: async () => {
        const token =
          typeof window !== 'undefined' ? localStorage.getItem('nexus_access_token') : null;

        if (!token) {
          set({ isAuthenticated: false });
          return;
        }

        try {
          const res = await api.auth.me();
          set({ user: res.data.data.user, isAuthenticated: true });
        } catch {
          clearTokens();
          set({ user: null, isAuthenticated: false });
        }
      },

      setUser: (user) => set({ user }),
    }),
    {
      name: 'nexus-auth',
      partialize: (state) => ({
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// ─── Role helpers ─────────────────────────────────────────────────────────────
const ROLE_LEVELS: Record<string, number> = {
  admin: 4,
  manager: 3,
  analyst: 2,
  viewer: 1,
};

export function hasRole(user: User | null, minRole: string): boolean {
  if (!user) return false;
  return (ROLE_LEVELS[user.role] || 0) >= (ROLE_LEVELS[minRole] || 0);
}

export function useIsAdmin() {
  const user = useAuthStore((s) => s.user);
  return hasRole(user, 'admin');
}

export function useIsManager() {
  const user = useAuthStore((s) => s.user);
  return hasRole(user, 'manager');
}

export function useIsAnalyst() {
  const user = useAuthStore((s) => s.user);
  return hasRole(user, 'analyst');
}
