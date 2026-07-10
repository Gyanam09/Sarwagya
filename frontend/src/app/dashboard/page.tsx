"use client";
import dynamic from "next/dynamic";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Globe, Radio, Plane, Anchor, Satellite, Zap, ChevronRight,
  X, AlertCircle, TrendingUp, Menu, ChevronDown, ChevronUp,
  Clock, Target, Layers, Activity, Loader2,
  Shield, MapPin, Wind, Navigation, Info, Eye, EyeOff,
  Thermometer, Crosshair, BarChart3, Filter, Search, Cpu,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { api } from "@/lib/api";
import { useAircraft } from "@/hooks/useAircraft";
import { useSatellites } from "@/hooks/useSatellites";
import { useShips } from "@/hooks/useShips";
import type { GeoEvent, LayerVisibility, MapHoverState } from "@/components/maps/IntelMap";
import { ThreatGauge } from "@/components/dashboard/ThreatGauge";
import { IntelQueryTerminal } from "@/components/dashboard/IntelQueryTerminal";

/* ─── Dynamic import (map is client/WebGL only) ────────────────────────── */
const IntelMap = dynamic(() => import("@/components/maps/IntelMap"), {
  ssr: false,
  loading: () => (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center hex-grid-bg"
    >
      <div className="relative w-20 h-20 mb-6">
        <div className="absolute inset-0 rounded-full border border-sky-500/20 animate-ping" />
        <div className="absolute inset-2 rounded-full border border-sky-400/20 animate-ping" style={{ animationDelay: "0.3s" }} />
        <div className="absolute inset-0 m-auto flex items-center justify-center">
          <Shield className="w-8 h-8 text-sky-400 animate-pulse" />
        </div>
      </div>
      <p className="text-slate-500 text-xs tracking-widest uppercase font-display">
        Initialising Geospatial Engine
      </p>
      <div className="flex items-center gap-1.5 mt-3">
        {["SENSORS", "FEEDS", "AI"].map((s, i) => (
          <span key={s} className="text-[9px] px-2 py-0.5 rounded font-bold tracking-wider"
            style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.15)", color: "rgba(56,189,248,0.6)", animationDelay: `${i * 0.2}s` }}>
            {s}
          </span>
        ))}
      </div>
    </div>
  ),
});

/* ─── Country ISO3 → approx centroid ───────────────────────────────────── */
const ISO3_COORDS: Record<string, [number, number]> = {
  USA: [-98, 38], CHN: [105, 35], RUS: [90, 60], IND: [78, 22], DEU: [10, 51],
  GBR: [-2, 53], FRA: [2, 46], JPN: [138, 36], BRA: [-51, -14], AUS: [133, -27],
  IRN: [53, 32], SAU: [45, 24], ISR: [35, 31], PAK: [69, 30], TWN: [121, 24],
  KOR: [128, 37], PRK: [127, 40], UKR: [31, 49], TUR: [35, 39], EGY: [30, 27],
  NGA: [8, 10], ZAF: [25, -29], IDN: [118, -5], MYS: [108, 4], THA: [101, 15],
  PHL: [122, 13], VNM: [108, 16], SYR: [38, 35], IRQ: [44, 33], LBY: [17, 27],
  SDN: [30, 15], ETH: [40, 9], SOM: [46, 10], YEM: [48, 15], AFG: [67, 33],
  MMR: [95, 18], BGD: [90, 24], LBN: [35, 34], JOR: [37, 32], KWT: [47, 29],
  QAT: [51, 25], ARE: [54, 24], MEX: [-102, 23], COL: [-74, 4], VEN: [-66, 8],
  ARG: [-64, -34], CHL: [-71, -30], PER: [-76, -10], POL: [20, 52], ITA: [12, 42],
};

function countriesToPosition(countries: string[]): [number, number] | null {
  for (const c of countries) {
    const pos = ISO3_COORDS[c];
    if (pos) return pos;
  }
  return null;
}

/* ─── Severity helpers ──────────────────────────────────────────────────── */
const SEV_STYLE: Record<string, { bg: string; text: string; border: string; dot: string; hex: string }> = {
  CRITICAL: { bg: "rgba(239,68,68,0.12)",   text: "#f87171",  border: "rgba(239,68,68,0.3)",   dot: "bg-red-400",     hex: "#ef4444" },
  HIGH:     { bg: "rgba(249,115,22,0.12)",  text: "#fb923c",  border: "rgba(249,115,22,0.3)",  dot: "bg-orange-400",  hex: "#f97316" },
  MEDIUM:   { bg: "rgba(234,179,8,0.12)",   text: "#fbbf24",  border: "rgba(234,179,8,0.3)",   dot: "bg-amber-400",   hex: "#f59e0b" },
  LOW:      { bg: "rgba(34,197,94,0.12)",   text: "#34d399",  border: "rgba(34,197,94,0.3)",   dot: "bg-emerald-400", hex: "#10b981" },
};

function sevKey(s: number) {
  return s >= 0.8 ? "CRITICAL" : s >= 0.6 ? "HIGH" : s >= 0.4 ? "MEDIUM" : "LOW";
}

/* ─── UTC Clock ─────────────────────────────────────────────────────────── */
function UtcClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="flex items-center gap-1.5 font-mono-data" style={{ color: "rgba(148,163,184,0.7)", fontSize: 10 }}>
      <Clock className="w-2.5 h-2.5" style={{ color: "rgba(56,189,248,0.6)" }} />
      <span style={{ color: "rgba(56,189,248,0.7)" }}>
        {pad(time.getUTCHours())}:{pad(time.getUTCMinutes())}:{pad(time.getUTCSeconds())}
      </span>
      <span style={{ color: "rgba(100,116,139,0.7)", fontSize: 8 }}>UTC</span>
    </div>
  );
}

/* ─── Field row ─────────────────────────────────────────────────────────── */
function Field({ icon, label, value, mono = false, accent }: {
  icon?: React.ReactNode; label: string; value: string; mono?: boolean; accent?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5"
      style={{ borderBottom: "1px solid rgba(20,32,55,0.5)" }}>
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5" style={{ color: "rgba(100,116,139,0.8)" }}>
        {icon && <span className="opacity-70">{icon}</span>}
        <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</span>
      </div>
      <span
        className={mono ? "font-mono-data" : "font-display"}
        style={{ fontSize: 11, color: accent ?? "#cbd5e1", fontWeight: 600, textAlign: "right" }}
      >
        {value}
      </span>
    </div>
  );
}

/* ─── Entity Detail Panel ───────────────────────────────────────────────── */
function EntityDetailPanel({ entity, type, onClose }: { entity: any; type: string; onClose: () => void }) {
  if (!entity) return null;
  const isAircraft  = type === "aircraft";
  const isShip      = type === "ship";
  const isSatellite = type === "satellite";
  const isEvent     = type === "event";
  const sk = isEvent ? sevKey(entity.severity) : null;
  const sev = sk ? SEV_STYLE[sk] : null;

  const typeConfig = {
    aircraft:  { icon: <Plane className="w-4 h-4" />,        color: "#38bdf8", label: "AIRCRAFT",  bg: "rgba(56,189,248,0.1)" },
    ship:      { icon: <Anchor className="w-4 h-4" />,       color: "#fb923c", label: "VESSEL",    bg: "rgba(251,146,60,0.1)" },
    satellite: { icon: <Satellite className="w-4 h-4" />,    color: "#a78bfa", label: "SATELLITE", bg: "rgba(167,139,250,0.1)" },
    event:     { icon: <AlertCircle className="w-4 h-4" />,  color: sev?.hex ?? "#f43f5e", label: "INTEL EVENT", bg: `${sev?.hex ?? "#f43f5e"}18` },
  }[type] ?? { icon: null, color: "#38bdf8", label: type.toUpperCase(), bg: "rgba(56,189,248,0.1)" };

  return (
    <div
      className="fixed right-0 top-0 h-full z-40 flex flex-col animate-slide-in-right"
      style={{
        width: 320,
        background: "rgba(2, 6, 14, 0.97)",
        borderLeft: `1px solid ${typeConfig.color}25`,
        backdropFilter: "blur(24px)",
        boxShadow: `-8px 0 40px rgba(0,0,0,0.4), inset 0 0 80px rgba(0,0,0,0.2)`,
      }}
    >
      {/* Top accent line */}
      <div style={{ height: 2, background: `linear-gradient(to right, ${typeConfig.color}, transparent)` }} />

      {/* Header */}
      <div className="flex items-center gap-3 p-4 pb-3"
        style={{ borderBottom: "1px solid rgba(20,32,55,0.7)" }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: typeConfig.bg, border: `1px solid ${typeConfig.color}30`, color: typeConfig.color }}>
          {typeConfig.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span style={{ fontSize: 8, color: typeConfig.color, fontWeight: 700, letterSpacing: "0.1em", fontFamily: "Space Grotesk" }}>
              {typeConfig.label}
            </span>
            <span style={{ fontSize: 8, color: "rgba(56,189,248,0.3)" }}>›</span>
            <span style={{ fontSize: 8, color: "rgba(100,116,139,0.7)", letterSpacing: "0.05em" }}>DETAIL</span>
          </div>
          <p className="font-display text-sm font-bold truncate" style={{ color: "#f1f5f9" }}>
            {isAircraft  && (entity.callsign || entity.icao24)}
            {isShip      && `${entity.flag} ${entity.name}`}
            {isSatellite && entity.name}
            {isEvent     && entity.title}
          </p>
        </div>
        <button onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center transition-colors"
          style={{ color: "rgba(100,116,139,0.7)", background: "rgba(20,32,55,0.6)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#e2e8f0")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(100,116,139,0.7)")}>
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto p-4 space-y-0.5">
        {isAircraft && (
          <>
            <Field icon={<Navigation className="w-3 h-3" />} label="ICAO24"       value={entity.icao24}       mono />
            <Field icon={<Globe className="w-3 h-3" />}      label="Origin"       value={entity.originCountry} />
            <Field icon={<TrendingUp className="w-3 h-3" />} label="Altitude"     value={`${Math.round(entity.altitude).toLocaleString()} m`} accent="#38bdf8" mono />
            <Field icon={<Wind className="w-3 h-3" />}       label="Ground Speed" value={`${Math.round(entity.velocity * 3.6)} km/h`} mono />
            <Field icon={<Navigation className="w-3 h-3" />} label="Heading"      value={`${Math.round(entity.heading)}°`} mono />
            <Field icon={<Activity className="w-3 h-3" />}   label="Vert. Rate"   value={`${entity.verticalRate > 0 ? "▲" : "▼"} ${Math.abs(Math.round(entity.verticalRate * 60))} m/min`} />
            <Field icon={<MapPin className="w-3 h-3" />}     label="Position"     value={`${entity.position[1].toFixed(3)}°N, ${entity.position[0].toFixed(3)}°E`} mono />
            {/* Trail info */}
            {entity.trail?.length > 1 && (
              <div className="mt-3 p-3 rounded-lg" style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.12)" }}>
                <p style={{ fontSize: 9, color: "#38bdf8", fontWeight: 700, marginBottom: 4, letterSpacing: "0.08em" }}>FLIGHT TRAIL</p>
                <p style={{ fontSize: 10, color: "rgba(148,163,184,0.7)" }}>{entity.trail.length} position fixes tracked</p>
              </div>
            )}
          </>
        )}
        {isShip && (
          <>
            <Field icon={<Info className="w-3 h-3" />}       label="MMSI"         value={entity.mmsi} mono />
            <Field icon={<Anchor className="w-3 h-3" />}     label="Cargo"        value={entity.cargoType.replace(/_/g, " ")} />
            <Field icon={<Navigation className="w-3 h-3" />} label="Speed"        value={`${entity.speedKnots} kn`} mono accent="#fb923c" />
            <Field icon={<TrendingUp className="w-3 h-3" />} label="Heading"      value={`${Math.round(entity.heading)}°`} mono />
            <Field icon={<MapPin className="w-3 h-3" />}     label="Destination"  value={entity.destination} />
            <Field icon={<MapPin className="w-3 h-3" />}     label="Position"     value={`${entity.position[1].toFixed(2)}°N, ${entity.position[0].toFixed(2)}°E`} mono />
            <div className="mt-3 p-3 rounded-lg" style={{ background: "rgba(251,146,60,0.06)", border: "1px solid rgba(251,146,60,0.15)" }}>
              <p style={{ fontSize: 9, color: "#fb923c", fontWeight: 700, marginBottom: 4, letterSpacing: "0.08em" }}>TRADE ROUTE</p>
              <p style={{ fontSize: 10, color: "rgba(148,163,184,0.7)" }}>{entity.routeName}</p>
            </div>
          </>
        )}
        {isSatellite && (
          <>
            <Field icon={<Satellite className="w-3 h-3" />}  label="Constellation" value={entity.constellation} />
            <Field icon={<TrendingUp className="w-3 h-3" />} label="Altitude"      value={`${entity.altitude.toLocaleString()} km`} mono accent="#a78bfa" />
            <Field icon={<MapPin className="w-3 h-3" />}     label="Lat / Lon"     value={`${entity.position[1].toFixed(1)}°, ${entity.position[0].toFixed(1)}°`} mono />
            <div className="mt-3 p-3 rounded-lg" style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)" }}>
              <p style={{ fontSize: 9, color: "#a78bfa", fontWeight: 700, marginBottom: 4, letterSpacing: "0.08em" }}>ORBITAL DATA</p>
              <p style={{ fontSize: 10, color: "rgba(148,163,184,0.7)" }}>Live position via TLE · CelesTrak · Updates every 15 s</p>
            </div>
          </>
        )}
        {isEvent && sev && (
          <>
            {/* Severity bar */}
            <div className="mb-3 p-3 rounded-lg" style={{ background: sev.bg, border: `1px solid ${sev.border}` }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${sev.dot} animate-pulse`} />
                  <span style={{ fontSize: 10, color: sev.text, fontWeight: 800, letterSpacing: "0.08em" }}>{sk} SEVERITY</span>
                </div>
                <span className="font-mono-data" style={{ fontSize: 11, color: sev.text }}>{(entity.severity * 100).toFixed(0)}%</span>
              </div>
              {/* Progress bar */}
              <div style={{ height: 3, background: "rgba(0,0,0,0.3)", borderRadius: 2 }}>
                <div style={{
                  height: "100%", borderRadius: 2,
                  width: `${entity.severity * 100}%`,
                  background: `linear-gradient(to right, ${sev.hex}88, ${sev.hex})`,
                  transition: "width 0.8s ease",
                }} />
              </div>
            </div>

            <Field icon={<Zap className="w-3 h-3" />}        label="Type"         value={entity.event_type?.replace(/_/g, " ")} />
            {entity.countries?.length > 0 && (
              <Field icon={<Globe className="w-3 h-3" />}    label="Countries"    value={entity.countries.join(" · ")} />
            )}
            {entity.position?.[0] !== 0 && (
              <Field icon={<MapPin className="w-3 h-3" />}   label="Location"     value={`${entity.position[1].toFixed(1)}°N, ${entity.position[0].toFixed(1)}°E`} mono />
            )}
            <div className="mt-3 p-3 rounded-lg" style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(30,48,75,0.6)" }}>
              <p style={{ fontSize: 9, color: "rgba(100,116,139,0.8)", fontWeight: 700, marginBottom: 6, letterSpacing: "0.08em" }}>INTELLIGENCE SUMMARY</p>
              <p style={{ fontSize: 10.5, color: "#94a3b8", lineHeight: 1.6 }}>{entity.summary}</p>
            </div>
          </>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="p-3 flex items-center gap-2" style={{ borderTop: "1px solid rgba(20,32,55,0.7)" }}>
        {[
          { label: "FLAG", icon: <Target className="w-3 h-3" /> },
          { label: "EXPORT", icon: <BarChart3 className="w-3 h-3" /> },
        ].map((btn) => (
          <button key={btn.label}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded transition-all"
            style={{
              background: "rgba(14,22,40,0.8)",
              border: "1px solid rgba(30,48,75,0.7)",
              color: "rgba(100,116,139,0.8)",
              fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = `${typeConfig.color}50`;
              (e.currentTarget as HTMLButtonElement).style.color = typeConfig.color;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(30,48,75,0.7)";
              (e.currentTarget as HTMLButtonElement).style.color = "rgba(100,116,139,0.8)";
            }}>
            {btn.icon}
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Layer Toggle ──────────────────────────────────────────────────────── */
function LayerToggle({ label, icon, count, active, color, onClick }: {
  label: string; icon: React.ReactNode; count: number; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all"
      style={{
        background: active ? `${color}14` : "rgba(8,16,30,0.7)",
        border: `1px solid ${active ? color + "45" : "rgba(20,35,60,0.7)"}`,
        color: active ? "#e2e8f0" : "#475569",
        boxShadow: active ? `0 0 12px ${color}18` : "none",
      }}
    >
      <span style={{ color: active ? color : "#475569" }}>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
      <span className="font-mono-data px-1 py-0.5 rounded text-[9px] font-bold"
        style={{ background: active ? `${color}20` : "rgba(15,25,45,0.8)", color: active ? color : "#334155" }}>
        {count.toLocaleString()}
      </span>
    </button>
  );
}

/* ─── Intel Event Row ───────────────────────────────────────────────────── */
function IntelEventRow({ event, onClick }: { event: GeoEvent; onClick: () => void }) {
  const sk  = sevKey(event.severity);
  const sev = SEV_STYLE[sk];
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full text-left p-2.5 rounded-lg transition-all"
      style={{
        background: hovered ? "rgba(12,22,42,0.8)" : "transparent",
        border: `1px solid ${hovered ? "rgba(56,189,248,0.12)" : "transparent"}`,
      }}
    >
      <div className="flex items-start gap-2">
        {/* Severity indicator */}
        <div className="flex flex-col items-center gap-1 mt-0.5 shrink-0">
          <div className={`w-1.5 h-1.5 rounded-full ${sev.dot}`}
            style={{ boxShadow: `0 0 6px ${sev.hex}` }} />
          <div style={{ width: 1, height: 16, background: `linear-gradient(to bottom, ${sev.hex}40, transparent)` }} />
        </div>

        <div className="flex-1 min-w-0">
          <p style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 600, lineHeight: 1.4 }}
            className="line-clamp-2">{event.title}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: "0.07em",
              color: sev.text, background: sev.bg, border: `1px solid ${sev.border}`,
              padding: "1px 5px", borderRadius: 3,
            }}>{sk}</span>
            <span style={{ fontSize: 8.5, color: "rgba(100,116,139,0.7)" }}>
              {event.event_type?.replace(/_/g, " ")}
            </span>
          </div>
        </div>

        <ChevronRight className="w-3 h-3 shrink-0 mt-1 transition-colors"
          style={{ color: hovered ? "rgba(56,189,248,0.5)" : "rgba(71,85,105,0.5)" }} />
      </div>
    </button>
  );
}

/* ─── Stat Card ─────────────────────────────────────────────────────────── */
function StatCard({ icon, label, value, color, loading, sub }: {
  icon: React.ReactNode; label: string; value: string; color: string; loading: boolean; sub?: string;
}) {
  return (
    <div className="rounded-xl p-3 relative overflow-hidden"
      style={{ background: "rgba(6,12,26,0.8)", border: `1px solid ${color}20` }}>
      {/* Background glow */}
      <div style={{
        position: "absolute", top: -20, right: -20, width: 60, height: 60,
        background: `radial-gradient(circle, ${color}18 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />
      <div className="flex items-center gap-1.5 mb-1.5">
        <span style={{ color }}>{icon}</span>
        <span style={{ fontSize: 8.5, color: "rgba(100,116,139,0.7)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {label}
        </span>
      </div>
      {loading ? (
        <div className="w-12 h-5 rounded animate-shimmer" style={{ background: "rgba(20,32,55,0.8)" }} />
      ) : (
        <p className="font-mono-data text-xl font-black leading-none" style={{ color, fontFamily: "JetBrains Mono, monospace" }}>
          {value}
        </p>
      )}
      {sub && <p style={{ fontSize: 8, color: "rgba(100,116,139,0.5)", marginTop: 3 }}>{sub}</p>}
    </div>
  );
}

/* ─── Bottom HUD Bar ────────────────────────────────────────────────────── */
function BottomHUD({
  aircraft, ships, satellites, events, hoverCoords
}: {
  aircraft: number; ships: number; satellites: number; events: number;
  hoverCoords: { longitude: number; latitude: number } | null;
}) {
  const fmtCoord = (n: number, pos: string, neg: string) => {
    const dir = n >= 0 ? pos : neg;
    return `${Math.abs(n).toFixed(4)}° ${dir}`;
  };

  return (
    <div className="hud-bar fixed bottom-0 left-0 right-0 z-30 flex items-center h-9 px-4 gap-0">
      {/* System status */}
      <div className="flex items-center gap-2 pr-4" style={{ borderRight: "1px solid rgba(30,48,75,0.6)" }}>
        <span className="status-dot live" />
        <span style={{ fontSize: 9, color: "#34d399", fontWeight: 700, letterSpacing: "0.08em" }}>SYSTEM NOMINAL</span>
      </div>

      {/* Entity counts */}
      {[
        { icon: <Plane className="w-2.5 h-2.5" />, count: aircraft, label: "AC",   color: "#38bdf8" },
        { icon: <Anchor className="w-2.5 h-2.5" />, count: ships,   label: "VSL",  color: "#fb923c" },
        { icon: <Satellite className="w-2.5 h-2.5" />, count: satellites, label: "SAT", color: "#a78bfa" },
        { icon: <Zap className="w-2.5 h-2.5" />, count: events,    label: "EVT",  color: "#f43f5e" },
      ].map((item) => (
        <div key={item.label} className="flex items-center gap-1.5 px-3"
          style={{ borderRight: "1px solid rgba(30,48,75,0.6)" }}>
          <span style={{ color: item.color }}>{item.icon}</span>
          <span className="font-mono-data" style={{ fontSize: 9, color: item.color, fontWeight: 700 }}>
            {item.count.toLocaleString()}
          </span>
          <span style={{ fontSize: 8, color: "rgba(100,116,139,0.6)" }}>{item.label}</span>
        </div>
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Coordinate readout */}
      {hoverCoords ? (
        <div className="flex items-center gap-2 px-3" style={{ borderLeft: "1px solid rgba(30,48,75,0.6)" }}>
          <Crosshair className="w-2.5 h-2.5" style={{ color: "rgba(56,189,248,0.5)" }} />
          <span className="coord-display">
            {fmtCoord(hoverCoords.latitude, "N", "S")}
          </span>
          <span style={{ color: "rgba(30,48,75,0.8)", fontSize: 9 }}>|</span>
          <span className="coord-display">
            {fmtCoord(hoverCoords.longitude, "E", "W")}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3" style={{ borderLeft: "1px solid rgba(30,48,75,0.6)" }}>
          <Crosshair className="w-2.5 h-2.5" style={{ color: "rgba(30,48,75,0.7)" }} />
          <span className="coord-display" style={{ color: "rgba(30,48,75,0.7)" }}>—°—′—″</span>
        </div>
      )}

      {/* UTC Clock */}
      <div className="pl-3" style={{ borderLeft: "1px solid rgba(30,48,75,0.6)" }}>
        <UtcClock />
      </div>
    </div>
  );
}

/* ─── Main Dashboard Page ───────────────────────────────────────────────── */
export default function DashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, loadUser, logout } = useAuthStore();
  const [sidebarOpen, setSidebarOpen]         = useState(true);
  const [selectedEntity, setSelectedEntity]   = useState<{ data: any; type: string } | null>(null);
  const [feedExpanded, setFeedExpanded]       = useState(true);
  const [hoverCoords, setHoverCoords]         = useState<{ longitude: number; latitude: number } | null>(null);
  const [terminalOpen, setTerminalOpen]       = useState(false);

  const [layerVis, setLayerVis] = useState<LayerVisibility>({
    aircraft: true, ships: true, satellites: true, events: true, heatmap: false, threats: true,
  });

  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push("/auth/login");
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  /* ─── Data hooks ────────────────────────────────────────────────────── */
  const { aircraft, loading: aircraftLoading } = useAircraft(isAuthenticated && layerVis.aircraft);
  const { satellites, loading: satLoading }    = useSatellites(isAuthenticated && layerVis.satellites);
  const ships                                  = useShips(isAuthenticated && layerVis.ships);

  const { data: trending = [] } = useQuery({
    queryKey: ["trending-events"],
    queryFn:  () => api.getTrendingEvents(48),
    enabled:  isAuthenticated,
    refetchInterval: 60_000,
  });

  /* ─── Geo events ────────────────────────────────────────────────────── */
  const geoEvents: GeoEvent[] = useMemo(() => {
    return (trending as any[])
      .map((ev: any) => {
        const countries = ev.countries_involved ?? [];
        const pos       = countriesToPosition(countries);
        if (!pos) return null;
        return {
          id: ev.event_id || String(Math.random()),
          title: ev.title,
          severity: ev.severity ?? 0.5,
          event_type: ev.event_type ?? "GEOPOLITICAL",
          position: pos,
          summary: ev.summary ?? "",
          countries,
        };
      })
      .filter(Boolean) as GeoEvent[];
  }, [trending]);

  /* ─── Threat index ──────────────────────────────────────────────────── */
  const threatScore = useMemo(() => {
    if (geoEvents.length === 0) return 0;
    const avg = geoEvents.reduce((s, e) => s + e.severity, 0) / geoEvents.length;
    const max = Math.max(...geoEvents.map((e) => e.severity));
    return Math.round((avg * 0.4 + max * 0.6) * 100);
  }, [geoEvents]);

  const criticalCount = (trending as any[]).filter((e: any) => e.severity >= 0.8).length;

  /* ─── Filtered events for sidebar ──────────────────────────────────── */
  const filteredEvents = useMemo(() => {
    return trending as any[];
  }, [trending]);

  const handleEntitySelect = useCallback((data: any, type: "aircraft" | "ship" | "satellite" | "event") => {
    setSelectedEntity({ data, type });
  }, []);

  const toggleLayer = (key: keyof LayerVisibility) =>
    setLayerVis((prev) => ({ ...prev, [key]: !prev[key] }));

  /* ─── Loading screen ────────────────────────────────────────────────── */
  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center hex-grid-bg">
        <div className="relative w-16 h-16 mb-6">
          <div className="absolute inset-0 rounded-full border border-sky-500/20 animate-ping" />
          <div className="absolute inset-2 rounded-full border-t-2 border-sky-400 animate-spin" />
          <Shield className="absolute inset-0 m-auto w-6 h-6 text-sky-400" />
        </div>
        <p className="text-slate-500 text-xs tracking-widest uppercase font-display">Initialising Secure Session</p>
      </div>
    );
  }
  if (!isAuthenticated) return null;

  /* ─── Render ────────────────────────────────────────────────────────── */
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: "#020408" }}>

      {/* ── Full-screen map ─────────────────────────────────────────── */}
      <div className="absolute inset-0" style={{ bottom: 36 }}>
        <IntelMap
          aircraft={aircraft}
          ships={ships}
          satellites={satellites}
          events={geoEvents}
          layers={layerVis}
          onEntitySelect={handleEntitySelect}
          onMapHover={setHoverCoords}
        />
      </div>

      {/* ── Top Navigation Bar ───────────────────────────────────────── */}
      <header
        className="fixed top-0 left-0 right-0 z-30 flex items-center gap-3 px-4"
        style={{
          height: 48,
          background: "rgba(2, 6, 14, 0.95)",
          borderBottom: "1px solid rgba(30,48,75,0.7)",
          backdropFilter: "blur(24px)",
        }}
      >
        {/* Logo / hamburger */}
        <button onClick={() => setSidebarOpen((o) => !o)}
          className="flex items-center gap-2.5 mr-1 shrink-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center relative"
            style={{ background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)", boxShadow: "0 0 16px rgba(99,102,241,0.5)" }}>
            <Shield className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="hidden sm:block">
            <p className="font-display text-sm font-bold leading-none" style={{ color: "#f1f5f9" }}>
              सर्वज्ञ Sarwagya
            </p>
            <p style={{ fontSize: 8, color: "rgba(56,189,248,0.6)", letterSpacing: "0.12em" }}>GEOSPATIAL INTELLIGENCE</p>
          </div>
        </button>

        {/* Divider */}
        <div className="hud-divider" style={{ height: 28 }} />

        {/* Layer toggles */}
        <div className="flex items-center gap-1.5 flex-1 flex-wrap">
          <LayerToggle label="Aircraft"   icon={<Plane      className="w-3 h-3" />} count={aircraft.length}   active={layerVis.aircraft}   color="#38bdf8" onClick={() => toggleLayer("aircraft")} />
          <LayerToggle label="Vessels"    icon={<Anchor     className="w-3 h-3" />} count={ships.length}      active={layerVis.ships}      color="#fb923c" onClick={() => toggleLayer("ships")} />
          <LayerToggle label="Satellites" icon={<Satellite  className="w-3 h-3" />} count={satellites.length} active={layerVis.satellites} color="#a78bfa" onClick={() => toggleLayer("satellites")} />
          <LayerToggle label="Events"     icon={<Zap        className="w-3 h-3" />} count={geoEvents.length}  active={layerVis.events}     color="#f43f5e" onClick={() => toggleLayer("events")} />

          {/* Separator */}
          <div className="hud-divider mx-0.5" style={{ height: 20 }} />

          {/* Extra layer toggles */}
          <LayerToggle label="Heatmap"    icon={<Thermometer className="w-3 h-3" />} count={0} active={layerVis.heatmap}  color="#06b6d4" onClick={() => toggleLayer("heatmap")} />
          <LayerToggle label="Threat Zones" icon={<Target   className="w-3 h-3" />} count={0} active={layerVis.threats}  color="#f59e0b" onClick={() => toggleLayer("threats")} />
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-3 shrink-0">
          {criticalCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold animate-threat-pulse"
              style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
              <AlertCircle className="w-3 h-3" />
              {criticalCount} CRITICAL
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="status-dot live" />
            <span style={{ fontSize: 9, color: "#34d399", fontWeight: 700, letterSpacing: "0.08em" }}>LIVE</span>
          </div>
          {/* User avatar */}
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold cursor-pointer"
            style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)", boxShadow: "0 0 12px rgba(99,102,241,0.4)" }}
            title={user?.email}
            onClick={() => { logout(); router.push("/auth/login"); }}
          >
            {user?.email?.[0]?.toUpperCase() ?? "U"}
          </div>
        </div>
      </header>

      {/* ── Left Sidebar ─────────────────────────────────────────────── */}
      <aside
        className="fixed top-0 left-0 h-full z-20 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width: 280,
          paddingTop: 48,
          paddingBottom: 36,
          transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
          background: "rgba(2, 6, 14, 0.96)",
          borderRight: "1px solid rgba(20,35,60,0.8)",
          backdropFilter: "blur(28px)",
        }}
      >
        {/* Threat Gauge */}
        <div style={{ borderBottom: "1px solid rgba(20,35,60,0.7)" }}>
          <div className="px-4 pt-3 pb-0 flex items-center gap-2">
            <div className="w-1 h-3 rounded-full" style={{ background: "linear-gradient(to bottom, #38bdf8, #6366f1)" }} />
            <span style={{ fontSize: 9, color: "rgba(56,189,248,0.7)", fontWeight: 700, letterSpacing: "0.1em" }}>THREAT ASSESSMENT</span>
          </div>
          <ThreatGauge
            threatScore={threatScore}
            eventCount={geoEvents.length}
            criticalCount={criticalCount}
          />
        </div>

        {/* Stats grid */}
        <div className="p-3 grid grid-cols-2 gap-2" style={{ borderBottom: "1px solid rgba(20,35,60,0.7)" }}>
          <StatCard icon={<Plane     className="w-3.5 h-3.5" />} label="Aircraft"   value={aircraft.length.toLocaleString()}   color="#38bdf8" loading={aircraftLoading} sub="live" />
          <StatCard icon={<Anchor    className="w-3.5 h-3.5" />} label="Vessels"    value={ships.length.toLocaleString()}       color="#fb923c" loading={false}           sub="routes" />
          <StatCard icon={<Satellite className="w-3.5 h-3.5" />} label="Satellites" value={satellites.length.toLocaleString()}  color="#a78bfa" loading={satLoading}      sub="orbital" />
          <StatCard icon={<Zap       className="w-3.5 h-3.5" />} label="Events"     value={geoEvents.length.toLocaleString()}   color="#f43f5e" loading={false}           sub="intel" />
        </div>

        {/* Intelligence Feed */}
        <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
          {/* Feed header */}
          <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(20,35,60,0.5)" }}>
            <Radio className="w-3 h-3 animate-pulse" style={{ color: "#38bdf8" }} />
            <span style={{ fontSize: 9, color: "#38bdf8", fontWeight: 800, letterSpacing: "0.12em" }}>
              LIVE INTELLIGENCE FEED
            </span>
            <button
              onClick={() => setFeedExpanded((f) => !f)}
              className="ml-auto transition-colors"
              style={{ color: "rgba(100,116,139,0.6)" }}>
              {feedExpanded
                ? <ChevronUp className="w-3 h-3" />
                : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>

          {feedExpanded && (
            <>
              {/* ── AI Query Terminal trigger ─────────────────────────── */}
              <div className="px-3 pt-3 pb-2">
                <button
                  onClick={() => setTerminalOpen(true)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all"
                  style={{
                    background: "rgba(6,12,26,0.9)",
                    border: "1px solid rgba(56,189,248,0.15)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(56,189,248,0.35)";
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(10,20,42,0.95)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(56,189,248,0.15)";
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(6,12,26,0.9)";
                  }}
                >
                  <div className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                    style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)" }}>
                    <Cpu className="w-3 h-3" style={{ color: "#38bdf8" }} />
                  </div>
                  <div className="flex-1 text-left">
                    <p style={{ fontSize: 10, color: "rgba(148,163,184,0.6)", letterSpacing: "0.02em" }}>
                      Ask about relations, trade, sectors…
                    </p>
                  </div>
                  <Search className="w-3 h-3 shrink-0" style={{ color: "rgba(56,189,248,0.4)" }} />
                </button>
                <p style={{ fontSize: 8, color: "rgba(51,65,85,0.8)", textAlign: "center", marginTop: 5, letterSpacing: "0.05em" }}>
                  AI-powered · Groq LLaMA-3.3-70B
                </p>
              </div>

              {/* Event list */}
              <div className="px-2 pb-2 space-y-0.5 flex-1">
                {filteredEvents.length === 0 ? (
                  <p style={{ fontSize: 11, color: "rgba(71,85,105,0.7)", textAlign: "center", padding: "24px 12px" }}>
                    No events match filters
                  </p>
                ) : (
                  filteredEvents.map((ev: any, i: number) => {
                    const geo = geoEvents.find((g) => g.id === (ev.event_id || String(ev.title)));
                    return (
                      <IntelEventRow
                        key={ev.event_id ?? i}
                        event={{
                          id:         ev.event_id ?? String(i),
                          title:      ev.title,
                          severity:   ev.severity ?? 0.5,
                          event_type: ev.event_type ?? "EVENT",
                          position:   geo?.position ?? [0, 0],
                          summary:    ev.summary ?? "",
                          countries:  ev.countries_involved ?? [],
                        }}
                        onClick={() => handleEntitySelect({
                          id:         ev.event_id,
                          title:      ev.title,
                          severity:   ev.severity,
                          event_type: ev.event_type,
                          summary:    ev.summary,
                          countries:  ev.countries_involved ?? [],
                          position:   geo?.position ?? [0, 0],
                        }, "event")}
                      />
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* Data source legend */}
        <div className="px-4 py-3 space-y-1.5" style={{ borderTop: "1px solid rgba(20,35,60,0.7)" }}>
          <p style={{ fontSize: 8, color: "rgba(71,85,105,0.8)", fontWeight: 800, letterSpacing: "0.1em", marginBottom: 6 }}>DATA SOURCES</p>
          {[
            { dot: "#38bdf8", label: "Aircraft",   src: "OpenSky Network · Live" },
            { dot: "#fb923c", label: "Vessels",    src: "Simulated trade routes" },
            { dot: "#a78bfa", label: "Satellites", src: "CelesTrak TLE · satellite.js" },
            { dot: "#f43f5e", label: "Events",     src: "Sarwagya AI Platform" },
          ].map(({ dot, label, src }) => (
            <div key={label} className="flex items-start gap-2">
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: dot, marginTop: 4, boxShadow: `0 0 4px ${dot}80`, flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: 10, color: "rgba(100,116,139,0.8)", fontWeight: 500 }}>{label}</p>
                <p style={{ fontSize: 8, color: "rgba(51,65,85,0.9)" }}>{src}</p>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Entity Detail Panel ───────────────────────────────────────── */}
      {selectedEntity && (
        <EntityDetailPanel
          entity={selectedEntity.data}
          type={selectedEntity.type}
          onClose={() => setSelectedEntity(null)}
        />
      )}

      {/* ── Intelligence Query Terminal ───────────────────────────────── */}
      <IntelQueryTerminal isOpen={terminalOpen} onClose={() => setTerminalOpen(false)} />

      {/* ── Bottom HUD ───────────────────────────────────────────────── */}
      <BottomHUD
        aircraft={aircraft.length}
        ships={ships.length}
        satellites={satellites.length}
        events={geoEvents.length}
        hoverCoords={hoverCoords}
      />
    </div>
  );
}
