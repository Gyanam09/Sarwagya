/**
 * /api/opensky — Server-side proxy for OpenSky Network.
 * Avoids browser CORS and handles the rate-limit gracefully.
 *
 * OpenSky anonymous limit: ~400 req/day per IP.
 * We cache the response for 30 s using a module-level variable so Next.js
 * dev-mode hot reloads don't bypass it.
 */
import { NextResponse } from "next/server";

// In-memory cache (survives hot reloads in dev via module singleton)
let cachedData: unknown = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

// OpenSky returns state vectors for the full globe.
// We trim client-side, so no bounding box filter here (avoids extra req on zoom).
const OPENSKY_URL = "https://opensky-network.org/api/states/all";

export async function GET() {
  // Serve from cache if fresh
  if (cachedData && Date.now() - cachedAt < CACHE_TTL_MS) {
    return NextResponse.json(cachedData);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(OPENSKY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      // Return last cached data if available, otherwise error
      if (cachedData) return NextResponse.json(cachedData);
      return NextResponse.json(
        { error: `OpenSky returned ${res.status}`, states: [] },
        { status: 200 } // 200 so the client doesn't treat as fatal
      );
    }

    const data = await res.json();
    cachedData = data;
    cachedAt = Date.now();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Return stale cache if available — better than empty
    if (cachedData) return NextResponse.json(cachedData);
    // Return empty but valid shape so the client doesn't crash
    return NextResponse.json({ error: message, states: [], time: Date.now() / 1000 });
  } finally {
    clearTimeout(timeout);
  }
}
