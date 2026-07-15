"use client";
/**
 * /country/[iso3] — Full country intelligence brief
 * Tabs: Overview · Relations · Events · Trade · AI Brief
 */
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Shield, Globe, TrendingUp, ArrowLeft, Zap, GitBranch,
  AlertCircle, ChevronRight, Loader2, BarChart3, Network,
  FileText, RefreshCw, DollarSign, Users, Activity,
  Crosshair, Radio, Map,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { api } from "@/lib/api";

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const SEV_STYLE: Record<string, { text: string; hex: string; bg: string; border: string }> = {
  CRITICAL: { text: "#f87171", hex: "#ef4444", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.25)" },
  HIGH:     { text: "#fb923c", hex: "#f97316", bg: "rgba(249,115,22,0.1)", border: "rgba(249,115,22,0.25)" },
  MEDIUM:   { text: "#fbbf24", hex: "#f59e0b", bg: "rgba(234,179,8,0.1)", border: "rgba(234,179,8,0.25)" },
  LOW:      { text: "#34d399", hex: "#10b981", bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.25)" },
};
function sevKey(s: number) {
  return s >= 0.8 ? "CRITICAL" : s >= 0.6 ? "HIGH" : s >= 0.4 ? "MEDIUM" : "LOW";
}
function fmt(n?: number | null, unit = "") {
  if (n == null) return "N/A";
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T${unit}`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B${unit}`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M${unit}`;
  return n.toLocaleString() + unit;
}

const REL_COLORS: Record<string, string> = {
  TRADES_WITH: "#38bdf8",   ALLY_OF: "#34d399",
  SANCTIONS: "#f43f5e",     CONFLICT_WITH: "#fb923c",
  INVESTS_IN: "#a78bfa",    INVOLVED_IN: "#64748b",
};

const NAV_LINKS = [
  { label: "DASHBOARD", href: "/dashboard" },
  { label: "EVENTS", href: "/events" },
  { label: "GRAPH", href: "/graph" },
  { label: "SETTINGS", href: "/settings" },
];

type Tab = "overview" | "relations" | "events" | "trade" | "brief";

/* ─── Metric card ────────────────────────────────────────────────────────── */
function MetricCard({ icon, label, value, color, sub }: {
  icon: React.ReactNode; label: string; value: string; color: string; sub?: string;
}) {
  return (
    <div className="rounded-xl p-4 relative overflow-hidden"
      style={{ background: "rgba(6,12,26,0.9)", border: `1px solid ${color}20` }}>
      <div style={{ position: "absolute", top: -16, right: -16, width: 64, height: 64,
        background: `radial-gradient(circle, ${color}14 0%, transparent 70%)`, pointerEvents: "none" }} />
      <div className="flex items-center gap-1.5 mb-2">
        <span style={{ color }}>{icon}</span>
        <span style={{ fontSize: 9, color: "rgba(100,116,139,0.7)", fontWeight: 700, letterSpacing: "0.08em" }}>{label}</span>
      </div>
      <p className="font-mono-data text-xl font-black" style={{ color, fontFamily: "JetBrains Mono,monospace" }}>{value}</p>
      {sub && <p style={{ fontSize: 9, color: "rgba(100,116,139,0.4)", marginTop: 2 }}>{sub}</p>}
    </div>
  );
}

/* ─── AI Brief section ───────────────────────────────────────────────────── */
function BriefSection({ heading, content }: { heading: string; content: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "rgba(2,6,14,0.8)", border: "1px solid rgba(20,35,60,0.6)" }}>
      <p style={{ fontSize: 9, color: "rgba(56,189,248,0.7)", fontWeight: 800, letterSpacing: "0.1em", marginBottom: 8 }}>{heading}</p>
      <p style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.75 }}>{content}</p>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────── */
export default function CountryPage() {
  const router = useRouter();
  const params = useParams();
  const iso3 = (params?.iso3 as string ?? "").toUpperCase();
  const { isAuthenticated, isLoading: authLoading, loadUser } = useAuthStore();
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push("/auth/login");
  }, [authLoading, isAuthenticated, router]);

  // Fetch country profile
  const { data: country, isLoading: cLoading, isError: cError } = useQuery({
    queryKey: ["country", iso3],
    queryFn: () => api.getCountry(iso3),
    enabled: isAuthenticated && !!iso3,
  });

  // Fetch relationships
  const { data: relData, isLoading: rLoading } = useQuery({
    queryKey: ["country-relations", iso3],
    queryFn: () => api.getCountryRelationships(iso3),
    enabled: isAuthenticated && !!iso3 && tab === "relations",
  });

  // Fetch events for this country
  const { data: eventsData, isLoading: eLoading } = useQuery({
    queryKey: ["country-events", iso3],
    queryFn: () => api.getEvents({ country: iso3, sort_by: "severity", page_size: 20 }),
    enabled: isAuthenticated && !!iso3 && tab === "events",
  });

  // Fetch trade partners
  const { data: tradeData, isLoading: tLoading } = useQuery({
    queryKey: ["trade-partners", iso3],
    queryFn: () => api.getTradePartners(iso3, 10),
    enabled: isAuthenticated && !!iso3 && tab === "trade",
  });

  // Generate AI brief (on-demand)
  const briefMutation = useMutation({
    mutationFn: () => api.generateCountryBrief(iso3),
  });

  const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "overview",  label: "Overview",   icon: <Globe className="w-3 h-3" /> },
    { id: "relations", label: "Relations",  icon: <GitBranch className="w-3 h-3" /> },
    { id: "events",    label: "Events",     icon: <Zap className="w-3 h-3" /> },
    { id: "trade",     label: "Trade",      icon: <TrendingUp className="w-3 h-3" /> },
    { id: "brief",     label: "AI Brief",   icon: <FileText className="w-3 h-3" /> },
  ];

  if (authLoading) return null;

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
              style={{ color: "rgba(100,116,139,0.7)", background: "transparent", border: "1px solid transparent" }}>
              {link.label}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <button onClick={() => router.push("/graph")}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold transition-all"
          style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)", color: "#a78bfa" }}>
          <Network className="w-3 h-3" /> VIEW IN GRAPH
        </button>
      </header>

      {/* Country hero */}
      <div className="relative overflow-hidden"
        style={{ background: "linear-gradient(to bottom, rgba(6,12,26,0.95), rgba(2,6,14,0.98))", borderBottom: "1px solid rgba(30,48,75,0.6)" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 70% 50%, rgba(56,189,248,0.05) 0%, transparent 60%)" }} />
        <div className="max-w-5xl mx-auto px-6 py-8">
          <button onClick={() => router.back()}
            className="flex items-center gap-1.5 mb-4 text-[10px] font-bold tracking-widest transition-colors hover:opacity-80"
            style={{ color: "rgba(56,189,248,0.6)" }}>
            <ArrowLeft className="w-3 h-3" /> BACK
          </button>
          {cLoading ? (
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl animate-shimmer" style={{ background: "rgba(20,32,55,0.8)" }} />
              <div className="space-y-2">
                <div className="w-48 h-6 rounded animate-shimmer" style={{ background: "rgba(20,32,55,0.8)" }} />
                <div className="w-24 h-3 rounded animate-shimmer" style={{ background: "rgba(20,32,55,0.6)" }} />
              </div>
            </div>
          ) : cError ? (
            <div className="flex items-center gap-3">
              <AlertCircle className="w-8 h-8" style={{ color: "#f87171" }} />
              <div>
                <h1 className="font-display text-2xl font-bold" style={{ color: "#f87171" }}>Country not found</h1>
                <p style={{ fontSize: 12, color: "rgba(100,116,139,0.6)" }}>{iso3} is not in the database yet. Run the pipeline to populate.</p>
              </div>
            </div>
          ) : country ? (
            <div className="flex items-start gap-6">
              {/* Country badge */}
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black shrink-0"
                style={{ background: "linear-gradient(135deg, rgba(56,189,248,0.15), rgba(99,102,241,0.15))", border: "1px solid rgba(56,189,248,0.2)", color: "#38bdf8", fontFamily: "Space Grotesk" }}>
                {iso3.slice(0, 2)}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="font-display text-3xl font-bold" style={{ color: "#f1f5f9" }}>{country.name}</h1>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.15)", color: "#38bdf8" }}>
                    {iso3}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "rgba(100,116,139,0.7)" }}>{country.region}</p>
                <div className="flex items-center gap-4 mt-3 flex-wrap">
                  {country.political_stability != null && (
                    <div className="flex items-center gap-1.5">
                      <Activity className="w-3 h-3" style={{ color: "#34d399" }} />
                      <span style={{ fontSize: 11, color: "#34d399", fontWeight: 700 }}>
                        Stability {(country.political_stability * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                  {country.democracy_score != null && (
                    <div className="flex items-center gap-1.5">
                      <Crosshair className="w-3 h-3" style={{ color: "#a78bfa" }} />
                      <span style={{ fontSize: 11, color: "#a78bfa", fontWeight: 700 }}>
                        Democracy {(country.democracy_score * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                  {country.trade_openness != null && (
                    <div className="flex items-center gap-1.5">
                      <Globe className="w-3 h-3" style={{ color: "#fb923c" }} />
                      <span style={{ fontSize: 11, color: "#fb923c", fontWeight: 700 }}>
                        Trade Openness {(country.trade_openness * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Tab bar */}
      <div className="sticky top-[48px] z-20" style={{ background: "rgba(4,11,20,0.98)", borderBottom: "1px solid rgba(20,35,60,0.7)", backdropFilter: "blur(20px)" }}>
        <div className="max-w-5xl mx-auto px-4 flex items-center gap-0.5 py-1">
          {TABS.map(({ id, label, icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold tracking-wider transition-all"
              style={{
                color: tab === id ? "#38bdf8" : "rgba(100,116,139,0.6)",
                background: tab === id ? "rgba(56,189,248,0.08)" : "transparent",
                border: `1px solid ${tab === id ? "rgba(56,189,248,0.2)" : "transparent"}`,
              }}>
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">

        {/* ── OVERVIEW ── */}
        {tab === "overview" && country && (
          <div className="space-y-4 animate-fade-in-up">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard icon={<Users className="w-3.5 h-3.5" />} label="POPULATION"
                value={fmt(country.population)} color="#38bdf8" sub="people" />
              <MetricCard icon={<DollarSign className="w-3.5 h-3.5" />} label="GDP"
                value={fmt(country.gdp_usd, "$")} color="#34d399" sub="USD" />
              <MetricCard icon={<TrendingUp className="w-3.5 h-3.5" />} label="GDP GROWTH"
                value={country.gdp_growth != null ? `${country.gdp_growth.toFixed(2)}%` : "N/A"} color="#fbbf24" sub="annual" />
              <MetricCard icon={<Activity className="w-3.5 h-3.5" />} label="STABILITY"
                value={country.political_stability != null ? `${(country.political_stability * 100).toFixed(0)}%` : "N/A"}
                color="#a78bfa" sub="index" />
            </div>

            {/* Quick link cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
              {[
                { tab: "relations" as Tab, icon: <GitBranch className="w-4 h-4" />, label: "View Relationships", color: "#34d399" },
                { tab: "events" as Tab, icon: <Radio className="w-4 h-4" />, label: "Recent Intel Events", color: "#f43f5e" },
                { tab: "brief" as Tab, icon: <FileText className="w-4 h-4" />, label: "Generate AI Brief", color: "#a78bfa" },
              ].map(({ tab: t, icon, label, color }) => (
                <button key={t} onClick={() => setTab(t)}
                  className="flex items-center gap-3 p-4 rounded-xl transition-all text-left"
                  style={{ background: "rgba(6,12,26,0.9)", border: `1px solid ${color}20` }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.borderColor = color + "40"}
                  onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.borderColor = color + "20"}>
                  <span style={{ color }}>{icon}</span>
                  <span style={{ fontSize: 13, color: "#cbd5e1", fontWeight: 600 }}>{label}</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-auto" style={{ color: "rgba(100,116,139,0.4)" }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── RELATIONS ── */}
        {tab === "relations" && (
          <div className="space-y-2 animate-fade-in-up">
            {rLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#38bdf8" }} />
              </div>
            ) : relData?.relationships?.length === 0 || !relData?.relationships ? (
              <div className="text-center py-16">
                <p style={{ fontSize: 13, color: "rgba(100,116,139,0.5)" }}>
                  No relationships in graph yet. Run the data pipeline to populate.
                </p>
              </div>
            ) : (
              relData.relationships.map((rel: any, i: number) => {
                const color = REL_COLORS[rel.rel] ?? "#64748b";
                return (
                  <div key={i} className="flex items-center gap-4 px-4 py-3 rounded-xl transition-all"
                    style={{ background: "rgba(6,12,26,0.9)", border: `1px solid ${color}18` }}
                    onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.borderColor = color + "30"}
                    onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.borderColor = color + "18"}>
                    <span className="font-mono-data text-sm font-bold w-12 shrink-0" style={{ color: "#38bdf8" }}>{rel.from}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <div style={{ width: 20, height: 1.5, background: color, borderRadius: 1 }} />
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded"
                        style={{ color, background: color + "14", border: `1px solid ${color}30`, letterSpacing: "0.06em" }}>
                        {rel.rel?.replace(/_/g, " ")}
                      </span>
                      <div style={{ width: 20, height: 1.5, background: color, borderRadius: 1 }} />
                    </div>
                    <button onClick={() => router.push(`/country/${rel.to}`)}
                      className="font-mono-data text-sm font-bold hover:opacity-80 transition-opacity"
                      style={{ color: "#a78bfa" }}>{rel.to}</button>
                    {rel.props && Object.keys(rel.props).length > 0 && (
                      <div className="ml-auto flex items-center gap-2 flex-wrap">
                        {Object.entries(rel.props).slice(0, 3).map(([k, v]) => (
                          <span key={k} style={{ fontSize: 9, color: "rgba(100,116,139,0.6)" }}>
                            {k}: <span style={{ color: "#94a3b8" }}>{String(v)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── EVENTS ── */}
        {tab === "events" && (
          <div className="space-y-2 animate-fade-in-up">
            {eLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#38bdf8" }} />
              </div>
            ) : (eventsData?.events ?? []).length === 0 ? (
              <div className="text-center py-16">
                <p style={{ fontSize: 13, color: "rgba(100,116,139,0.5)" }}>No events found for {iso3}.</p>
              </div>
            ) : (
              (eventsData?.events ?? []).map((ev: any, i: number) => {
                const sk = sevKey(ev.severity ?? 0.5);
                const sev = SEV_STYLE[sk];
                return (
                  <div key={ev.event_id ?? i} className="rounded-xl p-4 transition-all"
                    style={{ background: "rgba(6,12,26,0.9)", border: `1px solid ${sev.border}` }}>
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-center gap-1 mt-0.5 shrink-0">
                        <div className="w-2 h-2 rounded-full" style={{ background: sev.hex, boxShadow: `0 0 5px ${sev.hex}` }} />
                      </div>
                      <div className="flex-1">
                        <p style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600, lineHeight: 1.4 }}>{ev.title}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span style={{ fontSize: 9, color: sev.text, background: sev.bg, border: `1px solid ${sev.border}`, padding: "1px 6px", borderRadius: 3, fontWeight: 800 }}>{sk}</span>
                          <span style={{ fontSize: 9, color: "rgba(100,116,139,0.6)" }}>{ev.event_type?.replace(/_/g, " ")}</span>
                          <span style={{ fontSize: 9, color: "rgba(71,85,105,0.6)" }}>{ev.date}</span>
                        </div>
                        {ev.summary && <p className="mt-2" style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>{ev.summary}</p>}
                      </div>
                      <span className="font-mono-data text-[11px] shrink-0" style={{ color: sev.text }}>
                        {((ev.severity ?? 0.5) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── TRADE ── */}
        {tab === "trade" && (
          <div className="space-y-3 animate-fade-in-up">
            {tLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#38bdf8" }} />
              </div>
            ) : !tradeData || Object.keys(tradeData).length === 0 ? (
              <div className="text-center py-16">
                <p style={{ fontSize: 13, color: "rgba(100,116,139,0.5)" }}>
                  Trade data not available. Ensure Comtrade service is configured.
                </p>
              </div>
            ) : (
              <div className="rounded-xl overflow-hidden"
                style={{ background: "rgba(6,12,26,0.9)", border: "1px solid rgba(20,35,60,0.7)" }}>
                <pre className="p-4 text-xs overflow-auto" style={{ color: "#94a3b8" }}>
                  {JSON.stringify(tradeData, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* ── AI BRIEF ── */}
        {tab === "brief" && (
          <div className="space-y-4 animate-fade-in-up">
            {!briefMutation.data && !briefMutation.isPending && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)" }}>
                  <FileText className="w-7 h-7" style={{ color: "#a78bfa" }} />
                </div>
                <div className="text-center">
                  <p className="font-display font-bold text-lg" style={{ color: "#e2e8f0" }}>Generate Intelligence Brief</p>
                  <p style={{ fontSize: 12, color: "rgba(100,116,139,0.5)", marginTop: 4 }}>
                    AI-powered analysis combining current events, trade data, and geopolitical relationships
                  </p>
                </div>
                <button onClick={() => briefMutation.mutate()}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all"
                  style={{ background: "linear-gradient(135deg,rgba(99,102,241,0.2),rgba(167,139,250,0.2))", border: "1px solid rgba(167,139,250,0.3)", color: "#a78bfa", fontSize: 13 }}>
                  <FileText className="w-4 h-4" />
                  GENERATE BRIEF FOR {iso3}
                </button>
                <p style={{ fontSize: 9, color: "rgba(51,65,85,0.8)", letterSpacing: "0.05em" }}>Powered by Groq LLaMA-3.3-70B · Cached 24h</p>
              </div>
            )}

            {briefMutation.isPending && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="relative w-12 h-12">
                  <div className="absolute inset-0 rounded-full border border-purple-500/20 animate-ping" />
                  <div className="absolute inset-0 rounded-full border-t-2 border-purple-400 animate-spin" />
                </div>
                <p style={{ fontSize: 12, color: "rgba(167,139,250,0.6)", letterSpacing: "0.05em" }}>Generating intelligence brief…</p>
              </div>
            )}

            {briefMutation.isError && (
              <div className="rounded-xl p-4 flex items-start gap-3"
                style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#f87171" }} />
                <div>
                  <p style={{ fontSize: 13, color: "#f87171", fontWeight: 600 }}>Brief generation failed</p>
                  <p style={{ fontSize: 11, color: "rgba(248,113,113,0.6)", marginTop: 2 }}>Check that GROQ_API_KEY is configured and the backend is running.</p>
                  <button onClick={() => briefMutation.mutate()}
                    className="flex items-center gap-1.5 mt-3 text-[11px] font-bold" style={{ color: "#f87171" }}>
                    <RefreshCw className="w-3 h-3" /> Try Again
                  </button>
                </div>
              </div>
            )}

            {briefMutation.data && (
              <div className="space-y-4">
                {/* Header */}
                <div className="rounded-xl p-4" style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p style={{ fontSize: 9, color: "rgba(167,139,250,0.7)", fontWeight: 800, letterSpacing: "0.12em" }}>
                        {briefMutation.data.classification ?? "UNCLASSIFIED"} · {briefMutation.data.report_type}
                      </p>
                      <h2 className="font-display text-lg font-bold mt-1" style={{ color: "#f1f5f9" }}>
                        {briefMutation.data.title}
                      </h2>
                    </div>
                    <button onClick={() => briefMutation.mutate()}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold shrink-0"
                      style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", color: "#a78bfa" }}>
                      <RefreshCw className="w-3 h-3" /> REGENERATE
                    </button>
                  </div>
                </div>

                {/* Executive Summary */}
                {briefMutation.data.executive_summary && (
                  <BriefSection heading="EXECUTIVE SUMMARY" content={briefMutation.data.executive_summary} />
                )}

                {/* Sections */}
                {briefMutation.data.sections?.map((s: any, i: number) => (
                  <BriefSection key={i} heading={s.heading?.toUpperCase() ?? `SECTION ${i + 1}`} content={s.content} />
                ))}

                {/* Risk indicators */}
                {briefMutation.data.risk_indicators?.length > 0 && (
                  <div className="rounded-xl p-4" style={{ background: "rgba(2,6,14,0.8)", border: "1px solid rgba(20,35,60,0.6)" }}>
                    <p style={{ fontSize: 9, color: "rgba(56,189,248,0.7)", fontWeight: 800, letterSpacing: "0.1em", marginBottom: 10 }}>RISK INDICATORS</p>
                    <div className="space-y-2">
                      {briefMutation.data.risk_indicators.map((r: any, i: number) => {
                        const sk = r.level as keyof typeof SEV_STYLE;
                        const sev = SEV_STYLE[sk] ?? SEV_STYLE.LOW;
                        return (
                          <div key={i} className="flex items-center justify-between">
                            <span style={{ fontSize: 12, color: "#94a3b8" }}>{r.indicator}</span>
                            <div className="flex items-center gap-2">
                              <span style={{ fontSize: 9, color: sev.text, background: sev.bg, border: `1px solid ${sev.border}`, padding: "1px 6px", borderRadius: 3, fontWeight: 800 }}>{r.level}</span>
                              <span style={{ fontSize: 9, color: "rgba(100,116,139,0.5)" }}>↑ {r.trend}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Key takeaways */}
                {briefMutation.data.key_takeaways?.length > 0 && (
                  <div className="rounded-xl p-4" style={{ background: "rgba(2,6,14,0.8)", border: "1px solid rgba(20,35,60,0.6)" }}>
                    <p style={{ fontSize: 9, color: "rgba(56,189,248,0.7)", fontWeight: 800, letterSpacing: "0.1em", marginBottom: 10 }}>KEY TAKEAWAYS</p>
                    <ul className="space-y-2">
                      {briefMutation.data.key_takeaways.map((t: string, i: number) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#38bdf8", marginTop: 5, flexShrink: 0 }} />
                          <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.65 }}>{t}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p style={{ fontSize: 9, color: "rgba(51,65,85,0.8)", textAlign: "center", letterSpacing: "0.05em" }}>
                  Model: {briefMutation.data.model_used ?? "Groq"} · Generated {new Date(briefMutation.data.generated_at ?? Date.now()).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
