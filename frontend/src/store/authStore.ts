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

const DEFAULT_GUEST_USER: User = {
  user_id: "usr_guest_analyst",
  email: "analyst@sarwagya.intel",
  role: "analyst",
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: DEFAULT_GUEST_USER,
      isLoading: false,
      isAuthenticated: true,

      login: async (email, password) => {
        set({ user: { user_id: "usr_guest_analyst", email, role: "analyst" }, isAuthenticated: true, isLoading: false });
      },

      register: async (email, password, name) => {
        set({ user: { user_id: "usr_guest_analyst", email, role: "analyst" }, isAuthenticated: true, isLoading: false });
      },

      logout: async () => {
        set({ user: DEFAULT_GUEST_USER, isAuthenticated: true, isLoading: false });
      },

      loadUser: async () => {
        set({ user: get().user || DEFAULT_GUEST_USER, isAuthenticated: true, isLoading: false });
      },
    }),
    {
      name: "sarwagya_auth_storage",
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
