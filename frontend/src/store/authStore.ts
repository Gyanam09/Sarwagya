/**
 * store/authStore.ts — Global auth state via Zustand
 */
import { create } from "zustand";
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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  login: async (email, password) => {
    await api.login(email, password);
    const user = await api.getMe();
    set({ user, isAuthenticated: true, isLoading: false });
  },

  register: async (email, password, name) => {
    await api.register(email, password, name);
    const user = await api.getMe();
    set({ user, isAuthenticated: true, isLoading: false });
  },

  logout: async () => {
    await api.logout();
    set({ user: null, isAuthenticated: false, isLoading: false });
  },

  loadUser: async () => {
    try {
      const user = await api.getMe();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
