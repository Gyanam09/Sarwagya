/**
 * useShips — Simulated oil tanker / cargo vessel positions on realistic trade routes.
 * Positions are computed from current time so vessels persist across sessions
 * and appear at plausible geographic locations. Updated every 8 seconds.
 */
"use client";
import { useState, useEffect } from "react";

export interface Vessel {
  mmsi: string;
  name: string;
  flag: string;
  cargoType: "CRUDE_OIL" | "LNG" | "CONTAINER" | "BULK" | "PRODUCT";
  position: [number, number]; // [lon, lat]
  heading: number;
  speedKnots: number;
  destination: string;
  routeName: string;
  routeWaypoints: [number, number][]; // for path rendering
}

/* ─── Trade Routes ────────────────────────────────────────────────────── */

const ROUTES: Record<string, [number, number][]> = {
  HORMUZ_TO_CHINA: [
    [56.5, 24.5], [62, 20], [72, 12], [80, 5], [96, 4.5],
    [103.5, 2.5], [108, 10], [118, 20], [121.5, 30],
  ],
  HORMUZ_TO_EUROPE_SUEZ: [
    [56.5, 24.5], [48, 14], [43.5, 12.5], [40, 16], [37, 22],
    [32.6, 29.9], [33, 30.6], [28, 33], [20, 35.5],
    [5, 37], [-1, 37.5], [-5.3, 36], [-8, 43], [-8, 51], [3, 52],
  ],
  HORMUZ_CAPE: [
    [56.5, 24.5], [63, 15], [72, 5], [55, -20],
    [38, -35], [18.5, -34.3], [5, -35], [-10, -28],
    [-10, -15], [-8, 0], [-5, 15], [-2, 36], [3, 52],
  ],
  MALACCA_TO_CHINA: [
    [103.5, 2.5], [108, 10], [111, 15], [118, 22], [121.5, 30],
  ],
  WEST_AFRICA_TO_CHINA: [
    [7, 4], [3, 0], [-5, -15], [-10, -30], [5, -35],
    [35, -35], [55, -20], [72, 5], [80, 5], [96, 4.5],
    [103.5, 2.5], [118, 20], [121.5, 30],
  ],
  TRANS_PACIFIC_CONTAINER: [
    [121.5, 31], [140, 35], [160, 40], [180, 45],
    [-165, 48], [-140, 42], [-125, 38], [-122.5, 37.8],
  ],
  TRANS_ATLANTIC: [
    [-74, 40.7], [-60, 40], [-40, 42], [-20, 48],
    [-8, 51], [3, 52],
  ],
  GULF_OF_MEXICO_EUROPE: [
    [-94, 29], [-88, 28], [-80, 25], [-74, 35],
    [-55, 38], [-30, 40], [-10, 48], [3, 52],
  ],
  RUSSIA_BLACK_SEA: [
    [37.5, 47], [33, 43.5], [29, 41], [26, 40],
    [20, 38], [14, 37], [5, 37], [-5.3, 36],
  ],
  AUSTRALIA_LNG_JAPAN: [
    [114, -22], [118, -18], [125, -10], [130, -5],
    [135, 5], [140, 15], [145, 25], [138, 35],
    [136, 37],
  ],
  CARIBBEAN_TO_EUROPE: [
    [-61.5, 13], [-68, 18], [-75, 24], [-65, 30],
    [-45, 38], [-20, 46], [-8, 51], [3, 52],
  ],
  TAIWAN_STRAIT: [
    [121.5, 30], [121.5, 25], [120.5, 22], [119, 18],
    [113, 13], [110, 10], [103.5, 2.5],
  ],
};

/* ─── Vessel Definitions ─────────────────────────────────────────────── */

const VESSELS_DEF = [
  { mmsi: "309571000", name: "TI EUROPE",            flag: "🇧🇸", cargo: "CRUDE_OIL" as const, routeKey: "HORMUZ_TO_EUROPE_SUEZ", dest: "Rotterdam",    speed: 13.5, offset: 0.05 },
  { mmsi: "636091700", name: "MARAN CASTOR",          flag: "🇬🇷", cargo: "LNG"       as const, routeKey: "AUSTRALIA_LNG_JAPAN",   dest: "Yokohama",     speed: 15,   offset: 0.22 },
  { mmsi: "374557000", name: "DELTA CAPTAIN",         flag: "🇵🇦", cargo: "CRUDE_OIL" as const, routeKey: "WEST_AFRICA_TO_CHINA",  dest: "Qingdao",      speed: 12,   offset: 0.38 },
  { mmsi: "477123456", name: "COSCO UNIVERSE",        flag: "🇨🇳", cargo: "CONTAINER" as const, routeKey: "TRANS_PACIFIC_CONTAINER", dest: "Los Angeles", speed: 18,   offset: 0.14 },
  { mmsi: "244123000", name: "ATLANTIC SPIRIT",       flag: "🇳🇱", cargo: "CONTAINER" as const, routeKey: "TRANS_ATLANTIC",        dest: "Rotterdam",    speed: 16,   offset: 0.67 },
  { mmsi: "636091234", name: "NAUTICAL HARMONY",      flag: "🇱🇷", cargo: "CRUDE_OIL" as const, routeKey: "HORMUZ_TO_CHINA",       dest: "Ningbo",       speed: 12.5, offset: 0.48 },
  { mmsi: "229201000", name: "GULF GLORY",            flag: "🇬🇷", cargo: "PRODUCT"   as const, routeKey: "MALACCA_TO_CHINA",      dest: "Shanghai",     speed: 14,   offset: 0.75 },
  { mmsi: "311042900", name: "CAPE ENDEAVOUR",        flag: "🇧🇸", cargo: "CRUDE_OIL" as const, routeKey: "HORMUZ_CAPE",           dest: "Rotterdam",    speed: 11,   offset: 0.33 },
  { mmsi: "311000000", name: "ARABIAN LEGEND",        flag: "🇸🇦", cargo: "CRUDE_OIL" as const, routeKey: "HORMUZ_TO_EUROPE_SUEZ", dest: "Marseille",    speed: 13,   offset: 0.81 },
  { mmsi: "636013000", name: "DARWIN VENTURE",        flag: "🇱🇷", cargo: "LNG"       as const, routeKey: "AUSTRALIA_LNG_JAPAN",   dest: "Nagoya",       speed: 14.5, offset: 0.56 },
  { mmsi: "255925000", name: "PACIFIC LION",          flag: "🇵🇹", cargo: "CONTAINER" as const, routeKey: "TRANS_PACIFIC_CONTAINER", dest: "Long Beach",  speed: 17,   offset: 0.91 },
  { mmsi: "305234000", name: "TEXAS EAGLE",           flag: "🇺🇸", cargo: "PRODUCT"   as const, routeKey: "GULF_OF_MEXICO_EUROPE", dest: "Le Havre",     speed: 13,   offset: 0.29 },
  { mmsi: "636014500", name: "BLACK SEA GLORY",       flag: "🇱🇷", cargo: "CRUDE_OIL" as const, routeKey: "RUSSIA_BLACK_SEA",      dest: "Piraeus",      speed: 12,   offset: 0.44 },
  { mmsi: "477654321", name: "SINO PACIFIC",          flag: "🇨🇳", cargo: "BULK"      as const, routeKey: "TAIWAN_STRAIT",         dest: "Port Klang",   speed: 11.5, offset: 0.62 },
  { mmsi: "235000001", name: "CELTIC SPIRIT",         flag: "🇬🇧", cargo: "CRUDE_OIL" as const, routeKey: "WEST_AFRICA_TO_CHINA",  dest: "Zhoushan",     speed: 12,   offset: 0.17 },
  { mmsi: "518000001", name: "SINGAPORE STAR",        flag: "🇸🇬", cargo: "CONTAINER" as const, routeKey: "MALACCA_TO_CHINA",      dest: "Tianjin",      speed: 15,   offset: 0.83 },
  { mmsi: "440111000", name: "ALPINE ETERNITY",       flag: "🇰🇷", cargo: "LNG"       as const, routeKey: "AUSTRALIA_LNG_JAPAN",   dest: "Incheon",      speed: 14,   offset: 0.71 },
  { mmsi: "636091000", name: "HORMUZ TITAN",          flag: "🇱🇷", cargo: "CRUDE_OIL" as const, routeKey: "HORMUZ_TO_CHINA",       dest: "Dalian",       speed: 13,   offset: 0.59 },
  { mmsi: "567000001", name: "BAIE DE SAINT-BRIEUC",  flag: "🇫🇷", cargo: "PRODUCT"   as const, routeKey: "CARIBBEAN_TO_EUROPE",   dest: "Saint-Nazaire",speed: 14,   offset: 0.36 },
  { mmsi: "353000001", name: "PACIFIC NAVIGATOR",     flag: "🇵🇦", cargo: "CONTAINER" as const, routeKey: "TRANS_PACIFIC_CONTAINER", dest: "Oakland",    speed: 16.5, offset: 0.08 },
];

/* ─── Position helpers ───────────────────────────────────────────────── */

function routeLengthKm(waypoints: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = (waypoints[i][0] - waypoints[i - 1][0]) * 111 * Math.cos((waypoints[i][1] * Math.PI) / 180);
    const dy = (waypoints[i][1] - waypoints[i - 1][1]) * 111;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

function interpolate(waypoints: [number, number][], t: number): [number, number] {
  if (t <= 0) return waypoints[0];
  if (t >= 1) return waypoints[waypoints.length - 1];
  const idx = t * (waypoints.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  const a = waypoints[Math.min(i, waypoints.length - 1)];
  const b = waypoints[Math.min(i + 1, waypoints.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

function heading(from: [number, number], to: [number, number]): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

function computeVessels(nowMs: number): Vessel[] {
  return VESSELS_DEF.map((def) => {
    const waypoints = ROUTES[def.routeKey];
    const distKm = routeLengthKm(waypoints);
    // Duration in seconds for one full traversal at given speed
    const durationSec = (distKm / (def.speed * 1.852)) * 3600;
    // Current progress 0..1, offset per vessel for spread
    const progress = ((nowMs / 1000 / durationSec + def.offset) % 1 + 1) % 1;
    const pos = interpolate(waypoints, progress);
    const nextPos = interpolate(waypoints, Math.min(progress + 0.005, 1));
    return {
      mmsi: def.mmsi,
      name: def.name,
      flag: def.flag,
      cargoType: def.cargo,
      position: pos,
      heading: heading(pos, nextPos),
      speedKnots: def.speed,
      destination: def.dest,
      routeName: def.routeKey.replace(/_/g, " → "),
      routeWaypoints: waypoints,
    };
  });
}

export function useShips(enabled: boolean) {
  const [ships, setShips] = useState<Vessel[]>([]);

  useEffect(() => {
    if (!enabled) { setShips([]); return; }
    setShips(computeVessels(Date.now()));
    const interval = setInterval(() => setShips(computeVessels(Date.now())), 8_000);
    return () => clearInterval(interval);
  }, [enabled]);

  return ships;
}
