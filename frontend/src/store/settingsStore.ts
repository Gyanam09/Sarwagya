/**
 * store/settingsStore.ts — User preferences store
 * All settings are persisted to localStorage via Zustand persist middleware.
 */
"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { MapStyle } from "@/components/maps/IntelMap";

export type AlertThreshold = "all" | "medium" | "high" | "critical";

export interface DefaultLayers {
  aircraft: boolean;
  ships: boolean;
  satellites: boolean;
  events: boolean;
  heatmap: boolean;
  threats: boolean;
}

interface SettingsState {
  // Map
  mapStyle: MapStyle;
  defaultLayers: DefaultLayers;
  // Alerts
  alertThreshold: AlertThreshold;
  // Display
  timezone: string;
  sidebarDefaultOpen: boolean;
  // Actions
  setMapStyle: (style: MapStyle) => void;
  setDefaultLayers: (layers: Partial<DefaultLayers>) => void;
  setAlertThreshold: (threshold: AlertThreshold) => void;
  setTimezone: (tz: string) => void;
  setSidebarDefaultOpen: (open: boolean) => void;
  reset: () => void;
}

const DEFAULT_LAYERS: DefaultLayers = {
  aircraft: true,
  ships: true,
  satellites: true,
  events: true,
  heatmap: false,
  threats: true,
};

const DEFAULTS = {
  mapStyle: "dark" as MapStyle,
  defaultLayers: DEFAULT_LAYERS,
  alertThreshold: "high" as AlertThreshold,
  timezone: "UTC",
  sidebarDefaultOpen: true,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setMapStyle: (mapStyle) => set({ mapStyle }),
      setDefaultLayers: (layers) =>
        set((s) => ({ defaultLayers: { ...s.defaultLayers, ...layers } })),
      setAlertThreshold: (alertThreshold) => set({ alertThreshold }),
      setTimezone: (timezone) => set({ timezone }),
      setSidebarDefaultOpen: (sidebarDefaultOpen) => set({ sidebarDefaultOpen }),
      reset: () => set(DEFAULTS),
    }),
    {
      name: "sarwagya-settings",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? localStorage : ({} as Storage)
      ),
    }
  )
);
