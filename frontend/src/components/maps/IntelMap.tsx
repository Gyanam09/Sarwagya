"use client";
/**
 * IntelMap — Palantir-style GEOINT map.
 * GPU-accelerated geospatial intelligence via deck.gl.
 * Layers: basemap raster tiles, aircraft (dots + trails), ships (paths + dots + headings),
 *         satellites, geo-events (core + glow rings + threat zones + arcs + 3D pillars),
 *         heatmap (aircraft density), compass rose, scale bar, coordinate readout.
 */
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { TileLayer } from "@deck.gl/geo-layers";
import {
  BitmapLayer,
  ScatterplotLayer,
  PathLayer,
  ArcLayer,
  IconLayer,
  PolygonLayer,
  ColumnLayer,
} from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { PickingInfo, MapViewState } from "@deck.gl/core";
import type { Aircraft } from "@/hooks/useAircraft";
import type { SatellitePosition } from "@/hooks/useSatellites";
import type { Vessel } from "@/hooks/useShips";
import { useSettingsStore } from "@/store/settingsStore";

/* ─── Types ──────────────────────────────────────────────────────────────── */
export interface GeoEvent {
  id: string;
  title: string;
  severity: number;
  event_type: string;
  position: [number, number]; // [lon, lat]
  summary: string;
  countries: string[];
}

export interface LayerVisibility {
  aircraft: boolean;
  ships: boolean;
  satellites: boolean;
  events: boolean;
  heatmap: boolean;
  threats: boolean;
}

export interface MapHoverState {
  longitude: number;
  latitude: number;
}

interface IntelMapProps {
  aircraft: Aircraft[];
  ships: Vessel[];
  satellites: SatellitePosition[];
  events: GeoEvent[];
  layers: LayerVisibility;
  onEntitySelect: (entity: any, type: "aircraft" | "ship" | "satellite" | "event") => void;
  onMapHover?: (state: MapHoverState | null) => void;
  onViewStateChange?: (vs: MapViewState) => void;
}

/* ─── Constants ──────────────────────────────────────────────────────────── */
const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 25,
  latitude: 22,
  zoom: 2.2,
  pitch: 42,
  bearing: -8,
  minZoom: 1,
  maxZoom: 21,
};

/* ─── Basemap styles ─────────────────────────────────────────────────────── */
export type MapStyle = "dark" | "satellite" | "terrain" | "street";

const BASEMAP_TILES: Record<MapStyle, string[]> = {
  dark: [
    "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
  ],
  satellite: [
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  ],
  terrain: [
    "https://tile.opentopomap.org/{z}/{x}/{y}.png",
  ],
  street: [
    "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
  ],
};

const BASEMAP_LABELS: Record<MapStyle, string> = {
  dark:      "Dark Ops",
  satellite: "Satellite",
  terrain:   "Terrain",
  street:    "Street",
};

const BASEMAP_ICONS: Record<MapStyle, string> = {
  dark:      "◼",
  satellite: "🛰",
  terrain:   "⛰",
  street:    "🗺",
};

// For satellite tiles, the zoom-y-x order is reversed — use a custom fetcher approach
const SATELLITE_ATTRIBUTION = "© Esri · Maxar · Earthstar Geographics";
const STANDARD_ATTRIBUTION  = "© CARTO · OpenStreetMap · Aircraft: OpenSky · Satellites: CelesTrak";
const TOPO_ATTRIBUTION       = "© OpenTopoMap · OpenStreetMap";
const STREET_ATTRIBUTION     = "© OpenStreetMap contributors";

const MAP_ATTRIBUTION: Record<MapStyle, string> = {
  dark:      STANDARD_ATTRIBUTION,
  satellite: SATELLITE_ATTRIBUTION,
  terrain:   TOPO_ATTRIBUTION,
  street:    STREET_ATTRIBUTION,
};

/* Maximum zoom each tile provider reliably serves. TileLayer.maxZoom is set to
   these values so deck.gl over-zooms (pixel-stretches) the last valid tile
   instead of requesting non-existent tiles that show "Map data not available". */
const TILE_MAX_ZOOM: Record<MapStyle, number> = {
  dark:      19,  // CARTO Dark
  satellite: 18,  // Esri World Imagery (most regions top out at z18)
  terrain:   17,  // OpenTopoMap
  street:    19,  // OpenStreetMap
};

const SEV_COLOR: Record<string, [number, number, number, number]> = {
  CRITICAL: [239, 68,  68, 255],
  HIGH:     [249, 115, 22, 230],
  MEDIUM:   [234, 179, 8,  210],
  LOW:      [34,  197, 94, 190],
};

function sevLabel(severity: number): keyof typeof SEV_COLOR {
  if (severity >= 0.8) return "CRITICAL";
  if (severity >= 0.6) return "HIGH";
  if (severity >= 0.4) return "MEDIUM";
  return "LOW";
}

function sevColor(severity: number): [number, number, number, number] {
  return SEV_COLOR[sevLabel(severity)];
}

function sevRadius(severity: number): number {
  if (severity >= 0.8) return 480_000;
  if (severity >= 0.6) return 360_000;
  if (severity >= 0.4) return 220_000;
  return 120_000;
}

/* ─── Arrow icon (for vessel heading) ───────────────────────────────────── */
const ARROW_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <polygon points="32,4 44,56 32,48 20,56" fill="white" opacity="0.9"/>
</svg>`;
const ARROW_DATA_URL = `data:image/svg+xml;base64,${btoa(ARROW_SVG)}`;

/* ─── Threat zone polygon builder ───────────────────────────────────────── */
function makeCircle(center: [number, number], radiusKm: number, points = 48): [number, number][] {
  const [lon, lat] = center;
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dLon  = (radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(angle);
    const dLat  = (radiusKm / 111.32) * Math.sin(angle);
    coords.push([lon + dLon, lat + dLat]);
  }
  return coords;
}

/* ─── Tooltip ────────────────────────────────────────────────────────────── */
interface TooltipData {
  x: number;
  y: number;
  label: string;
  sub?: string;
  color?: string;
  badge?: string;
}

function MapTooltip({ data }: { data: TooltipData | null }) {
  if (!data) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: data.x + 14,
        top: data.y - 14,
        pointerEvents: "none",
        zIndex: 999,
        background: "rgba(2, 6, 14, 0.96)",
        border: `1px solid ${data.color ? data.color + "55" : "rgba(56,189,248,0.3)"}`,
        borderRadius: 8,
        padding: "8px 12px",
        maxWidth: 260,
        backdropFilter: "blur(16px)",
        boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 12px ${data.color ? data.color + "22" : "rgba(56,189,248,0.1)"}`,
      }}
    >
      {data.badge && (
        <div style={{
          display: "inline-block",
          fontSize: 8,
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: data.color ?? "#38bdf8",
          borderRadius: 3,
          padding: "1px 5px",
          border: `1px solid ${data.color ?? "#38bdf8"}55`,
          background: `${data.color ?? "#38bdf8"}18`,
          marginBottom: 4,
        }}>{data.badge}</div>
      )}
      <p style={{ color: "#f1f5f9", fontSize: 11, fontWeight: 700, margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>
        {data.label}
      </p>
      {data.sub && (
        <p style={{ color: "#64748b", fontSize: 9.5, margin: "3px 0 0", fontFamily: "JetBrains Mono, monospace" }}>
          {data.sub}
        </p>
      )}
    </div>
  );
}

/* ─── Compass Rose ───────────────────────────────────────────────────────── */
function CompassRose({ bearing }: { bearing: number }) {
  return (
    <div
      className="map-overlay"
      style={{ bottom: 48, right: 14, width: 56, height: 56 }}
    >
      <svg
        width="56"
        height="56"
        viewBox="0 0 56 56"
        style={{ transform: `rotate(${-bearing}deg)`, transition: "transform 0.3s ease" }}
      >
        {/* Outer ring */}
        <circle cx="28" cy="28" r="26" fill="rgba(2,6,14,0.85)" stroke="rgba(56,189,248,0.25)" strokeWidth="1" />
        {/* Cardinal ticks */}
        {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => (
          <line
            key={deg}
            x1="28" y1="5" x2="28" y2={deg % 90 === 0 ? 9 : 7}
            stroke={deg % 90 === 0 ? "rgba(56,189,248,0.7)" : "rgba(56,189,248,0.3)"}
            strokeWidth={deg % 90 === 0 ? 1.5 : 0.8}
            transform={`rotate(${deg}, 28, 28)`}
          />
        ))}
        {/* N arrow (red) */}
        <polygon points="28,5 31.5,28 28,24 24.5,28" fill="#ef4444" opacity="0.9" />
        {/* S arrow */}
        <polygon points="28,51 31.5,28 28,32 24.5,28" fill="rgba(148,163,184,0.4)" />
        {/* Centre dot */}
        <circle cx="28" cy="28" r="3" fill="rgba(56,189,248,0.6)" />
        {/* N label */}
        <text x="28" y="18" textAnchor="middle" fontSize="6" fill="rgba(56,189,248,0.9)"
          fontFamily="Space Grotesk, sans-serif" fontWeight="700">N</text>
      </svg>
    </div>
  );
}

/* ─── Scale Bar ──────────────────────────────────────────────────────────── */
function ScaleBar({ zoom, latitude }: { zoom: number; latitude: number }) {
  const metersPerPixel = (156543.03 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom);
  const barWidthPx = 80;
  const barDistM = metersPerPixel * barWidthPx;
  const label = barDistM >= 1000
    ? `${Math.round(barDistM / 1000)} km`
    : `${Math.round(barDistM)} m`;

  return (
    <div className="map-overlay" style={{ bottom: 48, left: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span style={{ fontSize: 8, color: "rgba(148,163,184,0.6)", fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ width: 1, height: 5, background: "rgba(148,163,184,0.5)" }} />
        <div style={{ width: barWidthPx, height: 2, background: "rgba(148,163,184,0.4)" }} />
        <div style={{ width: 1, height: 5, background: "rgba(148,163,184,0.5)" }} />
      </div>
    </div>
  );
}

/* ─── Animated Pulse Rings (CSS-driven, for critical events) ─────────────── */
function PulseRings({ events, viewState }: { events: GeoEvent[]; viewState: MapViewState }) {
  // Only render rings for CRITICAL events — HTML overlaid on canvas is not practical
  // for world coords, so we rely on deck.gl ScatterplotLayer glow for this.
  return null;
}

/* ─── Map Style Picker ───────────────────────────────────────────────────── */
function MapStylePicker({
  current,
  onChange,
}: {
  current: MapStyle;
  onChange: (s: MapStyle) => void;
}) {
  const styles: MapStyle[] = ["dark", "satellite", "terrain", "street"];
  return (
    <div
      style={{
        position: "absolute",
        top: 14,
        right: 14,
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {styles.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          title={BASEMAP_LABELS[s]}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            border: `1px solid ${current === s ? "rgba(56,189,248,0.6)" : "rgba(30,48,75,0.7)"}`,
            background: current === s
              ? "rgba(56,189,248,0.15)"
              : "rgba(2,6,14,0.85)",
            color: current === s ? "#38bdf8" : "rgba(148,163,184,0.6)",
            fontSize: 14,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(8px)",
            boxShadow: current === s ? "0 0 12px rgba(56,189,248,0.2)" : "none",
            transition: "all 0.15s ease",
          }}
        >
          {BASEMAP_ICONS[s]}
        </button>
      ))}
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────── */
export default function IntelMap({
  aircraft,
  ships,
  satellites,
  events,
  layers,
  onEntitySelect,
  onMapHover,
  onViewStateChange,
}: IntelMapProps) {
  const savedStyle = useSettingsStore((s) => s.mapStyle);
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW_STATE);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [animTime, setAnimTime] = useState(0);
  const [mapStyle, setMapStyle] = useState<MapStyle>(savedStyle ?? "dark");
  const deckRef = useRef<any>(null);

  // Sync map style whenever the user changes it in settings
  useEffect(() => { setMapStyle(savedStyle ?? "dark"); }, [savedStyle]);

  // Current zoom level — used for zoom-aware dot visibility
  const zoom = viewState.zoom ?? 2;

  /* ─── Trail animation clock ───────────────────────────────────────────── */
  useEffect(() => {
    const id = setInterval(() => setAnimTime((t) => (t + 1) % 10000), 100);
    return () => clearInterval(id);
  }, []);

  /* ─── Basemap (per-provider maxZoom so over-zoom works instead of error tiles) ─ */
  const basemapLayer = useMemo(
    () =>
      new TileLayer({
        id: `basemap-${mapStyle}`,
        data: BASEMAP_TILES[mapStyle],
        tileSize: 256,
        minZoom: 0,
        maxZoom: TILE_MAX_ZOOM[mapStyle],  // fetch no higher than source limit → over-zoom stretches
        renderSubLayers: (props) => {
          const { tile } = props;
          const { bbox } = tile as any;
          if (!bbox) return null;
          return new BitmapLayer(props as any, {
            data: undefined,
            image: (props as any).data,
            bounds: [bbox.west, bbox.south, bbox.east, bbox.north] as [number, number, number, number],
          });
        },
      }),
    [mapStyle]
  );

  /* ─── Heatmap (aircraft density) ─────────────────────────────────────── */
  const heatmapLayer = useMemo(() => {
    if (!layers.heatmap || aircraft.length === 0 || zoom > 10) return [];
    return [
      new HeatmapLayer({
        id: "aircraft-heatmap",
        data: aircraft,
        getPosition: (d: Aircraft) => d.position,
        getWeight: 1,
        radiusPixels: 30,
        intensity: 1.2,
        threshold: 0.06,
        colorRange: [
          [0,   20,  60,  0],
          [0,   60,  120, 80],
          [0,   120, 200, 140],
          [56,  189, 248, 180],
          [100, 210, 255, 210],
          [255, 255, 255, 240],
        ] as any,
      }),
    ];
  }, [layers.heatmap, aircraft, zoom]);

  /* ─── Events ──────────────────────────────────────────────────────────── */
  const eventLayers = useMemo(() => {
    if (!layers.events || events.length === 0) return [];

    const criticalEvents = events.filter((e) => e.severity >= 0.8);

    return [
      // Threat zone polygons — only visible at global/regional zoom, hidden when street-level
      ...(layers.threats && zoom < 11
        ? [
            new PolygonLayer({
              id: "event-threat-zones",
              data: events,
              getPolygon: (d: GeoEvent) =>
                makeCircle(d.position, (sevRadius(d.severity) / 1000) * 0.85),
              getFillColor: (d: GeoEvent) => {
                const [r, g, b] = sevColor(d.severity);
                const fade = zoom > 8 ? (1 - (zoom - 8) / 3) : 1;
                return [r, g, b, Math.round((d.severity >= 0.8 ? 18 : 10) * fade)];
              },
              getLineColor: (d: GeoEvent) => {
                const [r, g, b] = sevColor(d.severity);
                const fade = zoom > 8 ? (1 - (zoom - 8) / 3) : 1;
                return [r, g, b, Math.round((d.severity >= 0.8 ? 80 : 40) * fade)];
              },
              lineWidthMinPixels: 1,
              stroked: true,
              filled: true,
              pickable: false,
              updateTriggers: { getFillColor: zoom, getLineColor: zoom },
            }),
            // Inner zone ring (dashed)
            new PolygonLayer({
              id: "event-threat-inner",
              data: criticalEvents,
              getPolygon: (d: GeoEvent) =>
                makeCircle(d.position, (sevRadius(d.severity) / 1000) * 0.5),
              getFillColor: [0, 0, 0, 0],
              getLineColor: (d: GeoEvent) => {
                const [r, g, b] = sevColor(d.severity);
                const fade = zoom > 8 ? (1 - (zoom - 8) / 3) : 1;
                return [r, g, b, Math.round(50 * fade)];
              },
              lineWidthMinPixels: 0.8,
              stroked: true,
              filled: false,
              pickable: false,
              getDashArray: [6, 4] as any,
              updateTriggers: { getLineColor: zoom },
            }),
          ]
        : []),

      // 3D threat pillars — only at low/mid zoom (they obscure terrain when zoomed in)
      ...(zoom < 11 ? [
        new ColumnLayer({
          id: "event-pillars",
          data: criticalEvents,
          diskResolution: 16,
          radius: 35_000,
          elevationScale: 1,
          getPosition: (d: GeoEvent) => d.position,
          getElevation: (d: GeoEvent) => 800_000 * d.severity,
          getFillColor: (d: GeoEvent) => {
            const [r, g, b] = sevColor(d.severity);
            return [r, g, b, 60];
          },
          getLineColor: (d: GeoEvent) => sevColor(d.severity),
          extruded: true,
          stroked: true,
          lineWidthMinPixels: 1,
          pickable: false,
          material: { ambient: 0.5, diffuse: 0.7, shininess: 32 } as any,
          updateTriggers: { getElevation: events },
        }),
      ] : []),

      // Outer glow ring — capped at 80px so it doesn't fill the screen at low zoom
      new ScatterplotLayer({
        id: "events-glow-outer",
        data: events,
        getPosition: (d: GeoEvent) => d.position,
        getRadius: (d: GeoEvent) => sevRadius(d.severity) * 1.6,
        getFillColor: (d: GeoEvent) => {
          const [r, g, b] = sevColor(d.severity);
          const fade = zoom > 8 ? Math.max(0, 12 * (1 - (zoom - 8) / 6)) : 12;
          return [r, g, b, Math.round(fade)];
        },
        pickable: false,
        radiusUnits: "meters",
        radiusMaxPixels: 80,
        updateTriggers: { getRadius: events, getFillColor: zoom },
      }),

      // Inner glow ring
      new ScatterplotLayer({
        id: "events-glow-inner",
        data: events,
        getPosition: (d: GeoEvent) => d.position,
        getRadius: (d: GeoEvent) => sevRadius(d.severity),
        getFillColor: (d: GeoEvent) => {
          const [r, g, b] = sevColor(d.severity);
          const fade = zoom > 8 ? Math.max(0, 28 * (1 - (zoom - 8) / 6)) : 28;
          return [r, g, b, Math.round(fade)];
        },
        pickable: false,
        radiusUnits: "meters",
        radiusMaxPixels: 55,
        updateTriggers: { getRadius: events, getFillColor: zoom },
      }),

      // Main event dot — shrinks starting at zoom 5, capped at 55px
      new ScatterplotLayer({
        id: "events-core",
        data: events,
        getPosition: (d: GeoEvent) => d.position,
        // Radius in meters; radiusMaxPixels caps screen size.
        // Shrink starts at zoom 5 so the dot doesn't fill a whole country.
        getRadius: (d: GeoEvent) => {
          const base = 55_000 + d.severity * 35_000;
          if (zoom > 14) return 400;
          if (zoom > 10) return Math.max(1_000, base * (1 - (zoom - 10) / 6));
          if (zoom > 5)  return Math.max(10_000, base * (1 - (zoom - 5) / 12));
          return base;
        },
        getFillColor: (d: GeoEvent) => {
          const [r, g, b, a] = sevColor(d.severity);
          // Fade to near-transparent at street level
          const fade = zoom > 12 ? Math.max(25, a * (1 - (zoom - 12) / 5)) : a;
          return [r, g, b, Math.round(fade)];
        },
        getLineColor: [255, 255, 255, 80],
        stroked: zoom < 13,
        lineWidthMinPixels: 1.5,
        pickable: true,
        // radiusMaxPixels is the key fix: no matter the meters value, never render
        // the dot wider than 55px on screen
        radiusMaxPixels: 55,
        radiusMinPixels: 3,
        onClick: (info: PickingInfo) =>
          info.object && onEntitySelect(info.object, "event"),
        onHover: (info: PickingInfo) => {
          if (info.object) {
            const ev = info.object as GeoEvent;
            const sk = sevLabel(ev.severity);
            const col = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#fbbf24", LOW: "#34d399" }[sk];
            setTooltip({
              x: info.x,
              y: info.y,
              label: ev.title,
              sub: `${ev.countries.join(" · ")} · ${ev.event_type.replace(/_/g, " ")}`,
              color: col,
              badge: sk,
            });
          } else {
            setTooltip(null);
          }
        },
        radiusUnits: "meters",
        updateTriggers: { getRadius: [events, zoom], getFillColor: [events, zoom] },
      }),
    ];
  }, [layers.events, layers.threats, events, onEntitySelect, animTime, zoom]);

  /* ─── Event connection arcs ───────────────────────────────────────────── */
  const arcLayer = useMemo(() => {
    if (!layers.events || events.length < 2) return [];
    const multiCountry = events.filter((e) => e.countries?.length > 1);
    if (!multiCountry.length) return [];
    const arcs: { source: GeoEvent; target: GeoEvent; sev: number }[] = [];
    for (let i = 0; i < Math.min(multiCountry.length, 14); i++) {
      const src    = multiCountry[i];
      const target = events[(i + 3) % events.length];
      if (target && target.id !== src.id)
        arcs.push({ source: src, target, sev: (src.severity + target.severity) / 2 });
    }
    return [
      new ArcLayer({
        id: "event-arcs",
        data: arcs,
        getSourcePosition: (d: any) => d.source.position,
        getTargetPosition: (d: any) => d.target.position,
        getSourceColor: (d: any) => {
          const [r, g, b] = sevColor(d.source.severity);
          return [r, g, b, 100];
        },
        getTargetColor: (d: any) => {
          const [r, g, b] = sevColor(d.target.severity);
          return [r, g, b, 20];
        },
        getWidth: 1.2,
        widthUnits: "pixels",
        pickable: false,
        getHeight: 0.4,
      }),
    ];
  }, [layers.events, events]);

  /* ─── Aircraft layers ─────────────────────────────────────────────────── */
  const aircraftLayers = useMemo(() => {
    if (!layers.aircraft || aircraft.length === 0) return [];

    // Trail paths
    const trailData = aircraft
      .filter((a) => a.trail.length >= 2)
      .map((a) => ({
        path: a.trail.map(([lon, lat]) => [lon, lat] as [number, number]),
        icao24: a.icao24,
      }));

    return [
      // Flight trail paths
      new PathLayer({
        id: "aircraft-trails",
        data: trailData,
        getPath: (d: any) => d.path,
        getColor: [56, 189, 248, 45],
        getWidth: 1,
        widthUnits: "pixels",
        pickable: false,
        jointRounded: true,
        capRounded: true,
      }),

      // Aircraft dots — altitude-tinted, zoom-aware size
      new ScatterplotLayer({
        id: "aircraft",
        data: aircraft,
        getPosition: (d: Aircraft) => d.position,
        // Use pixels mode always for aircraft — they should always be tiny dots
        getRadius: (d: Aircraft) =>
          zoom > 14 ? Math.max(1, 4 - (zoom - 14) * 0.5) :
          Math.max(2, Math.min(5, 2.5 + d.altitude / 18000)),
        radiusUnits: "pixels",
        getFillColor: (d: Aircraft) => {
          const t = Math.min(1, d.altitude / 12000);
          const alpha = zoom > 14 ? Math.max(40, 200 - (zoom - 14) * 40) : 200;
          return [
            Math.round(56  + t * 100),
            Math.round(189 + t * 50),
            248,
            alpha,
          ];
        },
        getLineColor: [56, 189, 248, 50],
        stroked: zoom < 14,
        lineWidthMinPixels: 0.5,
        pickable: true,
        onClick: (info: PickingInfo) =>
          info.object && onEntitySelect(info.object, "aircraft"),
        onHover: (info: PickingInfo) => {
          if (info.object) {
            const a = info.object as Aircraft;
            setTooltip({
              x: info.x,
              y: info.y,
              label: a.callsign || a.icao24,
              sub: `${a.originCountry} · ${Math.round(a.altitude).toLocaleString()}m · ${Math.round(a.velocity * 3.6)} km/h · ${Math.round(a.heading)}°`,
              color: "#38bdf8",
              badge: "AIRCRAFT",
            });
          } else {
            setTooltip(null);
          }
        },
        updateTriggers: { getPosition: aircraft, getRadius: [aircraft, zoom], getFillColor: [aircraft, zoom] },
      }),
    ];
  }, [layers.aircraft, aircraft, onEntitySelect, zoom]);

  /* ─── Ship layers ─────────────────────────────────────────────────────── */
  const shipLayers = useMemo(() => {
    if (!layers.ships || ships.length === 0) return [];

    const cargoColor = (cargo: string): [number, number, number, number] => {
      switch (cargo) {
        case "LNG":       return [52, 211, 153, 230];
        case "CONTAINER": return [96, 165, 250, 230];
        case "CRUDE_OIL": return [251, 146, 60, 230];
        case "BULK":      return [167, 139, 250, 220];
        default:          return [251, 191, 36, 220];
      }
    };

    return [
      // Trade route paths
      new PathLayer({
        id: "ship-routes",
        data: ships,
        getPath: (d: Vessel) => d.routeWaypoints,
        getColor: (d: Vessel) => {
          const [r, g, b] = cargoColor(d.cargoType);
          return [r, g, b, 22];
        },
        getWidth: 1,
        widthUnits: "pixels",
        pickable: false,
      }),

      // Vessel dots — also zoom-aware
      new ScatterplotLayer({
        id: "ships",
        data: ships,
        getPosition: (d: Vessel) => d.position,
        getRadius: zoom > 14 ? Math.max(2, 6 - (zoom - 14)) : 6,
        radiusUnits: "pixels",
        getFillColor: (d: Vessel) => {
          const [r, g, b, a] = cargoColor(d.cargoType);
          const alpha = zoom > 14 ? Math.max(40, a - (zoom - 14) * 40) : a;
          return [r, g, b, Math.round(alpha)];
        },
        getLineColor: [255, 220, 100, 70],
        stroked: zoom < 14,
        lineWidthMinPixels: 1,
        pickable: true,
        onClick: (info: PickingInfo) =>
          info.object && onEntitySelect(info.object, "ship"),
        onHover: (info: PickingInfo) => {
          if (info.object) {
            const s = info.object as Vessel;
            const [r, g, b] = cargoColor(s.cargoType);
            setTooltip({
              x: info.x,
              y: info.y,
              label: `${s.flag} ${s.name}`,
              sub: `${s.cargoType.replace(/_/g, " ")} · ${s.speedKnots}kn → ${s.destination}`,
              color: `rgb(${r},${g},${b})`,
              badge: "VESSEL",
            });
          } else {
            setTooltip(null);
          }
        },
        updateTriggers: { getPosition: ships, getRadius: zoom, getFillColor: zoom },
      }),
    ];
  }, [layers.ships, ships, onEntitySelect, zoom]);

  /* ─── Satellite layers ────────────────────────────────────────────────── */
  const satelliteLayers = useMemo(() => {
    if (!layers.satellites || satellites.length === 0) return [];

    const SAT_COLORS: Record<string, [number, number, number, number]> = {
      ISS:      [250, 204, 21, 255],
      GPS:      [167, 139, 250, 210],
      GALILEO:  [196, 181, 253, 200],
      WEATHER:  [52,  211, 153, 190],
      STARLINK: [148, 163, 184, 160],
      OTHER:    [100, 116, 139, 140],
    };

    return [
      // Glow ring under ISS
      new ScatterplotLayer({
        id: "iss-glow",
        data: satellites.filter((s) => s.constellation === "ISS"),
        getPosition: (d: SatellitePosition) =>
          d.position && typeof d.position !== "boolean" ? d.position : [0, 0],
        getRadius: 18,
        radiusUnits: "pixels",
        getFillColor: [250, 204, 21, 25],
        pickable: false,
      }),

      // Satellite dots — hide at zoom > 8 (they're in orbit, irrelevant when street-level)
      new ScatterplotLayer({
        id: "satellites",
        data: satellites,
        getPosition: (d: SatellitePosition) =>
          d.position && typeof d.position !== "boolean" ? d.position : [0, 0],
        getRadius: (d: SatellitePosition) =>
          d.constellation === "ISS" ? 8 : d.constellation === "GPS" ? 4 : 3,
        radiusUnits: "pixels",
        getFillColor: (d: SatellitePosition) => {
          const [r, g, b, a] = SAT_COLORS[d.constellation] ?? SAT_COLORS.OTHER;
          const alpha = zoom > 8 ? Math.max(0, a * (1 - (zoom - 8) / 4)) : a;
          return [r, g, b, Math.round(alpha)];
        },
        stroked: false,
        pickable: zoom < 9,
        onClick: (info: PickingInfo) =>
          info.object && onEntitySelect(info.object, "satellite"),
        onHover: (info: PickingInfo) => {
          if (info.object) {
            const s = info.object as SatellitePosition;
            const [r, g, b] = SAT_COLORS[s.constellation] ?? SAT_COLORS.OTHER;
            setTooltip({
              x: info.x,
              y: info.y,
              label: s.name,
              sub: `${s.constellation} · ${s.altitude.toLocaleString()} km altitude · ${s.position[1].toFixed(1)}°N`,
              color: `rgb(${r},${g},${b})`,
              badge: "SATELLITE",
            });
          } else {
            setTooltip(null);
          }
        },
        updateTriggers: { getPosition: satellites, getFillColor: zoom },
      }),
    ];
  }, [layers.satellites, satellites, onEntitySelect, zoom]);

  /* ─── Compose all layers ──────────────────────────────────────────────── */
  const allLayers = useMemo(
    () => [
      basemapLayer,
      ...heatmapLayer,
      ...arcLayer,
      ...eventLayers,
      ...shipLayers,
      ...aircraftLayers,
      ...satelliteLayers,
    ],
    [basemapLayer, heatmapLayer, arcLayer, eventLayers, shipLayers, aircraftLayers, satelliteLayers]
  );

  /* ─── View state change handler ───────────────────────────────────────── */
  const handleViewStateChange = useCallback(
    ({ viewState: vs }: any) => {
      setViewState(vs);
      onViewStateChange?.(vs);
    },
    [onViewStateChange]
  );

  /* ─── Map hover → coordinate readout ─────────────────────────────────── */
  const handleHover = useCallback(
    (info: any) => {
      if (info.coordinate) {
        onMapHover?.({ longitude: info.coordinate[0], latitude: info.coordinate[1] });
      } else {
        onMapHover?.(null);
      }
    },
    [onMapHover]
  );

  return (
    <>
      <DeckGL
        ref={deckRef}
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        controller={{
          dragPan: true,
          scrollZoom: { speed: 0.05, smooth: true },
          doubleClickZoom: true,
          touchRotate: true,
          keyboard: true,
        }}
        layers={allLayers}
        style={{ position: "absolute", inset: "0" }}
        getCursor={({ isHovering }: { isHovering: boolean }) =>
          isHovering ? "pointer" : "grab"
        }
        onHover={handleHover}
      />

      <MapTooltip data={tooltip} />

      {/* Map Style Picker */}
      <MapStylePicker current={mapStyle} onChange={setMapStyle} />

      {/* Compass Rose */}
      <CompassRose bearing={viewState.bearing ?? 0} />

      {/* Scale Bar */}
      <ScaleBar zoom={viewState.zoom} latitude={viewState.latitude} />

      {/* Zoom level indicator */}
      <div
        style={{
          position: "absolute",
          bottom: 52,
          left: 110,
          fontSize: 8,
          color: "rgba(100,116,139,0.5)",
          fontFamily: "JetBrains Mono, monospace",
          pointerEvents: "none",
        }}
      >
        z{zoom.toFixed(1)}
      </div>

      {/* Attribution */}
      <div
        className="map-overlay"
        style={{
          bottom: 8,
          right: 76,
          fontSize: 8,
          color: "rgba(100,116,139,0.45)",
          letterSpacing: "0.03em",
        }}
      >
        {MAP_ATTRIBUTION[mapStyle]}
      </div>
    </>
  );
}
