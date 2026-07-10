"use client";
/**
 * ThreatGauge — Radial SVG gauge showing global threat level (0–100).
 * Threat index is derived from aggregated event severity scores.
 */
import { useMemo } from "react";

interface ThreatGaugeProps {
  threatScore: number; // 0–100
  eventCount: number;
  criticalCount: number;
}

const RADIUS  = 36;
const STROKE  = 5;
const CENTER  = 50;
// Arc spans 240° (from 150° to 390°, i.e., -210° to 30° in SVG space)
const ARC_DEG = 240;
const CIRC    = 2 * Math.PI * RADIUS;
const ARC_LEN = (ARC_DEG / 360) * CIRC;

function threatColor(score: number): string {
  if (score >= 75) return "#ef4444";
  if (score >= 50) return "#f97316";
  if (score >= 25) return "#f59e0b";
  return "#10b981";
}

function threatLabel(score: number): string {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "ELEVATED";
  if (score >= 25) return "MODERATE";
  return "LOW";
}

export function ThreatGauge({ threatScore, eventCount, criticalCount }: ThreatGaugeProps) {
  const score   = Math.max(0, Math.min(100, threatScore));
  const color   = threatColor(score);
  const label   = threatLabel(score);
  const fillLen = (score / 100) * ARC_LEN;
  // The gauge track starts at 150° and goes clockwise 240°
  // In SVG, 0° = 3-o'clock. Rotate -90° to point 12 o'clock, then -120° to start at 150°
  const rotation = 150 - 90; // = 60°

  return (
    <div className="flex flex-col items-center gap-1.5 py-3">
      {/* SVG Gauge */}
      <div className="relative">
        <svg width="100" height="70" viewBox="0 0 100 80" className="overflow-visible">
          {/* Outer decorative ring */}
          <circle
            cx={CENTER} cy={CENTER} r={RADIUS + 8}
            fill="none"
            stroke="rgba(30,48,75,0.5)"
            strokeWidth={0.5}
          />

          {/* Background track */}
          <circle
            cx={CENTER} cy={CENTER} r={RADIUS}
            fill="none"
            stroke="rgba(20, 35, 60, 0.9)"
            strokeWidth={STROKE}
            strokeDasharray={`${ARC_LEN} ${CIRC}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${rotation}, ${CENTER}, ${CENTER})`}
          />

          {/* Fill arc */}
          <circle
            cx={CENTER} cy={CENTER} r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeDasharray={`${fillLen} ${CIRC}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${rotation}, ${CENTER}, ${CENTER})`}
            style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1), stroke 0.6s ease", filter: `drop-shadow(0 0 6px ${color}88)` }}
          />

          {/* Tick marks every 25% */}
          {[0, 25, 50, 75, 100].map((pct) => {
            const angleDeg = rotation + (pct / 100) * ARC_DEG;
            const angleRad = (angleDeg * Math.PI) / 180;
            const r1 = RADIUS - 8;
            const r2 = RADIUS - 5;
            return (
              <line
                key={pct}
                x1={CENTER + r1 * Math.cos(angleRad)}
                y1={CENTER + r1 * Math.sin(angleRad)}
                x2={CENTER + r2 * Math.cos(angleRad)}
                y2={CENTER + r2 * Math.sin(angleRad)}
                stroke={pct <= score ? color : "rgba(56,189,248,0.2)"}
                strokeWidth={1}
              />
            );
          })}

          {/* Centre score */}
          <text
            x={CENTER} y={CENTER + 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="14"
            fontWeight="800"
            fontFamily="JetBrains Mono, monospace"
            fill={color}
          >
            {Math.round(score)}
          </text>
          <text
            x={CENTER} y={CENTER + 14}
            textAnchor="middle"
            fontSize="5.5"
            fontWeight="600"
            fontFamily="Space Grotesk, sans-serif"
            fill="rgba(148,163,184,0.6)"
            letterSpacing="0.08em"
          >
            THREAT INDEX
          </text>
        </svg>
      </div>

      {/* Label badge */}
      <div
        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded"
        style={{ background: `${color}18`, border: `1px solid ${color}40` }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ background: color, boxShadow: `0 0 6px ${color}` }}
        />
        <span style={{ color, fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", fontFamily: "Space Grotesk" }}>
          {label}
        </span>
      </div>

      {/* Mini stat row */}
      <div className="flex items-center gap-3 mt-0.5">
        <div className="text-center">
          <p className="font-mono-data text-xs font-bold" style={{ color: "#f43f5e" }}>{criticalCount}</p>
          <p style={{ fontSize: 8, color: "rgba(100,116,139,0.8)", letterSpacing: "0.06em" }}>CRITICAL</p>
        </div>
        <div style={{ width: 1, height: 20, background: "rgba(30,48,75,0.8)" }} />
        <div className="text-center">
          <p className="font-mono-data text-xs font-bold" style={{ color: "#94a3b8" }}>{eventCount}</p>
          <p style={{ fontSize: 8, color: "rgba(100,116,139,0.8)", letterSpacing: "0.06em" }}>EVENTS</p>
        </div>
      </div>
    </div>
  );
}
