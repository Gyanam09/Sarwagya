"use client";
/**
 * /events — Dedicated events page with filters, search, and pagination
 */
import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  Shield, Zap, Search, Filter, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, AlertCircle, Calendar,
  Globe, Download, X, SlidersHorizontal, ArrowUpDown,
  Network, Settings,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { api } from "@/lib/api";

/* ─── Types ─────────────────────────────────────────────────────────────── */
const EVENT_TYPES = [
  "TARIFF", "MILITARY_ACTION", "TREATY", "ECONOMIC_POLICY",
  "EMBARGO", "DIPLOMATIC", "CONFLICT", "SANCTIONS", "ELECTION",
] as const;

const SEV_STYLE: Record<string, { bg: string; text: string; border: string; dot: string; hex: string }> = {
  CRITICAL: { bg: "rgba(239,68,68,0.12)",  text: "#f87171", border: "rgba(239,68,68,0.3)",  dot: "bg-red-400",     hex: "#ef4444" },
  HIGH:     { bg: "rgba(249,115,22,0.12)", text: "#fb923c", border: "rgba(249,115,22,0.3)", dot: "bg-orange-400",  hex: "#f97316" },
  MEDIUM:   { bg: "rgba(234,179,8,0.12)",  text: "#fbbf24", border: "rgba(234,179,8,0.3)",  dot: "bg-amber-400",   hex: "#f59e0b" },
  LOW:      { bg: "rgba(34,197,94,0.12)",  text: "#34d399", border: "rgba(34,197,94,0.3)",  dot: "bg-emerald-400", hex: "#10b981" },
};

function sevKey(s: number) {
  return s >= 0.8 ? "CRITICAL" : s >= 0.6 ? "HIGH" : s >= 0.4 ? "MEDIUM" : "LOW";
}

const NAV_LINKS = [
  { label: "DASHBOARD", href: "/dashboard" },
  { label: "EVENTS", href: "/events", active: true },
  { label: "GRAPH", href: "/graph" },
  { label: "SETTINGS", href: "/settings" },
];

/* ─── Row component ─────────────────────────────────────────────────────── */
function EventRow({ event, onClick, expanded }: {
  event: any; onClick: () => void; expanded: boolean;
}) {
  const sk = sevKey(event.severity ?? 0.5);
  const sev = SEV_STYLE[sk];

  return (
    <div>
      <button
        onClick={onClick}
        className="w-full text-left px-4 py-3 transition-all flex items-start gap-4"
        style={{
          borderBottom: expanded ? "none" : "1px solid rgba(20,35,60,0.5)",
          background: expanded ? "rgba(8,16,30,0.9)" : "transparent",
        }}
        onMouseEnter={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.background = "rgba(8,16,30,0.6)"; }}
        onMouseLeave={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        {/* Severity indicator */}
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          <div className={`w-2 h-2 rounded-full ${sev.dot}`}
            style={{ boxShadow: `0 0 5px ${sev.hex}` }} />
          <span className="font-mono-data text-[10px] font-bold w-16" style={{ color: sev.text }}>
            {sk}
          </span>
        </div>

        {/* Title + type */}
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-sm leading-snug" style={{ color: "#e2e8f0" }}>
            {event.title}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.15)", color: "#38bdf8", letterSpacing: "0.06em" }}>
              {event.event_type?.replace(/_/g, " ")}
            </span>
            {event.countries_involved?.slice(0, 4).map((c: string) => (
              <span key={c} className="text-[9px] px-1.5 py-0.5 rounded"
                style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.15)", color: "#a78bfa" }}>
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Date + severity bar */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="font-mono-data text-[10px]" style={{ color: "rgba(100,116,139,0.6)" }}>
            {event.date}
          </span>
          <div style={{ width: 48, height: 3, background: "rgba(30,48,75,0.8)", borderRadius: 2 }}>
            <div style={{
              width: `${(event.severity ?? 0.5) * 100}%`, height: "100%",
              background: `linear-gradient(to right, ${sev.hex}88, ${sev.hex})`, borderRadius: 2
            }} />
          </div>
          <span className="font-mono-data text-[9px]" style={{ color: sev.text }}>
            {((event.severity ?? 0.5) * 100).toFixed(0)}%
          </span>
        </div>

        <ChevronDown className={`w-3.5 h-3.5 shrink-0 mt-1 transition-transform ${expanded ? "rotate-180" : ""}`}
          style={{ color: "rgba(56,189,248,0.4)" }} />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 animate-fade-in-up"
          style={{ borderBottom: "1px solid rgba(20,35,60,0.5)", background: "rgba(6,12,26,0.9)" }}>
          <div className="rounded-xl p-4 space-y-2" style={{ background: "rgba(2,6,14,0.8)", border: "1px solid rgba(20,35,60,0.7)" }}>
            <p style={{ fontSize: 9, color: "rgba(56,189,248,0.7)", fontWeight: 800, letterSpacing: "0.1em", marginBottom: 6 }}>
              INTELLIGENCE SUMMARY
            </p>
            <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>{event.summary}</p>
            {event.affected_sectors?.length > 0 && (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span style={{ fontSize: 9, color: "rgba(100,116,139,0.6)", fontWeight: 700 }}>SECTORS:</span>
                {event.affected_sectors.map((s: string) => (
                  <span key={s} style={{ fontSize: 9, color: "rgba(251,191,36,0.8)", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)", padding: "1px 6px", borderRadius: 4 }}>
                    {s.toUpperCase()}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 mt-3">
              {event.countries_involved?.map((c: string) => (
                <button key={c} onClick={() => window.location.href = `/country/${c}`}
                  className="flex items-center gap-1 transition-colors hover:opacity-80">
                  <Globe className="w-3 h-3" style={{ color: "#a78bfa" }} />
                  <span style={{ fontSize: 10, color: "#a78bfa", fontWeight: 600 }}>{c}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────── */
export default function EventsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, loadUser } = useAuthStore();

  const [search, setSearch]         = useState("");
  const [debouncedSearch, setDS]    = useState("");
  const [activeTypes, setActiveTypes] = useState<string[]>([]);
  const [minSeverity, setMinSeverity] = useState(0);
  const [sortBy, setSortBy]          = useState<"date" | "severity">("date");
  const [page, setPage]              = useState(1);
  const [expandedId, setExpandedId]  = useState<string | null>(null);
  const PAGE_SIZE = 25;

  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push("/auth/login");
  }, [authLoading, isAuthenticated, router]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDS(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const queryParams = useMemo(() => ({
    search: debouncedSearch || undefined,
    event_type: activeTypes.length === 1 ? activeTypes[0] : undefined,
    min_severity: minSeverity || undefined,
    sort_by: sortBy,
    page,
    page_size: PAGE_SIZE,
  }), [debouncedSearch, activeTypes, minSeverity, sortBy, page]);

  const { data, isLoading } = useQuery({
    queryKey: ["events", queryParams],
    queryFn: () => api.getEvents(queryParams),
    enabled: isAuthenticated,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const events: any[] = (data as any)?.events ?? [];
  const total: number = (data as any)?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleType = (t: string) =>
    setActiveTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `sarwagya-events-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#020408" }}>
      {/* Header */}
      <header className="flex items-center gap-4 px-4 shrink-0 z-30 sticky top-0"
        style={{ height: 48, background: "rgba(2,6,14,0.97)", borderBottom: "1px solid rgba(30,48,75,0.7)", backdropFilter: "blur(24px)" }}>
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", boxShadow: "0 0 16px rgba(99,102,241,0.5)" }}>
            <Shield className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-display text-sm font-bold hidden sm:block" style={{ color: "#f1f5f9" }}>सर्वज्ञ Sarwagya</span>
        </button>
        <div className="h-5 w-px" style={{ background: "rgba(56,189,248,0.12)" }} />
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <button key={link.label} onClick={() => router.push(link.href)}
              className="px-3 py-1 rounded text-[10px] font-bold tracking-widest transition-all"
              style={{
                color: link.active ? "#38bdf8" : "rgba(100,116,139,0.7)",
                background: link.active ? "rgba(56,189,248,0.08)" : "transparent",
                border: `1px solid ${link.active ? "rgba(56,189,248,0.2)" : "transparent"}`,
              }}>
              {link.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 space-y-4">
        {/* Page title */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(244,63,94,0.12)", border: "1px solid rgba(244,63,94,0.25)" }}>
            <Zap className="w-4 h-4" style={{ color: "#f43f5e" }} />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold" style={{ color: "#f1f5f9" }}>Intelligence Events</h1>
            <p style={{ fontSize: 11, color: "rgba(100,116,139,0.6)" }}>
              {isLoading ? "Loading…" : `${total.toLocaleString()} events in database`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={exportJSON}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all"
              style={{ background: "rgba(8,16,30,0.9)", border: "1px solid rgba(30,48,75,0.7)", color: "rgba(100,116,139,0.8)" }}>
              <Download className="w-3 h-3" /> EXPORT JSON
            </button>
          </div>
        </div>

        {/* Filters bar */}
        <div className="rounded-xl p-4 space-y-3"
          style={{ background: "rgba(6,12,26,0.9)", border: "1px solid rgba(30,48,75,0.6)" }}>
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: "rgba(2,6,14,0.8)", border: "1px solid rgba(30,48,75,0.7)" }}>
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "rgba(56,189,248,0.5)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events by title or summary…"
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "#e2e8f0" }}
            />
            {search && (
              <button onClick={() => setSearch("")}>
                <X className="w-3 h-3" style={{ color: "rgba(100,116,139,0.5)" }} />
              </button>
            )}
          </div>

          {/* Type chips + severity + sort */}
          <div className="flex items-center gap-3 flex-wrap">
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" style={{ color: "rgba(100,116,139,0.5)" }} />
            <div className="flex items-center gap-1.5 flex-wrap">
              {EVENT_TYPES.map((t) => {
                const on = activeTypes.includes(t);
                return (
                  <button key={t} onClick={() => { toggleType(t); setPage(1); }}
                    className="px-2 py-0.5 rounded text-[9px] font-bold tracking-wider transition-all"
                    style={{
                      background: on ? "rgba(56,189,248,0.12)" : "rgba(8,16,30,0.8)",
                      border: `1px solid ${on ? "rgba(56,189,248,0.3)" : "rgba(30,48,75,0.6)"}`,
                      color: on ? "#38bdf8" : "rgba(71,85,105,0.8)",
                    }}>
                    {t.replace(/_/g, " ")}
                  </button>
                );
              })}
              {activeTypes.length > 0 && (
                <button onClick={() => { setActiveTypes([]); setPage(1); }}
                  style={{ fontSize: 9, color: "rgba(244,63,94,0.7)", fontWeight: 700 }}>
                  CLEAR
                </button>
              )}
            </div>

            <div className="h-4 w-px ml-auto" style={{ background: "rgba(30,48,75,0.6)" }} />

            {/* Severity filter */}
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 9, color: "rgba(100,116,139,0.6)", fontWeight: 700 }}>MIN SEV</span>
              <input type="range" min={0} max={0.8} step={0.1} value={minSeverity}
                onChange={(e) => { setMinSeverity(Number(e.target.value)); setPage(1); }}
                className="w-24 accent-sky-400 h-1"
              />
              <span className="font-mono-data text-[10px]" style={{ color: "#38bdf8" }}>
                {(minSeverity * 100).toFixed(0)}%
              </span>
            </div>

            {/* Sort */}
            <button onClick={() => setSortBy(s => s === "date" ? "severity" : "date")}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all"
              style={{ background: "rgba(8,16,30,0.8)", border: "1px solid rgba(30,48,75,0.6)", color: "rgba(100,116,139,0.8)" }}>
              <ArrowUpDown className="w-3 h-3" />
              {sortBy === "date" ? "BY DATE" : "BY SEVERITY"}
            </button>
          </div>
        </div>

        {/* Events table */}
        <div className="rounded-xl overflow-hidden"
          style={{ background: "rgba(4,11,20,0.9)", border: "1px solid rgba(20,35,60,0.7)" }}>
          {/* Table header */}
          <div className="grid px-4 py-2.5 text-[9px] font-bold tracking-widest border-b"
            style={{ gridTemplateColumns: "80px 1fr auto 80px 40px", color: "rgba(56,189,248,0.5)", borderColor: "rgba(20,35,60,0.7)", background: "rgba(2,6,14,0.6)" }}>
            <span>SEVERITY</span>
            <span>TITLE</span>
            <span>TYPE</span>
            <span className="text-right">DATE</span>
            <span />
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 rounded-full border-t-2 border-sky-400 animate-spin" />
                <p style={{ fontSize: 11, color: "rgba(100,116,139,0.5)" }}>Fetching intelligence…</p>
              </div>
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <AlertCircle className="w-8 h-8" style={{ color: "rgba(100,116,139,0.4)" }} />
              <p style={{ fontSize: 13, color: "rgba(100,116,139,0.6)" }}>No events match your filters</p>
              <button onClick={() => { setSearch(""); setActiveTypes([]); setMinSeverity(0); setPage(1); }}
                style={{ fontSize: 10, color: "#38bdf8", fontWeight: 700 }}>
                CLEAR ALL FILTERS
              </button>
            </div>
          ) : (
            events.map((ev: any, i: number) => (
              <EventRow
                key={ev.event_id ?? i}
                event={ev}
                expanded={expandedId === (ev.event_id ?? String(i))}
                onClick={() => setExpandedId(id => id === (ev.event_id ?? String(i)) ? null : (ev.event_id ?? String(i)))}
              />
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p style={{ fontSize: 11, color: "rgba(100,116,139,0.5)" }}>
              Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded-lg transition-colors disabled:opacity-30"
                style={{ background: "rgba(8,16,30,0.8)", border: "1px solid rgba(30,48,75,0.6)", color: "#38bdf8" }}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pg = Math.max(1, Math.min(page - 2 + i, totalPages - 4 + i));
                return (
                  <button key={pg} onClick={() => setPage(pg)}
                    className="w-7 h-7 rounded-lg text-[10px] font-bold transition-all"
                    style={{
                      background: page === pg ? "rgba(56,189,248,0.15)" : "rgba(8,16,30,0.8)",
                      border: `1px solid ${page === pg ? "rgba(56,189,248,0.3)" : "rgba(30,48,75,0.6)"}`,
                      color: page === pg ? "#38bdf8" : "rgba(100,116,139,0.7)",
                    }}>
                    {pg}
                  </button>
                );
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="p-1.5 rounded-lg transition-colors disabled:opacity-30"
                style={{ background: "rgba(8,16,30,0.8)", border: "1px solid rgba(30,48,75,0.6)", color: "#38bdf8" }}>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
