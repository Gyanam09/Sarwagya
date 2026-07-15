"use client";
/**
 * /graph — Full-page force-directed country network graph
 * Shows all country nodes and their geopolitical relationships.
 */
import dynamic from "next/dynamic";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Shield, GitBranch, Search, Filter, ChevronRight,
  Layers, RefreshCw, Maximize2, Network,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { api } from "@/lib/api";
import type { GraphNode, GraphLink } from "@/components/charts/NetworkGraph";

const NetworkGraph = dynamic(
  () => import("@/components/charts/NetworkGraph").then((m) => m.NetworkGraph),
  { ssr: false, loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border border-sky-500/20 animate-ping" />
          <div className="absolute inset-2 rounded-full border-t-2 border-sky-400 animate-spin" />
          <Network className="absolute inset-0 m-auto w-6 h-6 text-sky-400" />
        </div>
        <p className="text-slate-500 text-xs tracking-widest uppercase">Building Graph Engine</p>
      </div>
    </div>
  )}
);

const REL_TYPES = ["TRADES_WITH", "ALLY_OF", "SANCTIONS", "CONFLICT_WITH", "INVESTS_IN"] as const;
const REL_COLORS: Record<string, string> = {
  TRADES_WITH: "#38bdf8", ALLY_OF: "#34d399",
  SANCTIONS: "#f43f5e", CONFLICT_WITH: "#fb923c", INVESTS_IN: "#a78bfa",
};

const NAV_LINKS = [
  { label: "DASHBOARD", href: "/dashboard" },
  { label: "EVENTS", href: "/events" },
  { label: "GRAPH", href: "/graph", active: true },
  { label: "SETTINGS", href: "/settings" },
];

export default function GraphPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, loadUser } = useAuthStore();
  const [searchIso3, setSearchIso3] = useState("");
  const [centeredNode, setCenteredNode] = useState<string | undefined>();
  const [activeTypes, setActiveTypes] = useState<string[]>(REL_TYPES.slice());
  const [windowSize, setWindowSize] = useState({ w: 1200, h: 700 });

  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push("/auth/login");
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    const update = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const { data: rawGraph, isLoading } = useQuery({
    queryKey: ["global-graph"],
    queryFn: () => api.getGlobalGraph(),
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });

  const graphData = useMemo(() => {
    if (!rawGraph) return { nodes: [], links: [] };
    const nodes: GraphNode[] = rawGraph.nodes.map((n) => ({
      id: n.iso3, name: n.name, region: n.region,
      val: (rawGraph.edges.filter((e) => e.from === n.iso3 || e.to === n.iso3).length + 2) * 1.2,
    }));
    const links: GraphLink[] = rawGraph.edges.map((e) => ({
      source: e.from, target: e.to, type: e.type,
    }));
    return { nodes, links };
  }, [rawGraph]);

  const filteredGraph = useMemo(() => ({
    nodes: graphData.nodes,
    links: graphData.links.filter((l) => activeTypes.includes(l.type)),
  }), [graphData, activeTypes]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchIso3.trim()) setCenteredNode(searchIso3.toUpperCase().trim());
  };

  const toggleType = (t: string) =>
    setActiveTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  if (authLoading) return null;

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "#020408" }}>
      {/* Header */}
      <header
        className="flex items-center gap-4 px-4 shrink-0 z-30"
        style={{ height: 48, background: "rgba(2,6,14,0.97)", borderBottom: "1px solid rgba(30,48,75,0.7)", backdropFilter: "blur(24px)" }}
      >
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", boxShadow: "0 0 16px rgba(99,102,241,0.5)" }}>
            <Shield className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-display text-sm font-bold" style={{ color: "#f1f5f9" }}>सर्वज्ञ Sarwagya</span>
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

        <div className="flex-1" />

        {/* Search node */}
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{ background: "rgba(8,16,30,0.9)", border: "1px solid rgba(30,48,75,0.7)" }}>
            <Search className="w-3 h-3" style={{ color: "rgba(100,116,139,0.6)" }} />
            <input
              value={searchIso3}
              onChange={(e) => setSearchIso3(e.target.value)}
              placeholder="Center on ISO3 (e.g. USA)"
              className="bg-transparent outline-none w-36"
              style={{ fontSize: 11, color: "#e2e8f0" }}
            />
          </div>
          <button type="submit" className="px-3 py-1.5 rounded-lg text-[10px] font-bold transition-colors"
            style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)", color: "#38bdf8" }}>
            CENTER
          </button>
        </form>
      </header>

      {/* Controls sidebar + graph */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left controls */}
        <aside className="flex flex-col w-52 shrink-0 p-3 gap-3 overflow-y-auto"
          style={{ background: "rgba(2,6,14,0.96)", borderRight: "1px solid rgba(20,35,60,0.8)" }}>
          {/* Stats */}
          <div className="rounded-xl p-3" style={{ background: "rgba(8,16,30,0.8)", border: "1px solid rgba(30,48,75,0.5)" }}>
            <p style={{ fontSize: 8, color: "rgba(56,189,248,0.7)", fontWeight: 800, letterSpacing: "0.12em", marginBottom: 8 }}>GRAPH STATS</p>
            <div className="space-y-1.5">
              {[
                { label: "Countries", val: graphData.nodes.length, color: "#38bdf8" },
                { label: "Relations", val: graphData.links.length, color: "#a78bfa" },
                { label: "Shown", val: filteredGraph.links.length, color: "#34d399" },
              ].map(({ label, val, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <span style={{ fontSize: 9, color: "rgba(100,116,139,0.7)" }}>{label}</span>
                  <span className="font-mono-data" style={{ fontSize: 11, color, fontWeight: 700 }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Relationship filters */}
          <div className="rounded-xl p-3" style={{ background: "rgba(8,16,30,0.8)", border: "1px solid rgba(30,48,75,0.5)" }}>
            <p style={{ fontSize: 8, color: "rgba(56,189,248,0.7)", fontWeight: 800, letterSpacing: "0.12em", marginBottom: 8 }}>FILTER RELATIONS</p>
            <div className="space-y-1.5">
              {REL_TYPES.map((t) => {
                const active = activeTypes.includes(t);
                const color = REL_COLORS[t];
                return (
                  <button key={t} onClick={() => toggleType(t)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all text-left"
                    style={{
                      background: active ? `${color}12` : "transparent",
                      border: `1px solid ${active ? color + "30" : "transparent"}`,
                    }}>
                    <div style={{ width: 10, height: 2, borderRadius: 1, background: active ? color : "rgba(51,65,85,0.8)" }} />
                    <span style={{ fontSize: 9, color: active ? "rgba(203,213,225,0.9)" : "rgba(71,85,105,0.8)", letterSpacing: "0.04em" }}>
                      {t.replace(/_/g, " ")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Country quick jump */}
          <div className="rounded-xl p-3" style={{ background: "rgba(8,16,30,0.8)", border: "1px solid rgba(30,48,75,0.5)" }}>
            <p style={{ fontSize: 8, color: "rgba(56,189,248,0.7)", fontWeight: 800, letterSpacing: "0.12em", marginBottom: 8 }}>QUICK JUMP</p>
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {graphData.nodes.slice(0, 20).map((n) => (
                <button key={n.id}
                  onClick={() => { setCenteredNode(n.id); router.push(`/country/${n.id}`); }}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-800/40 transition-colors text-left">
                  <span className="font-mono-data" style={{ fontSize: 9, color: "#38bdf8", fontWeight: 700, minWidth: 28 }}>{n.id}</span>
                  <span style={{ fontSize: 9, color: "rgba(100,116,139,0.8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
                  <ChevronRight className="w-2.5 h-2.5 ml-auto shrink-0" style={{ color: "rgba(56,189,248,0.3)" }} />
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Graph canvas */}
        <div className="flex-1 relative overflow-hidden hex-grid-bg">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <RefreshCw className="w-8 h-8 text-sky-400 animate-spin" />
                <p style={{ fontSize: 11, color: "rgba(100,116,139,0.7)" }}>Loading knowledge graph…</p>
              </div>
            </div>
          ) : (
            <NetworkGraph
              data={filteredGraph}
              centeredNode={centeredNode}
              width={windowSize.w - 208}
              height={windowSize.h - 48}
              highlightTypes={activeTypes}
            />
          )}

          {/* Corner watermark */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5"
            style={{ background: "rgba(2,6,14,0.8)", borderRadius: 8, padding: "4px 10px", border: "1px solid rgba(30,48,75,0.5)" }}>
            <GitBranch className="w-3 h-3" style={{ color: "rgba(56,189,248,0.5)" }} />
            <span style={{ fontSize: 9, color: "rgba(56,189,248,0.5)", letterSpacing: "0.08em", fontWeight: 700 }}>KNOWLEDGE GRAPH</span>
          </div>
        </div>
      </div>
    </div>
  );
}
