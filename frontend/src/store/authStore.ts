/**
 * store/authStore.ts — Auth state with localStorage persistence
 * persist middleware keeps auth state alive across page reloads
 */
"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { api } from "@/lib/api";

interface User {
  user_id: string;
  email: string;
  role: "admin" | "analyst" | "viewer";
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: true,
      isAuthenticated: false,

      login: async (email, password) => {
        set({ isLoading: true });
        await api.login(email, password);
        const user = await api.getMe();
        set({ user, isAuthenticated: true, isLoading: false });
      },

      register: async (email, password, name) => {
        set({ isLoading: true });
        await api.register(email, password, name);
        const user = await api.getMe();
        set({ user, isAuthenticated: true, isLoading: false });
      },

      logout: async () => {
        await api.logout();
        set({ user: null, isAuthenticated: false, isLoading: false });
      },

      loadUser: async () => {
        // If we already have a user from persisted state and tokens exist, skip re-fetch
        if (get().isAuthenticated && get().user && api.hasTokens()) {
          set({ isLoading: false });
          return;
        }
        // If no tokens at all, skip the /me call immediately
        if (!api.hasTokens()) {
          set({ user: null, isAuthenticated: false, isLoading: false });
          return;
        }
        try {
          const user = await api.getMe();
          set({ user, isAuthenticated: true, isLoading: false });
        } catch {
          api.clearTokens();
          set({ user: null, isAuthenticated: false, isLoading: false });
        }
      },
    }),
    {
      name: "sarwagya-auth",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? localStorage : ({} as Storage)
      ),
      // Only persist user + isAuthenticated — never isLoading
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
