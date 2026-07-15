/**
 * useAircraft — Real-time aircraft positions from OpenSky Network (via /api/opensky proxy).
 * Polls every 30 seconds. Maintains a rolling position buffer (last 6 fixes) per aircraft
 * so IntelMap can render animated flight trails using the TripsLayer.
 */
"use client";
import { useState, useEffect, useRef, useCallback } from "react";

export interface Aircraft {
  icao24: string;
  callsign: string;
  originCountry: string;
  position: [number, number]; // [lon, lat]
  altitude: number;           // metres (barometric)
  velocity: number;           // m/s
  heading: number;            // degrees true north
  verticalRate: number;       // m/s
  onGround: boolean;
  /** Rolling history of [lon, lat, timestamp_sec] for trail rendering */
  trail: [number, number, number][];
}

const POLL_MS     = 30_000;
const TRAIL_MAX   = 8;   // keep last N position fixes
const MAX_AIRCRAFT = 500; // cap rendered aircraft for performance (deck.gl)

function parseStates(states: any[][]): Omit<Aircraft, "trail">[] {
  return states
    .filter(
      (s) =>
        s[5] != null &&
        s[6] != null &&
        !s[8] // exclude aircraft on ground
    )
    .map((s) => ({
      icao24:        s[0] as string,
      callsign:      ((s[1] as string) || s[0]).trim(),
      originCountry: s[2] as string,
      position:      [s[5] as number, s[6] as number] as [number, number],
      altitude:      (s[7] ?? 0) as number,
      velocity:      (s[9] ?? 0) as number,
      heading:       (s[10] ?? 0) as number,
      verticalRate:  (s[11] ?? 0) as number,
      onGround:      s[8] as boolean,
    }))
    // Sort by altitude descending (higher = more interesting), then cap at MAX_AIRCRAFT
    .sort((a, b) => b.altitude - a.altitude)
    .slice(0, MAX_AIRCRAFT);
}


export function useAircraft(enabled: boolean) {
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Persist trail history across polls — keyed by icao24
  const trailMapRef = useRef<Map<string, [number, number, number][]>>(new Map());
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async (cancelled: { current: boolean }) => {
    setLoading(true);
    try {
      const res  = await fetch("/api/opensky", { cache: "no-store" });
      const data = await res.json();

      if (!cancelled.current && data.states) {
        const nowSec  = Math.floor(Date.now() / 1000);
        const parsed  = parseStates(data.states);
        const trailMap = trailMapRef.current;

        const withTrails: Aircraft[] = parsed.map((ac) => {
          const prev = trailMap.get(ac.icao24) ?? [];
          const entry: [number, number, number] = [ac.position[0], ac.position[1], nowSec];
          const next: [number, number, number][] = [...prev, entry].slice(-TRAIL_MAX);
          trailMap.set(ac.icao24, next);
          return { ...ac, trail: next };
        });

        // Prune stale entries (aircraft that haven't been seen this poll)
        const seenSet = new Set(parsed.map((a) => a.icao24));
        Array.from(trailMap.keys()).forEach((k) => {
          if (!seenSet.has(k)) trailMap.delete(k);
        });

        setAircraft(withTrails);
        setError(null);
      }
    } catch (e: any) {
      if (!cancelled.current) setError(e.message ?? "OpenSky error");
    } finally {
      if (!cancelled.current) setLoading(false);
    }
    if (!cancelled.current) timerRef.current = setTimeout(() => poll(cancelled), POLL_MS);
  }, []);

  useEffect(() => {
    if (!enabled) { setAircraft([]); return; }

    const cancelled = { current: false };
    poll(cancelled);

    return () => {
      cancelled.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, poll]);

  return { aircraft, loading, error };
}
