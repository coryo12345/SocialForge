import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from 'shared/types';

type Theme = 'light' | 'dark' | 'system';

interface SessionStore {
  user: User | null;
  theme: Theme;
  setUser: (user: User | null) => void;
  clearUser: () => void;
  toggleTheme: () => void;
  getResolvedTheme: () => 'light' | 'dark';
}

export const useSession = create<SessionStore>()(
  persist(
    (set, get) => ({
      user: null,
      theme: 'system',

      setUser: (user) => set({ user }),
      clearUser: () => set({ user: null }),

      toggleTheme: () => {
        const cycle: Theme[] = ['light', 'dark', 'system'];
        const current = get().theme;
        const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
        set({ theme: next });
      },

      getResolvedTheme: () => {
        const t = get().theme;
        if (t === 'system') {
          return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return t;
      },
    }),
    {
      name: 'sf-session',
      partialize: (state) => ({ theme: state.theme, user: state.user }),
    },
  ),
);
