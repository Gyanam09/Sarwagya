"use client";
/**
 * NetworkGraph.tsx — Force-directed country relationship graph
 * Powered by react-force-graph-2d (WebGL canvas, no SVG overhead).
 * Nodes: countries, sized by degree, colored by region.
 * Edges: colored by relationship type.
 */
import { useRef, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

// Dynamically import ForceGraph2D to avoid SSR issues (it uses canvas/WebGL)
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

/* ─── Types ─────────────────────────────────────────────────────────────── */
export interface GraphNode {
  id: string;       // iso3
  name: string;
  region: string;
  val?: number;     // size weight
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface NetworkGraphProps {
  data: GraphData;
  centeredNode?: string;
  width?: number;
  height?: number;
  onNodeClick?: (node: GraphNode) => void;
  highlightTypes?: string[];
}

/* ─── Colour maps ────────────────────────────────────────────────────────── */
const REGION_COLORS: Record<string, string> = {
  Americas:     "#38bdf8",
  Europe:       "#a78bfa",
  Asia:         "#34d399",
  "Middle East": "#fbbf24",
  Africa:       "#fb923c",
  Oceania:      "#f43f5e",
};

const LINK_COLORS: Record<string, string> = {
  TRADES_WITH:    "#38bdf8",
  ALLY_OF:        "#34d399",
  SANCTIONS:      "#f43f5e",
  CONFLICT_WITH:  "#fb923c",
  INVESTS_IN:     "#a78bfa",
};

function nodeColor(node: GraphNode) {
  return REGION_COLORS[node.region] ?? "#64748b";
}

function linkColor(link: GraphLink) {
  return LINK_COLORS[link.type] ?? "#334155";
}

/* ─── Legend ─────────────────────────────────────────────────────────────── */
function Legend() {
  return (
    <div
      className="absolute bottom-4 left-4 rounded-xl p-3 z-10"
      style={{ background: "rgba(2,6,14,0.92)", border: "1px solid rgba(30,48,75,0.7)", backdropFilter: "blur(16px)" }}
    >
      <p style={{ fontSize: 9, color: "rgba(56,189,248,0.7)", fontWeight: 800, letterSpacing: "0.12em", marginBottom: 8 }}>
        RELATIONSHIPS
      </p>
      {Object.entries(LINK_COLORS).map(([type, color]) => (
        <div key={type} className="flex items-center gap-2 mb-1.5">
          <div style={{ width: 16, height: 2, background: color, borderRadius: 1 }} />
          <span style={{ fontSize: 9, color: "rgba(148,163,184,0.7)", letterSpacing: "0.05em" }}>
            {type.replace(/_/g, " ")}
          </span>
        </div>
      ))}
      <p style={{ fontSize: 9, color: "rgba(56,189,248,0.7)", fontWeight: 800, letterSpacing: "0.12em", margin: "10px 0 8px" }}>
        REGIONS
      </p>
      {Object.entries(REGION_COLORS).map(([region, color]) => (
        <div key={region} className="flex items-center gap-2 mb-1.5">
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
          <span style={{ fontSize: 9, color: "rgba(148,163,184,0.7)" }}>{region}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────── */
export function NetworkGraph({
  data,
  centeredNode,
  width = 800,
  height = 600,
  onNodeClick,
  highlightTypes,
}: NetworkGraphProps) {
  const router = useRouter();
  const fgRef = useRef<any>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);

  // Center on a specific node when centeredNode changes
  useEffect(() => {
    if (!centeredNode || !fgRef.current) return;
    const node = data.nodes.find((n) => n.id === centeredNode);
    if (node) {
      setTimeout(() => {
        fgRef.current?.centerAt(node.x ?? 0, node.y ?? 0, 800);
        fgRef.current?.zoom(3, 800);
      }, 300);
    }
  }, [centeredNode, data.nodes]);

  const handleNodeClick = useCallback(
    (node: any) => {
      if (onNodeClick) {
        onNodeClick(node as GraphNode);
      } else {
        router.push(`/country/${node.id}`);
      }
    },
    [onNodeClick, router]
  );

  const handleNodeHover = useCallback((node: any, prevNode: any) => {
    setHoveredNode(node as GraphNode | null);
  }, []);

  // Custom node painter — glowing circles
  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const label = node.id as string;
      const color = nodeColor(node as GraphNode);
      const isHovered = hoveredNode?.id === node.id;
      const isCentered = centeredNode === node.id;
      const r = (node.val ?? 4) + (isCentered ? 4 : 0);

      // Glow
      if (isHovered || isCentered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI);
        const grd = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r + 5);
        grd.addColorStop(0, color + "66");
        grd.addColorStop(1, "transparent");
        ctx.fillStyle = grd;
        ctx.fill();
      }

      // Core circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color + (isHovered ? "ff" : "cc");
      ctx.fill();

      // Ring for centered node
      if (isCentered) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Label (only at decent zoom level)
      if (globalScale > 1.2 || isHovered || isCentered) {
        const fontSize = Math.max(8 / globalScale, 3);
        ctx.font = `bold ${fontSize}px "Space Grotesk", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isHovered || isCentered ? "#f1f5f9" : "rgba(148,163,184,0.8)";
        ctx.fillText(label, node.x, node.y + r + fontSize * 0.9);
      }
    },
    [hoveredNode, centeredNode]
  );

  // Custom link painter
  const paintLink = useCallback(
    (link: any, ctx: CanvasRenderingContext2D) => {
      const color = linkColor(link as GraphLink);
      const isFiltered = highlightTypes && highlightTypes.length > 0 && !highlightTypes.includes(link.type);
      ctx.strokeStyle = isFiltered ? "rgba(30,48,75,0.2)" : color + "88";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(link.source.x, link.source.y);
      ctx.lineTo(link.target.x, link.target.y);
      ctx.stroke();

      // Arrow
      if (!isFiltered) {
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) return;
        const ux = dx / len;
        const uy = dy / len;
        const midX = (link.source.x + link.target.x) / 2;
        const midY = (link.source.y + link.target.y) / 2;
        const arrowSize = 3;
        ctx.fillStyle = color + "88";
        ctx.beginPath();
        ctx.moveTo(midX + ux * arrowSize, midY + uy * arrowSize);
        ctx.lineTo(midX - uy * arrowSize * 0.5 - ux * arrowSize, midY + ux * arrowSize * 0.5 - uy * arrowSize);
        ctx.lineTo(midX + uy * arrowSize * 0.5 - ux * arrowSize, midY - ux * arrowSize * 0.5 - uy * arrowSize);
        ctx.fill();
      }
    },
    [highlightTypes]
  );

  return (
    <div className="relative w-full h-full" style={{ background: "transparent" }}>
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        width={width}
        height={height}
        backgroundColor="transparent"
        nodeCanvasObject={paintNode}
        nodeCanvasObjectMode={() => "replace"}
        linkCanvasObject={paintLink}
        linkCanvasObjectMode={() => "replace"}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        cooldownTicks={120}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        enableNodeDrag
        nodeRelSize={5}
      />
      <Legend />
      {hoveredNode && (
        <div
          className="absolute pointer-events-none rounded-lg px-3 py-2"
          style={{
            top: 16,
            right: 16,
            background: "rgba(2,6,14,0.95)",
            border: `1px solid ${nodeColor(hoveredNode)}40`,
            backdropFilter: "blur(16px)",
          }}
        >
          <p className="font-display font-bold" style={{ fontSize: 13, color: "#f1f5f9" }}>
            {hoveredNode.name}
          </p>
          <p style={{ fontSize: 9, color: nodeColor(hoveredNode), letterSpacing: "0.08em", fontWeight: 700 }}>
            {hoveredNode.region.toUpperCase()} · {hoveredNode.id}
          </p>
          <p style={{ fontSize: 9, color: "rgba(100,116,139,0.7)", marginTop: 4 }}>
            Click to view intelligence brief →
          </p>
        </div>
      )}
    </div>
  );
}
