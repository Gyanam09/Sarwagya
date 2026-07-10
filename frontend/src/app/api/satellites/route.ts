/**
 * /api/satellites — Fetches TLE data from CelesTrak and computes current orbital
 * positions SERVER-SIDE using satellite.js (which is a Node-only package).
 * Returns ready-to-render {name, lon, lat, altitude, constellation}[] JSON.
 *
 * Module-level cache: TLEs refresh every 5 min, positions computed per-request.
 */
import { NextResponse } from "next/server";
// satellite.js is safe here because this file runs in Node.js (API route),
// not in the browser. Listed in serverExternalPackages so webpack ignores it.
import * as sat from "satellite.js";

interface TLERecord { name: string; tle1: string; tle2: string }
export interface SatellitePosition {
  name: string;
  position: [number, number]; // [lon, lat]
  altitude: number; // km
  constellation: string;
}

// TLE cache
let tleCache: TLERecord[] | null = null;
let tleCachedAt = 0;
const TLE_TTL_MS = 300_000; // 5 min

const TLE_GROUPS = [
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle",
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle",
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle",
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=tle",
];

async function fetchGroup(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    console.log(`[API Satellites] Fetching: ${url}`);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/plain",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      cache: "no-store",
    });
    console.log(`[API Satellites] Status for ${url}: ${res.status}`);
    if (!res.ok) {
      console.error(`[API Satellites] Fetch failed for ${url} with status ${res.status}`);
      return "";
    }
    const text = await res.text();
    console.log(`[API Satellites] Successfully fetched ${text.length} bytes for ${url}`);
    return text;
  } catch (err: any) {
    console.error(`[API Satellites] Exception for ${url}:`, err.message ?? err);
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function parseTLEs(raw: string): TLERecord[] {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const out: TLERecord[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    if (lines[i + 1].startsWith("1 ") && lines[i + 2].startsWith("2 ")) {
      out.push({ name: lines[i], tle1: lines[i + 1], tle2: lines[i + 2] });
    }
  }
  return out;
}

function inferConstellation(name: string): string {
  const n = name.toUpperCase();
  if (n.includes("ISS") || n.includes("ZARYA")) return "ISS";
  if (n.includes("GPS")) return "GPS";
  if (n.includes("GALILEO")) return "GALILEO";
  if (n.includes("GLONASS")) return "GLONASS";
  if (n.includes("STARLINK")) return "STARLINK";
  if (n.includes("NOAA") || n.includes("GOES") || n.includes("METEOSAT")) return "WEATHER";
  return "OTHER";
}

function computePositions(tles: TLERecord[], now: Date): SatellitePosition[] {
  const gmst = sat.gstime(now);
  const results: SatellitePosition[] = [];

  for (const { name, tle1, tle2 } of tles) {
    try {
      const satrec = sat.twoline2satrec(tle1, tle2);
      const pv = sat.propagate(satrec, now);
      if (!pv || !pv.position || typeof pv.position === "boolean") continue;

      const geo = sat.eciToGeodetic(pv.position as sat.EciVec3<number>, gmst);
      const lat = sat.degreesLat(geo.latitude);
      const lon = sat.degreesLong(geo.longitude);
      const alt = geo.height;

      if (!isFinite(lat) || !isFinite(lon) || alt < 0 || alt > 40_000) continue;

      results.push({
        name: name.trim(),
        position: [lon, lat],
        altitude: Math.round(alt),
        constellation: inferConstellation(name),
      });
    } catch { /* bad TLE — skip */ }
  }
  return results;
}

export async function GET() {
  // Refresh TLEs if stale
  if (!tleCache || Date.now() - tleCachedAt > TLE_TTL_MS) {
    try {
      const texts = await Promise.all(TLE_GROUPS.map(fetchGroup));
      const parsed = parseTLEs(texts.join("\n"));
      if (parsed.length > 0) {
        tleCache = parsed;
        tleCachedAt = Date.now();
      }
    } catch { /* keep old cache */ }
  }

  if (!tleCache || tleCache.length === 0) {
    return NextResponse.json({ satellites: [], error: "No TLE data available" });
  }

  const positions = computePositions(tleCache, new Date());
  return NextResponse.json({ satellites: positions, count: positions.length });
}
