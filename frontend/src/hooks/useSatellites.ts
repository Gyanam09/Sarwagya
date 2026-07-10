/**
 * useSatellites — Polls /api/satellites for pre-computed orbital positions.
 * All satellite.js computation happens server-side in the API route.
 * This hook is pure browser-safe fetch + state management.
 */
"use client";
import { useState, useEffect, useRef } from "react";

export interface SatellitePosition {
  name: string;
  position: [number, number]; // [lon, lat]
  altitude: number;           // km
  constellation: string;
}

const POLL_MS = 15_000; // refresh positions every 15 s

export function useSatellites(enabled: boolean) {
  const [satellites, setSatellites] = useState<SatellitePosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) { setSatellites([]); return; }
    let cancelled = false;

    const poll = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/satellites", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) {
          setSatellites(data.satellites ?? []);
          setError(null);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Satellite fetch error");
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) timerRef.current = setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled]);

  return { satellites, loading, error };
}
