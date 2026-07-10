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

/* ─── SVG Bar Chart ──────────────────────────────────────────────────────── */
function SvgBarChart({
  title, labels, datasets, unit,
}: {
  title: string;
  labels: string[];
  datasets: Array<{ label: string; values: number[]; color?: string }>;
  unit?: string;
}) {
  const W = 320, H = 140, PAD = { top: 18, right: 8, bottom: 36, left: 38 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const allVals = datasets.flatMap((d) => d.values);
  const maxVal  = Math.max(...allVals, 1);
  const barGroupW = chartW / labels.length;
  const barW = Math.min(18, (barGroupW / datasets.length) - 3);
  const COLORS = ["#38bdf8", "#34d399", "#fbbf24", "#fb923c", "#a78bfa"];

  return (
    <div>
      <p style={{ fontSize: 9, color: "rgba(148,163,184,0.6)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>
        {title.toUpperCase()}
      </p>
      <svg width={W} height={H} style={{ overflow: "visible", maxWidth: "100%" }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = PAD.top + chartH * (1 - t);
          return (
            <g key={t}>
              <line x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y}
                stroke="rgba(30,48,75,0.6)" strokeWidth={0.5} />
              <text x={PAD.left - 4} y={y + 3} textAnchor="end"
                fill="rgba(100,116,139,0.7)" fontSize={7}>
                {Math.round(maxVal * t)}{unit && t === 1 ? unit : ""}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {labels.map((lbl, li) => {
          const groupX = PAD.left + li * barGroupW;
          return (
            <g key={li}>
              {datasets.map((ds, di) => {
                const val = ds.values[li] ?? 0;
                const barH = (val / maxVal) * chartH;
                const x = groupX + (barGroupW - datasets.length * (barW + 2)) / 2 + di * (barW + 2);
                const y = PAD.top + chartH - barH;
                const col = ds.color ?? COLORS[di % COLORS.length];
                return (
                  <g key={di}>
                    <rect x={x} y={y} width={barW} height={barH}
                      fill={col} opacity={0.8} rx={2} />
                    {/* Value label on top */}
                    {barH > 14 && (
                      <text x={x + barW / 2} y={y + 10} textAnchor="middle"
                        fill="rgba(255,255,255,0.7)" fontSize={6.5} fontWeight={700}>
                        {val.toLocaleString()}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* X-axis label */}
              <text
                x={groupX + barGroupW / 2}
                y={PAD.top + chartH + 12}
                textAnchor="middle"
                fill="rgba(100,116,139,0.8)"
                fontSize={7}
                style={{ maxWidth: `${barGroupW - 2}px` }}
              >
                {lbl.length > 8 ? lbl.slice(0, 7) + "…" : lbl}
              </text>
            </g>
          );
        })}

        {/* Legend */}
        {datasets.length > 1 && datasets.map((ds, di) => (
          <g key={di} transform={`translate(${PAD.left + di * 80}, ${H - 6})`}>
            <rect width={8} height={5} rx={1} fill={ds.color ?? COLORS[di % COLORS.length]} opacity={0.8} />
            <text x={11} y={5} fill="rgba(100,116,139,0.7)" fontSize={7}>{ds.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ─── SVG Line Chart ─────────────────────────────────────────────────────── */
function SvgLineChart({
  title, labels, datasets, unit,
}: {
  title: string;
  labels: string[];
  datasets: Array<{ label: string; values: number[]; color?: string }>;
  unit?: string;
}) {
  const W = 320, H = 130, PAD = { top: 18, right: 8, bottom: 32, left: 38 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const allVals = datasets.flatMap((d) => d.values);
  const maxVal  = Math.max(...allVals, 1);
  const minVal  = Math.min(...allVals, 0);
  const range   = maxVal - minVal || 1;
  const COLORS  = ["#38bdf8", "#34d399", "#fbbf24", "#fb923c"];

  const toX = (i: number) => PAD.left + (i / Math.max(labels.length - 1, 1)) * chartW;
  const toY = (v: number) => PAD.top + chartH - ((v - minVal) / range) * chartH;

  return (
    <div>
      <p style={{ fontSize: 9, color: "rgba(148,163,184,0.6)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>
        {title.toUpperCase()}
      </p>
      <svg width={W} height={H} style={{ overflow: "visible", maxWidth: "100%" }}>
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = PAD.top + chartH * (1 - t);
          const v = minVal + range * t;
          return (
            <g key={t}>
              <line x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y}
                stroke="rgba(30,48,75,0.6)" strokeWidth={0.5} />
              <text x={PAD.left - 4} y={y + 3} textAnchor="end"
                fill="rgba(100,116,139,0.7)" fontSize={7}>
                {Math.round(v)}{unit && t === 1 ? unit : ""}
              </text>
            </g>
          );
        })}

        {/* X labels */}
        {labels.map((lbl, i) => (
          <text key={i} x={toX(i)} y={PAD.top + chartH + 12}
            textAnchor="middle" fill="rgba(100,116,139,0.8)" fontSize={7}>
            {lbl.length > 6 ? lbl.slice(0, 5) + "…" : lbl}
          </text>
        ))}

        {/* Lines + dots */}
        {datasets.map((ds, di) => {
          const col = ds.color ?? COLORS[di % COLORS.length];
          const pts = ds.values.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
          const areaBottom = PAD.top + chartH;
          const areaFirst  = `${toX(0)},${areaBottom}`;
          const areaLast   = `${toX(ds.values.length - 1)},${areaBottom}`;
          return (
            <g key={di}>
              {/* Area fill */}
              <polygon points={`${areaFirst} ${pts} ${areaLast}`}
                fill={col} opacity={0.07} />
              {/* Line */}
              <polyline points={pts} fill="none" stroke={col} strokeWidth={1.5}
                strokeLinejoin="round" opacity={0.9} />
              {/* Dots */}
              {ds.values.map((v, i) => (
                <circle key={i} cx={toX(i)} cy={toY(v)} r={2.5}
                  fill={col} stroke="rgba(4,10,20,1)" strokeWidth={1.5} />
              ))}
            </g>
          );
        })}

        {/* Legend */}
        {datasets.length > 1 && datasets.map((ds, di) => (
          <g key={di} transform={`translate(${PAD.left + di * 90}, ${H - 5})`}>
            <line x1={0} y1={3} x2={10} y2={3}
              stroke={ds.color ?? COLORS[di % COLORS.length]} strokeWidth={1.5} />
            <text x={13} y={6} fill="rgba(100,116,139,0.7)" fontSize={7}>{ds.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ─── SVG Radar Chart ────────────────────────────────────────────────────── */
function SvgRadarChart({
  title, labels, datasets,
}: {
  title: string;
  labels: string[];
  datasets: Array<{ label: string; values: number[]; color?: string }>;
}) {
  const SIZE = 140, CX = SIZE / 2, CY = SIZE / 2, R = 52;
  const n = labels.length;
  const angle = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const COLORS = ["#38bdf8", "#34d399"];

  const gridLevels = [0.25, 0.5, 0.75, 1];
  const maxVal = 100; // treat values as 0-100

  const toXY = (i: number, val: number) => ({
    x: CX + R * (val / maxVal) * Math.cos(angle(i)),
    y: CY + R * (val / maxVal) * Math.sin(angle(i)),
  });

  return (
    <div>
      <p style={{ fontSize: 9, color: "rgba(148,163,184,0.6)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>
        {title.toUpperCase()}
      </p>
      <svg width={SIZE} height={SIZE} style={{ overflow: "visible" }}>
        {/* Grid polygons */}
        {gridLevels.map((t) => {
          const pts = labels.map((_, i) => {
            const x = CX + R * t * Math.cos(angle(i));
            const y = CY + R * t * Math.sin(angle(i));
            return `${x},${y}`;
          }).join(" ");
          return <polygon key={t} points={pts} fill="none"
            stroke="rgba(30,48,75,0.7)" strokeWidth={0.5} />;
        })}

        {/* Spokes */}
        {labels.map((lbl, i) => {
          const ex = CX + (R + 10) * Math.cos(angle(i));
          const ey = CY + (R + 10) * Math.sin(angle(i));
          return (
            <g key={i}>
              <line x1={CX} y1={CY} x2={ex} y2={ey}
                stroke="rgba(30,48,75,0.5)" strokeWidth={0.5} />
              <text x={CX + (R + 18) * Math.cos(angle(i))}
                y={CY + (R + 18) * Math.sin(angle(i)) + 3}
                textAnchor="middle" fill="rgba(100,116,139,0.8)" fontSize={6.5}>
                {lbl.length > 9 ? lbl.slice(0, 8) + "…" : lbl}
              </text>
            </g>
          );
        })}

        {/* Datasets */}
        {datasets.map((ds, di) => {
          const col = ds.color ?? COLORS[di % COLORS.length];
          const pts = ds.values.map((v, i) => {
            const {x, y} = toXY(i, Math.min(v, maxVal));
            return `${x},${y}`;
          }).join(" ");
          return (
            <g key={di}>
              <polygon points={pts} fill={col} fillOpacity={0.12}
                stroke={col} strokeWidth={1.2} />
              {ds.values.map((v, i) => {
                const {x, y} = toXY(i, Math.min(v, maxVal));
                return <circle key={i} cx={x} cy={y} r={2.5}
                  fill={col} stroke="rgba(4,10,20,1)" strokeWidth={1} />;
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ─── Data Points Grid ───────────────────────────────────────────────────── */
function DataPointsGrid({
  dataPoints, color,
}: {
  dataPoints: Array<{ label: string; value: string; unit: string; source: string }>;
  color: string;
}) {
  if (!dataPoints?.length) return null;
  return (
    <div>
      <p style={{ fontSize: 9, color: color, fontWeight: 800, letterSpacing: "0.1em", marginBottom: 8 }}>
        FACTUAL DATA POINTS
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6 }}>
        {dataPoints.map((dp, i) => (
          <div key={i} style={{
            background: "rgba(6,12,24,0.9)",
            border: `1px solid ${color}22`,
            borderRadius: 8,
            padding: "8px 10px",
          }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: color, fontFamily: "JetBrains Mono, monospace", lineHeight: 1 }}>
              {dp.value}<span style={{ fontSize: 10, opacity: 0.7 }}>{dp.unit}</span>
            </div>
            <div style={{ fontSize: 9.5, color: "#94a3b8", marginTop: 4, lineHeight: 1.3 }}>{dp.label}</div>
            <div style={{ fontSize: 7.5, color: "rgba(71,85,105,0.7)", marginTop: 3 }}>src: {dp.source}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Country Profiles Panel ─────────────────────────────────────────────── */
function CountryProfilesPanel({
  profiles,
}: {
  profiles: Array<{ iso3: string; name: string; gdp_usd_tn: number; key_sectors: string[]; alliances: string[] }>;
}) {
  if (!profiles?.length) return null;
  const maxGdp = Math.max(...profiles.map((p) => p.gdp_usd_tn), 1);
  return (
    <div>
      <p style={{ fontSize: 9, color: "rgba(100,116,139,0.7)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>
        COUNTRY PROFILES
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6 }}>
        {profiles.map((p) => (
          <div key={p.iso3} style={{
            background: "rgba(6,12,24,0.9)",
            border: "1px solid rgba(20,35,60,0.7)",
            borderRadius: 8,
            padding: "10px 12px",
          }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <span style={{
                fontFamily: "JetBrains Mono, monospace", fontSize: 11, fontWeight: 900,
                color: "#38bdf8", background: "rgba(56,189,248,0.1)",
                border: "1px solid rgba(56,189,248,0.2)", padding: "1px 6px", borderRadius: 4,
              }}>{p.iso3}</span>
              <span style={{ fontSize: 10.5, color: "#cbd5e1", fontWeight: 600 }}>{p.name}</span>
            </div>
            {/* GDP bar */}
            <div style={{ marginBottom: 6 }}>
              <div className="flex justify-between" style={{ marginBottom: 3 }}>
                <span style={{ fontSize: 8, color: "rgba(100,116,139,0.6)" }}>GDP</span>
                <span style={{ fontSize: 8, color: "#94a3b8", fontWeight: 700 }}>${p.gdp_usd_tn}T</span>
              </div>
              <div style={{ height: 4, background: "rgba(20,35,60,0.8)", borderRadius: 2 }}>
                <div style={{
                  height: "100%", borderRadius: 2,
                  width: `${(p.gdp_usd_tn / maxGdp) * 100}%`,
                  background: "linear-gradient(to right, #38bdf8, #6366f1)",
                }} />
              </div>
            </div>
            {/* Sectors */}
            <div className="flex flex-wrap gap-1">
              {p.key_sectors.slice(0, 3).map((s) => (
                <span key={s} style={{
                  fontSize: 7, color: "#fb923c", background: "rgba(251,146,60,0.08)",
                  border: "1px solid rgba(251,146,60,0.15)", padding: "1px 5px", borderRadius: 3,
                }}>{s}</span>
              ))}
            </div>
            {/* Alliances */}
            <div className="flex flex-wrap gap-1" style={{ marginTop: 4 }}>
              {p.alliances.slice(0, 3).map((a) => (
                <span key={a} style={{
                  fontSize: 7, color: "rgba(100,116,139,0.7)",
                  border: "1px solid rgba(30,48,75,0.6)", padding: "1px 4px", borderRadius: 3,
                }}>{a}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Charts Section ─────────────────────────────────────────────────────── */
function ChartsSection({
  chartData, color,
}: {
  chartData: Array<{ type: string; title: string; labels: string[]; datasets: Array<{ label: string; values: number[]; color?: string }>; unit?: string }>;
  color: string;
}) {
  if (!chartData?.length) return null;
  return (
    <div>
      <p style={{ fontSize: 9, color: color, fontWeight: 800, letterSpacing: "0.1em", marginBottom: 10 }}>
        SUPPORTING ANALYSIS CHARTS
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
        {chartData.map((chart, i) => (
          <div key={i} style={{
            background: "rgba(6,12,24,0.9)",
            border: "1px solid rgba(20,35,60,0.7)",
            borderRadius: 8,
            padding: "12px 14px",
          }}>
            {chart.type === "bar" && (
              <SvgBarChart title={chart.title} labels={chart.labels}
                datasets={chart.datasets} unit={chart.unit} />
            )}
            {chart.type === "line" && (
              <SvgLineChart title={chart.title} labels={chart.labels}
                datasets={chart.datasets} unit={chart.unit} />
            )}
            {chart.type === "radar" && (
              <SvgRadarChart title={chart.title} labels={chart.labels}
                datasets={chart.datasets} />
            )}
            {chart.type === "comparison" && (
              <SvgBarChart title={chart.title} labels={chart.labels}
                datasets={chart.datasets} unit={chart.unit} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
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

          {/* Data Points — factual numeric figures */}
          <DataPointsGrid dataPoints={result.data_points ?? []} color={qType.color} />

          {/* Charts */}
          <ChartsSection chartData={result.chart_data ?? []} color={qType.color} />

          {/* Country Profiles */}
          <CountryProfilesPanel profiles={result.country_profiles ?? []} />

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
