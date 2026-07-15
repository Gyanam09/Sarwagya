"use client";
/**
 * /settings — User settings & profile page
 * Covers: profile, preferences, notifications, API access, pipeline status
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, User, Map, Bell, Key, Lock, Trash2, Save,
  ChevronRight, Check, RefreshCw, Play, Clock,
  AlertCircle, CheckCircle, Loader2, Settings,
  Network, Zap, Eye, EyeOff,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { api } from "@/lib/api";
import type { MapStyle } from "@/components/maps/IntelMap";
import type { AlertThreshold } from "@/store/settingsStore";

const NAV_LINKS = [
  { label: "DASHBOARD", href: "/dashboard" },
  { label: "EVENTS", href: "/events" },
  { label: "GRAPH", href: "/graph" },
  { label: "SETTINGS", href: "/settings", active: true },
];

/* ─── Section wrapper ────────────────────────────────────────────────────── */
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "rgba(6,12,26,0.9)", border: "1px solid rgba(20,35,60,0.7)" }}>
      <div className="flex items-center gap-3 px-5 py-3.5"
        style={{ borderBottom: "1px solid rgba(20,35,60,0.7)", background: "rgba(2,6,14,0.6)" }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)" }}>
          <span style={{ color: "#38bdf8" }}>{icon}</span>
        </div>
        <span className="font-display font-semibold text-sm" style={{ color: "#e2e8f0" }}>{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ─── Field row ─────────────────────────────────────────────────────────── */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3"
      style={{ borderBottom: "1px solid rgba(15,28,50,0.6)" }}>
      <span style={{ fontSize: 12, color: "rgba(148,163,184,0.7)" }}>{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/* ─── Pipeline task status ───────────────────────────────────────────────── */
function TaskBadge({ state }: { state: string }) {
  const styles: Record<string, { color: string; bg: string }> = {
    success: { color: "#34d399", bg: "rgba(34,197,94,0.1)" },
    running: { color: "#38bdf8", bg: "rgba(56,189,248,0.1)" },
    failed: { color: "#f87171", bg: "rgba(239,68,68,0.1)" },
    queued: { color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
    skipped: { color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
  };
  const s = styles[state?.toLowerCase()] ?? styles.queued;
  return (
    <span className="text-[9px] font-bold px-2 py-0.5 rounded"
      style={{ color: s.color, background: s.bg, letterSpacing: "0.06em" }}>
      {state?.toUpperCase() ?? "UNKNOWN"}
    </span>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, loadUser, logout } = useAuthStore();
  const settings = useSettingsStore();
  const qc = useQueryClient();

  const [displayName, setDisplayName]       = useState("");
  const [newPassword, setNewPassword]       = useState("");
  const [showPassword, setShowPassword]     = useState(false);
  const [saveSuccess, setSaveSuccess]       = useState(false);

  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push("/auth/login");
  }, [authLoading, isAuthenticated, router]);

  // Pipeline runs
  const { data: pipelineData, refetch: refetchPipeline } = useQuery({
    queryKey: ["pipeline-runs"],
    queryFn: () => api.getPipelineRuns("sarwagya_daily_pipeline"),
    enabled: isAuthenticated,
    staleTime: 30_000,
    retry: false,
  });

  const triggerMutation = useMutation({
    mutationFn: () => api.triggerPipeline("sarwagya_daily_pipeline"),
    onSuccess: () => { setTimeout(() => refetchPipeline(), 2000); },
  });

  const updateProfileMutation = useMutation({
    mutationFn: () => api.updateProfile({
      name: displayName || undefined,
      password: newPassword || undefined,
    }),
    onSuccess: () => {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setNewPassword("");
    },
  });

  const MAP_STYLES: Array<{ value: MapStyle; label: string }> = [
    { value: "dark",      label: "Dark Ops" },
    { value: "satellite", label: "Satellite" },
    { value: "terrain",   label: "Terrain" },
    { value: "street",    label: "Street" },
  ];

  const THRESHOLDS: Array<{ value: AlertThreshold; label: string; color: string }> = [
    { value: "all",      label: "All Events",   color: "#34d399" },
    { value: "medium",   label: "Medium+",      color: "#fbbf24" },
    { value: "high",     label: "High+",        color: "#fb923c" },
    { value: "critical", label: "Critical Only", color: "#f87171" },
  ];

  if (authLoading) return null;

  const latestRun = pipelineData?.runs?.[0];
  const pipelineNote = pipelineData?.note;

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

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 space-y-6">
        {/* Page title */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)" }}>
            <Settings className="w-4.5 h-4.5" style={{ color: "#6366f1" }} />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold" style={{ color: "#f1f5f9" }}>Settings</h1>
            <p style={{ fontSize: 11, color: "rgba(100,116,139,0.5)" }}>Manage your profile and preferences</p>
          </div>
        </div>

        {/* ─── Profile ────────────────────────────────────────────── */}
        <Section title="Profile" icon={<User className="w-3.5 h-3.5" />}>
          <FieldRow label="Email">
            <span className="font-mono-data text-sm" style={{ color: "#38bdf8" }}>{user?.email}</span>
          </FieldRow>
          <FieldRow label="Role">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded"
              style={{
                color: user?.role === "admin" ? "#f59e0b" : user?.role === "analyst" ? "#38bdf8" : "#94a3b8",
                background: user?.role === "admin" ? "rgba(245,158,11,0.1)" : "rgba(56,189,248,0.08)",
                border: "1px solid currentColor",
                borderColor: user?.role === "admin" ? "rgba(245,158,11,0.2)" : "rgba(56,189,248,0.15)",
              }}>
              {user?.role?.toUpperCase()}
            </span>
          </FieldRow>
          <FieldRow label="Display Name">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter name…"
              className="bg-transparent outline-none text-right text-sm"
              style={{ color: "#e2e8f0", borderBottom: "1px solid rgba(30,48,75,0.6)", paddingBottom: 2, minWidth: 160 }}
            />
          </FieldRow>
          <FieldRow label="New Password">
            <div className="flex items-center gap-2">
              <input
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep"
                className="bg-transparent outline-none text-right text-sm"
                style={{ color: "#e2e8f0", borderBottom: "1px solid rgba(30,48,75,0.6)", paddingBottom: 2, minWidth: 160 }}
              />
              <button onClick={() => setShowPassword((s) => !s)}>
                {showPassword
                  ? <EyeOff className="w-3.5 h-3.5" style={{ color: "rgba(100,116,139,0.5)" }} />
                  : <Eye className="w-3.5 h-3.5" style={{ color: "rgba(100,116,139,0.5)" }} />}
              </button>
            </div>
          </FieldRow>
          <div className="flex items-center justify-between mt-4">
            {saveSuccess && (
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" style={{ color: "#34d399" }} />
                <span style={{ fontSize: 11, color: "#34d399" }}>Saved!</span>
              </div>
            )}
            {updateProfileMutation.isError && (
              <span style={{ fontSize: 11, color: "#f87171" }}>Save failed. Try again.</span>
            )}
            <div className="ml-auto">
              <button
                onClick={() => updateProfileMutation.mutate()}
                disabled={!displayName && !newPassword || updateProfileMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold transition-all disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", color: "white", boxShadow: "0 0 20px rgba(99,102,241,0.3)" }}>
                {updateProfileMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Save className="w-3.5 h-3.5" />}
                SAVE PROFILE
              </button>
            </div>
          </div>
        </Section>

        {/* ─── Map Preferences ─────────────────────────────────────── */}
        <Section title="Map Preferences" icon={<Map className="w-3.5 h-3.5" />}>
          <FieldRow label="Default Map Style">
            <div className="flex items-center gap-1.5">
              {MAP_STYLES.map(({ value, label }) => (
                <button key={value} onClick={() => settings.setMapStyle(value)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                  style={{
                    background: settings.mapStyle === value ? "rgba(56,189,248,0.15)" : "rgba(8,16,30,0.8)",
                    border: `1px solid ${settings.mapStyle === value ? "rgba(56,189,248,0.35)" : "rgba(30,48,75,0.6)"}`,
                    color: settings.mapStyle === value ? "#38bdf8" : "rgba(100,116,139,0.7)",
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </FieldRow>
          <FieldRow label="Default Sidebar Open">
            <button onClick={() => settings.setSidebarDefaultOpen(!settings.sidebarDefaultOpen)}
              className="relative w-10 h-5 rounded-full transition-colors"
              style={{ background: settings.sidebarDefaultOpen ? "rgba(56,189,248,0.3)" : "rgba(30,48,75,0.6)" }}>
              <div className="absolute top-0.5 h-4 w-4 rounded-full transition-transform bg-white shadow"
                style={{ left: settings.sidebarDefaultOpen ? "calc(100% - 18px)" : 2 }} />
            </button>
          </FieldRow>
          <FieldRow label="Default Layers">
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {(["aircraft", "ships", "satellites", "events"] as const).map((layer) => {
                const on = settings.defaultLayers[layer];
                const colors: Record<string, string> = { aircraft: "#38bdf8", ships: "#fb923c", satellites: "#a78bfa", events: "#f43f5e" };
                return (
                  <button key={layer} onClick={() => settings.setDefaultLayers({ [layer]: !on })}
                    className="px-2 py-0.5 rounded text-[9px] font-bold transition-all capitalize"
                    style={{
                      background: on ? `${colors[layer]}14` : "rgba(8,16,30,0.6)",
                      border: `1px solid ${on ? colors[layer] + "40" : "rgba(30,48,75,0.5)"}`,
                      color: on ? colors[layer] : "rgba(71,85,105,0.7)",
                    }}>
                    {layer}
                  </button>
                );
              })}
            </div>
          </FieldRow>
        </Section>

        {/* ─── Notifications ───────────────────────────────────────── */}
        <Section title="Alert Notifications" icon={<Bell className="w-3.5 h-3.5" />}>
          <p style={{ fontSize: 12, color: "rgba(100,116,139,0.6)", marginBottom: 12 }}>
            Choose which events trigger sidebar notifications.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {THRESHOLDS.map(({ value, label, color }) => {
              const active = settings.alertThreshold === value;
              return (
                <button key={value} onClick={() => settings.setAlertThreshold(value)}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all"
                  style={{
                    background: active ? `${color}12` : "rgba(8,16,30,0.6)",
                    border: `1px solid ${active ? color + "35" : "rgba(20,35,60,0.6)"}`,
                  }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: active ? `0 0 8px ${color}` : "none" }} />
                  <span style={{ fontSize: 10, color: active ? color : "rgba(100,116,139,0.7)", fontWeight: 700 }}>{label}</span>
                </button>
              );
            })}
          </div>
        </Section>

        {/* ─── Pipeline Status ─────────────────────────────────────── */}
        <Section title="Data Pipeline" icon={<Zap className="w-3.5 h-3.5" />}>
          <div className="flex items-center gap-3 mb-4">
            <p style={{ fontSize: 12, color: "rgba(100,116,139,0.6)" }}>
              Sarwagya Daily Pipeline — collects, classifies, and writes events to the knowledge graph.
            </p>
            <button
              onClick={() => triggerMutation.mutate()}
              disabled={triggerMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all ml-auto shrink-0 disabled:opacity-60"
              style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)", color: "#38bdf8" }}>
              {triggerMutation.isPending
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Play className="w-3 h-3" />}
              TRIGGER RUN
            </button>
          </div>

          {pipelineNote && (
            <div className="flex items-start gap-2 rounded-xl p-3 mb-4"
              style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)" }}>
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "#fbbf24" }} />
              <p style={{ fontSize: 11, color: "rgba(251,191,36,0.8)", lineHeight: 1.5 }}>
                {pipelineNote}
                <br />
                <code style={{ fontSize: 10, color: "rgba(251,191,36,0.6)" }}>docker compose up airflow-scheduler airflow-webserver airflow-worker</code>
              </p>
            </div>
          )}

          {triggerMutation.isSuccess && (
            <div className="flex items-center gap-2 rounded-xl p-3 mb-4"
              style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}>
              <CheckCircle className="w-3.5 h-3.5" style={{ color: "#34d399" }} />
              <span style={{ fontSize: 11, color: "#34d399" }}>Pipeline triggered! Run ID: {triggerMutation.data?.run_id}</span>
            </div>
          )}

          {latestRun && (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: 9, color: "rgba(100,116,139,0.6)", fontWeight: 700, letterSpacing: "0.1em" }}>LATEST RUN</span>
                <TaskBadge state={latestRun.state} />
              </div>
              <div className="flex items-center gap-3 text-[10px]" style={{ color: "rgba(100,116,139,0.5)" }}>
                <Clock className="w-3 h-3" />
                <span>{latestRun.start_date ? new Date(latestRun.start_date).toLocaleString() : "—"}</span>
              </div>
              {latestRun.task_instances?.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {latestRun.task_instances.map((t: any) => (
                    <div key={t.task_id} className="flex items-center justify-between px-3 py-2 rounded-lg"
                      style={{ background: "rgba(2,6,14,0.8)", border: "1px solid rgba(15,28,50,0.7)" }}>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{t.task_id}</span>
                      <TaskBadge state={t.state} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ─── Danger Zone ─────────────────────────────────────────── */}
        <Section title="Danger Zone" icon={<Trash2 className="w-3.5 h-3.5" />}>
          <div className="flex items-center justify-between">
            <div>
              <p style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>Reset all preferences</p>
              <p style={{ fontSize: 11, color: "rgba(100,116,139,0.5)" }}>Restore map style, layers, and alert settings to defaults.</p>
            </div>
            <button onClick={() => settings.reset()}
              className="px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
              RESET PREFS
            </button>
          </div>
          <div className="flex items-center justify-between mt-4 pt-4"
            style={{ borderTop: "1px solid rgba(15,28,50,0.6)" }}>
            <div>
              <p style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>Sign out</p>
              <p style={{ fontSize: 11, color: "rgba(100,116,139,0.5)" }}>Log out and clear local session.</p>
            </div>
            <button onClick={async () => { await logout(); router.push("/auth/login"); }}
              className="px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
              SIGN OUT
            </button>
          </div>
        </Section>
      </main>
    </div>
  );
}
