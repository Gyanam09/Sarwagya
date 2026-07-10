"use client";
/**
 * IntelQueryTerminal — Palantir-style natural language GEOINT search.
 * Allows analysts to ask free-form questions about country relations,
 * economic sectors, trade dependencies, and geopolitical events.
 * The backend (Groq LLaMA-3.3-70B + Gemini fallback) returns structured
 * intelligence analysis grounded in the knowledge graph.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Search, X, Send, Loader2, ChevronDown, ChevronUp,
  Zap, Globe, BarChart3, Shield, AlertTriangle, TrendingUp,
  BookOpen, Crosshair, Clock, Cpu, Copy, Check,
} from "lucide-react";
import { api } from "@/lib/api";

/* ─── Types ──────────────────────────────────────────────────────────────── */
type IntelResult = Awaited<ReturnType<typeof api.intelSearch>>;

type QueryHistoryItem = {
  id: string;
  query: string;
  result: IntelResult;
  timestamp: Date;
};

/* ─── Constants ──────────────────────────────────────────────────────────── */
const EXAMPLE_QUERIES = [
  "What is the relationship between India and Russia in the energy sector?",
  "How do US tariffs on China affect the global semiconductor supply chain?",
  "Which countries are most exposed to the South China Sea dispute?",
  "What are the economic implications of OPEC+ production cuts?",
  "How does Iran's nuclear standoff affect Middle East energy security?",
  "Analyse Germany's energy vulnerability after the Russia-Ukraine war",
];

const QUERY_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  COUNTRY_RELATIONS: { icon: <Globe className="w-3 h-3" />,      color: "#38bdf8", label: "Country Relations" },
  ECONOMIC:          { icon: <BarChart3 className="w-3 h-3" />,   color: "#34d399", label: "Economic" },
  MILITARY:          { icon: <Shield className="w-3 h-3" />,      color: "#f87171", label: "Military" },
  TRADE:             { icon: <TrendingUp className="w-3 h-3" />,  color: "#fb923c", label: "Trade" },
  ENERGY:            { icon: <Zap className="w-3 h-3" />,         color: "#fbbf24", label: "Energy" },
  DIPLOMATIC:        { icon: <BookOpen className="w-3 h-3" />,    color: "#a78bfa", label: "Diplomatic" },
  GENERAL:           { icon: <Crosshair className="w-3 h-3" />,   color: "#64748b", label: "General Intel" },
};

const CONFIDENCE_CONFIG = {
  HIGH:   { color: "#34d399", bg: "rgba(52,211,153,0.1)",  border: "rgba(52,211,153,0.3)"  },
  MEDIUM: { color: "#fbbf24", bg: "rgba(251,191,36,0.1)",  border: "rgba(251,191,36,0.3)"  },
  LOW:    { color: "#f87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.3)" },
};

const SEV_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#f59e0b", LOW: "#10b981",
};

/* ─── Typewriter effect hook ─────────────────────────────────────────────── */
function useTypewriter(text: string, speed = 12) {
  const [displayed, setDisplayed] = useState("");
  useEffect(() => {
    setDisplayed("");
    let i = 0;
    const id = setInterval(() => {
      setDisplayed(text.slice(0, i + 1));
      i++;
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return displayed;
}

/* ─── Result Card ────────────────────────────────────────────────────────── */
function IntelResultCard({ result, query }: { result: IntelResult; query: string }) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const typedAnswer = useTypewriter(result.answer, 8);
  const qType = QUERY_TYPE_CONFIG[result.query_type] ?? QUERY_TYPE_CONFIG.GENERAL;
  const conf  = CONFIDENCE_CONFIG[result.confidence] ?? CONFIDENCE_CONFIG.MEDIUM;

  const handleCopy = () => {
    navigator.clipboard.writeText(
      `QUERY: ${query}\n\nANALYSIS:\n${result.answer}\n\nKEY POINTS:\n${result.key_points.map((p) => `• ${p}`).join("\n")}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="animate-fade-in-up"
      style={{
        background: "rgba(4, 10, 20, 0.98)",
        border: "1px solid rgba(30,48,75,0.8)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Top accent */}
      <div style={{ height: 2, background: `linear-gradient(to right, ${qType.color}, transparent)` }} />

      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        style={{ borderBottom: "1px solid rgba(20,35,60,0.7)" }}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Query type badge */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md shrink-0"
          style={{ background: `${qType.color}14`, border: `1px solid ${qType.color}35`, color: qType.color }}
        >
          {qType.icon}
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em" }}>{qType.label.toUpperCase()}</span>
        </div>

        {/* Confidence */}
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 rounded shrink-0"
          style={{ background: conf.bg, border: `1px solid ${conf.border}`, color: conf.color }}
        >
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.06em" }}>{result.confidence} CONF.</span>
        </div>

        <div className="flex-1" />

        {/* Time */}
        <span style={{ fontSize: 9, color: "rgba(100,116,139,0.6)", fontFamily: "JetBrains Mono, monospace" }}>
          {new Date(result.generated_at).toLocaleTimeString()}
        </span>

        {/* Copy */}
        <button
          onClick={(e) => { e.stopPropagation(); handleCopy(); }}
          className="transition-colors"
          style={{ color: copied ? "#34d399" : "rgba(100,116,139,0.5)" }}
          title="Copy analysis"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>

        {expanded
          ? <ChevronUp className="w-4 h-4" style={{ color: "rgba(100,116,139,0.5)" }} />
          : <ChevronDown className="w-4 h-4" style={{ color: "rgba(100,116,139,0.5)" }} />}
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Answer — typewriter effect */}
          <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.7 }}>
            {typedAnswer}
            <span className="animate-pulse" style={{ color: qType.color, opacity: typedAnswer.length < result.answer.length ? 1 : 0 }}>▊</span>
          </div>

          {/* Key points */}
          {result.key_points.length > 0 && (
            <div>
              <p style={{ fontSize: 9, color: qType.color, fontWeight: 800, letterSpacing: "0.1em", marginBottom: 8 }}>
                KEY INTELLIGENCE POINTS
              </p>
              <div className="space-y-2">
                {result.key_points.map((point, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span
                      className="shrink-0 w-4 h-4 rounded flex items-center justify-center text-[8px] font-black mt-0.5"
                      style={{ background: `${qType.color}20`, color: qType.color, border: `1px solid ${qType.color}30` }}
                    >
                      {i + 1}
                    </span>
                    <p style={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.5 }}>{point}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Two-column: Sectors + Countries */}
          <div className="grid grid-cols-2 gap-3">
            {/* Countries */}
            {result.countries_involved.length > 0 && (
              <div className="p-3 rounded-lg" style={{ background: "rgba(8,16,30,0.8)", border: "1px solid rgba(20,35,60,0.6)" }}>
                <p style={{ fontSize: 8, color: "rgba(100,116,139,0.7)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 }}>
                  NATIONS INVOLVED
                </p>
                <div className="flex flex-wrap gap-1">
                  {result.countries_involved.map((iso) => (
                    <span key={iso}
                      className="font-mono-data px-1.5 py-0.5 rounded text-[9px] font-bold"
                      style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)", color: "#38bdf8" }}>
                      {iso}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Sectors */}
            {result.sectors_affected.length > 0 && (
              <div className="p-3 rounded-lg" style={{ background: "rgba(8,16,30,0.8)", border: "1px solid rgba(20,35,60,0.6)" }}>
                <p style={{ fontSize: 8, color: "rgba(100,116,139,0.7)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 }}>
                  SECTORS AFFECTED
                </p>
                <div className="flex flex-wrap gap-1">
                  {result.sectors_affected.map((s) => (
                    <span key={s}
                      className="px-1.5 py-0.5 rounded text-[9px] font-semibold capitalize"
                      style={{ background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.2)", color: "#fb923c" }}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Related events */}
          {result.relevant_events.length > 0 && (
            <div>
              <p style={{ fontSize: 9, color: "rgba(100,116,139,0.7)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 }}>
                RELATED INTELLIGENCE EVENTS
              </p>
              <div className="space-y-2">
                {result.relevant_events.map((ev, i) => {
                  const sevKey = ev.severity >= 0.8 ? "CRITICAL" : ev.severity >= 0.6 ? "HIGH" : ev.severity >= 0.4 ? "MEDIUM" : "LOW";
                  const sevCol = SEV_COLORS[sevKey];
                  return (
                    <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg"
                      style={{ background: "rgba(6,12,24,0.8)", border: "1px solid rgba(16,28,52,0.7)" }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: sevCol, marginTop: 4, flexShrink: 0, boxShadow: `0 0 6px ${sevCol}` }} />
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, lineHeight: 1.4 }}>{ev.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span style={{ fontSize: 8, color: sevCol, fontWeight: 700, border: `1px solid ${sevCol}40`, background: `${sevCol}12`, padding: "1px 5px", borderRadius: 3 }}>
                            {sevKey}
                          </span>
                          <span style={{ fontSize: 8, color: "rgba(71,85,105,0.8)" }}>{ev.event_type.replace(/_/g, " ")}</span>
                          <span style={{ fontSize: 8, color: "rgba(51,65,85,0.8)" }}>{ev.countries_involved.join(" · ")}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sources */}
          <div className="flex items-center gap-2 flex-wrap pt-1" style={{ borderTop: "1px solid rgba(16,28,52,0.7)" }}>
            <Cpu className="w-3 h-3" style={{ color: "rgba(100,116,139,0.4)" }} />
            {result.sources.map((s) => (
              <span key={s} style={{ fontSize: 8, color: "rgba(71,85,105,0.7)", letterSpacing: "0.03em" }}>{s}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Terminal Component ────────────────────────────────────────────── */
interface IntelQueryTerminalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function IntelQueryTerminal({ isOpen, onClose }: IntelQueryTerminalProps) {
  const [query, setQuery]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [results, setResults]       = useState<QueryHistoryItem[]>([]);
  const [showExamples, setShowExamples] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Auto-focus on open
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  // Scroll to latest result
  useEffect(() => {
    if (results.length > 0) {
      setTimeout(() => resultsRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 100);
    }
  }, [results.length]);

  const handleSubmit = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setShowExamples(false);

    try {
      const result = await api.intelSearch(q);
      setResults((prev) => [
        { id: Date.now().toString(), query: q, result, timestamp: new Date() },
        ...prev,
      ].slice(0, 8)); // keep last 8
      setQuery("");
    } catch (e: any) {
      setError(e.message ?? "Intelligence analysis failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [query, loading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 animate-fade-in"
        style={{ background: "rgba(0, 0, 0, 0.7)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      {/* Terminal panel */}
      <div
        className="fixed z-50 animate-fade-in-up flex flex-col"
        style={{
          top: "10%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(760px, 96vw)",
          maxHeight: "80vh",
          background: "rgba(2, 5, 12, 0.99)",
          border: "1px solid rgba(56,189,248,0.2)",
          borderRadius: 12,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(56,189,248,0.06)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(20,35,60,0.8)", background: "rgba(4,10,20,0.98)" }}
        >
          {/* Status dots */}
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#ef4444" }} />
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#fbbf24" }} />
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#34d399" }} />
          </div>

          <div className="flex items-center gap-2 flex-1">
            <Cpu className="w-3.5 h-3.5" style={{ color: "#38bdf8" }} />
            <span className="font-display text-xs font-bold" style={{ color: "#e2e8f0" }}>
              INTELLIGENCE QUERY TERMINAL
            </span>
            <span style={{ fontSize: 8, color: "rgba(56,189,248,0.5)", letterSpacing: "0.1em" }}>
              · GROQ LLaMA-3.3-70B · GEMINI 2.0
            </span>
          </div>

          {results.length > 0 && (
            <button
              onClick={() => { setResults([]); setShowExamples(true); }}
              style={{ fontSize: 9, color: "rgba(100,116,139,0.6)", letterSpacing: "0.06em" }}
              className="hover:text-slate-400 transition-colors"
            >
              CLEAR
            </button>
          )}

          <button onClick={onClose} style={{ color: "rgba(100,116,139,0.6)" }} className="hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Input area */}
        <div className="px-4 py-3 shrink-0" style={{ borderBottom: "1px solid rgba(16,28,52,0.8)" }}>
          <div className="relative">
            <div className="flex items-start gap-2">
              {/* Prompt indicator */}
              <span className="font-mono-data text-xs mt-2.5 shrink-0 select-none" style={{ color: "#38bdf8" }}>⟩</span>
              <textarea
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about country relations, economic sectors, trade dependencies, geopolitical risks…"
                rows={2}
                disabled={loading}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  color: "#e2e8f0",
                  fontSize: 13,
                  lineHeight: 1.6,
                  fontFamily: "Inter, sans-serif",
                  caretColor: "#38bdf8",
                }}
                className="placeholder:text-slate-700"
              />
              <button
                onClick={handleSubmit}
                disabled={!query.trim() || loading}
                className="shrink-0 mt-1.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all font-bold"
                style={{
                  background: query.trim() && !loading ? "rgba(56,189,248,0.15)" : "rgba(15,25,45,0.6)",
                  border: `1px solid ${query.trim() && !loading ? "rgba(56,189,248,0.4)" : "rgba(20,35,60,0.6)"}`,
                  color: query.trim() && !loading ? "#38bdf8" : "#334155",
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  cursor: query.trim() && !loading ? "pointer" : "not-allowed",
                  boxShadow: query.trim() && !loading ? "0 0 12px rgba(56,189,248,0.15)" : "none",
                }}
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                {loading ? "ANALYSING" : "ANALYSE"}
              </button>
            </div>
          </div>

          {/* Hint */}
          <p style={{ fontSize: 9, color: "rgba(51,65,85,0.9)", marginTop: 4, marginLeft: 16, letterSpacing: "0.04em" }}>
            ENTER to submit · SHIFT+ENTER for new line · ESC to close
          </p>
        </div>

        {/* Loading indicator */}
        {loading && (
          <div className="px-4 py-3 shrink-0 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(16,28,52,0.6)" }}>
            <div className="flex items-center gap-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="w-1 rounded-full animate-pulse"
                  style={{ height: 8 + (i % 3) * 4, background: "#38bdf8", opacity: 0.3 + i * 0.15, animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
            <span style={{ fontSize: 10, color: "#38bdf8", letterSpacing: "0.08em" }}>
              Querying intelligence graph…
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 py-3 shrink-0 flex items-start gap-2"
            style={{ background: "rgba(239,68,68,0.06)", borderBottom: "1px solid rgba(239,68,68,0.15)" }}>
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p style={{ fontSize: 10, color: "#f87171", fontWeight: 700, letterSpacing: "0.06em" }}>ANALYSIS ERROR</p>
              <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{error}</p>
            </div>
          </div>
        )}

        {/* Results / Examples */}
        <div ref={resultsRef} className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Example queries (shown before first query) */}
          {showExamples && results.length === 0 && !loading && (
            <div>
              <p style={{ fontSize: 9, color: "rgba(56,189,248,0.5)", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 10 }}>
                EXAMPLE INTELLIGENCE QUERIES
              </p>
              <div className="space-y-2">
                {EXAMPLE_QUERIES.map((q, i) => (
                  <button key={i}
                    onClick={() => { setQuery(q); inputRef.current?.focus(); }}
                    className="w-full text-left flex items-start gap-2.5 p-3 rounded-lg transition-all"
                    style={{ background: "rgba(6,12,24,0.8)", border: "1px solid rgba(16,28,52,0.7)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(56,189,248,0.2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(16,28,52,0.7)")}
                  >
                    <span style={{ fontSize: 9, color: "#38bdf8", fontFamily: "JetBrains Mono", marginTop: 2 }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{q}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Query results */}
          {results.map((item) => (
            <div key={item.id} className="space-y-2">
              {/* User query bubble */}
              <div className="flex items-start gap-2">
                <span className="font-mono-data text-xs mt-1 shrink-0" style={{ color: "#38bdf8" }}>⟩</span>
                <p style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", lineHeight: 1.5 }}>{item.query}</p>
              </div>
              <IntelResultCard result={item.result} query={item.query} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
