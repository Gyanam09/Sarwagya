"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import {
  Shield,
  LogOut,
  TrendingUp,
  FileText,
  HelpCircle,
  Play,
  Loader2,
  AlertCircle,
  Globe,
  TrendingDown,
  Layers,
  Clock,
  Compass,
  CheckCircle,
  Sparkles,
} from "lucide-react";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-500/10 text-red-400 border-red-500/30",
  HIGH: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  MEDIUM: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  LOW: "bg-green-500/10 text-green-400 border-green-500/30",
};

const IMPACT_COLORS: Record<string, string> = {
  CRITICAL: "text-red-400 bg-red-500/10 border-red-500/20",
  HIGH: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  MEDIUM: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  LOW: "text-green-400 bg-green-500/10 border-green-500/20",
  MINIMAL: "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

function severityLabel(score: number): string {
  if (score >= 0.8) return "CRITICAL";
  if (score >= 0.5) return "HIGH";
  if (score >= 0.3) return "MEDIUM";
  return "LOW";
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, loadUser, logout } = useAuthStore();
  const [forecastResult, setForecastResult] = useState<any | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  // Authenticate user on load
  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/auth/login");
    }
  }, [authLoading, isAuthenticated, router]);

  // Fetch dashboard data only when authenticated
  const { data: trending, isLoading: trendingLoading } = useQuery({
    queryKey: ["trending-events"],
    queryFn: () => api.getTrendingEvents(24),
    enabled: isAuthenticated,
  });

  const { data: digest, isLoading: digestLoading } = useQuery({
    queryKey: ["daily-digest"],
    queryFn: () => api.getDailyDigest(),
    retry: false,
    enabled: isAuthenticated,
  });

  const handleLogout = async () => {
    await logout();
    router.push("/auth/login");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
        <p className="text-slate-400 text-sm">Initializing secure session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative">
      {/* Background gradients */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-blue-600/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-indigo-600/5 blur-[120px] pointer-events-none" />

      {/* Header / Navbar */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/10">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight leading-none">
                सर्वज्ञ <span className="text-slate-400 font-normal text-sm">Sarwagya</span>
              </h1>
              <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
                Geopolitical Intelligence Portal
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-slate-300">{user.email.split("@")[0]}</p>
                <p className="text-xs text-slate-500 capitalize">{user.role}</p>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="p-2 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-red-400 transition"
              title="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Dashboard container */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Alerts and digest row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Trending events */}
          <section className="lg:col-span-2 bg-slate-900/40 backdrop-blur-xl border border-slate-900 rounded-xl p-6 relative overflow-hidden">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800/60 pb-3">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <h2 className="text-base font-semibold">Trending Events — Last 24 Hours</h2>
            </div>
            {trendingLoading && (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading trending events...
              </div>
            )}
            {!trendingLoading && (!trending || trending.length === 0) && (
              <p className="text-slate-500 text-sm py-4">No recent geopolitical events found.</p>
            )}
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
              {trending?.map((event: any) => (
                <div
                  key={event.event_id}
                  className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-slate-950/40 hover:bg-slate-900/60 border border-slate-900 hover:border-slate-800 transition duration-200"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-slate-200 truncate">{event.title}</p>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                      <span className="capitalize">{event.event_type}</span>
                      <span>·</span>
                      <span className="truncate">{event.countries_involved?.join(", ")}</span>
                    </p>
                  </div>
                  <span
                    className={`severity-badge border shrink-0 ${
                      SEVERITY_COLORS[severityLabel(event.severity)]
                    }`}
                  >
                    {severityLabel(event.severity)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Daily digest summary */}
          <section className="bg-slate-900/40 backdrop-blur-xl border border-slate-900 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800/60 pb-3">
              <FileText className="w-4 h-4 text-indigo-500" />
              <h2 className="text-base font-semibold">Executive Digest</h2>
            </div>
            {digestLoading && (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Preparing report...
              </div>
            )}
            {!digest && !digestLoading && (
              <p className="text-slate-500 text-xs py-4 leading-relaxed">
                Digest not yet generated for today. The analytics engine compiles daily briefings automatically at 03:00 UTC.
              </p>
            )}
            {digest && (
              <div className="space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">{digest.executive_summary}</p>
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Key Outlooks</p>
                  <ul className="space-y-2">
                    {digest.key_takeaways?.map((point: string, i: number) => (
                      <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                        <span className="text-indigo-400 font-bold shrink-0 mt-0.5">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Ask Sarwagya / Forecast */}
        <section className="bg-slate-900/40 backdrop-blur-xl border border-slate-900 rounded-xl p-6 space-y-6">
          <div className="border-b border-slate-800/60 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-yellow-500" />
              <div>
                <h2 className="text-base font-semibold">Predictive Impact Forecaster</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Analyze cascading systemic shocks using geopolitical dependency modeling.
                </p>
              </div>
            </div>
          </div>

          <ForecastQueryBox
            setResult={setForecastResult}
            setLoading={setForecastLoading}
            loading={forecastLoading}
            setError={setForecastError}
          />

          {forecastError && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex gap-2.5 items-start">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{forecastError}</span>
            </div>
          )}

          {forecastLoading && (
            <div className="p-12 text-center flex flex-col items-center justify-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <p className="text-sm text-slate-400">Modeling dependency paths and predicting outcomes...</p>
              <p className="text-xs text-slate-600 max-w-sm">
                Evaluating international trade links, alliances, and security impacts across our database.
              </p>
            </div>
          )}

          {/* Forecast Results View */}
          {forecastResult && !forecastLoading && (
            <div className="space-y-6 pt-4 border-t border-slate-800/40 animate-in fade-in slide-in-from-bottom-3 duration-300">
              {/* Event Header Card */}
              <div className="bg-slate-950/60 border border-slate-800/50 rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-2">
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
                    {forecastResult.event_type || "Scenario Forecast"}
                  </span>
                  <h3 className="text-lg font-bold text-slate-100">{forecastResult.event_summary}</h3>
                  <div className="flex flex-wrap gap-4 text-xs text-slate-500 pt-1">
                    {forecastResult.trigger_country && (
                      <p>
                        Trigger: <strong className="text-slate-300">{forecastResult.trigger_country}</strong>
                      </p>
                    )}
                    {forecastResult.target_country && (
                      <p>
                        Target: <strong className="text-slate-300">{forecastResult.target_country}</strong>
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-4 items-center justify-between md:justify-end border-t md:border-t-0 pt-4 md:pt-0 md:pl-6 md:border-l border-slate-800/60">
                  <div className="text-center md:text-right">
                    <p className="text-xs text-slate-500">Systemic Risk</p>
                    <div className="flex items-baseline gap-1 mt-0.5 justify-center md:justify-end">
                      <span className="text-2xl font-black text-red-400">
                        {Math.round((forecastResult.global_impact_score || 0) * 100)}%
                      </span>
                    </div>
                  </div>
                  <div className="text-center md:text-right">
                    <p className="text-xs text-slate-500">Confidence</p>
                    <div className="flex items-baseline gap-1 mt-0.5 justify-center md:justify-end">
                      <span className="text-2xl font-black text-emerald-400">
                        {Math.round((forecastResult.confidence || 0) * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cascade analysis columns */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Impacted countries list */}
                <div className="lg:col-span-2 bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-4">
                  <h4 className="font-semibold text-sm flex items-center gap-2 text-slate-300">
                    <Globe className="w-4 h-4 text-blue-400" /> Country Exposure Forecast
                  </h4>

                  <div className="space-y-3">
                    {forecastResult.country_impacts?.map((impact: any, idx: number) => (
                      <div
                        key={idx}
                        className="bg-slate-900/30 border border-slate-900 hover:border-slate-800 rounded-xl p-4 transition duration-200"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-slate-800 flex items-center justify-center text-[8px] font-bold text-slate-400 border border-slate-700">
                              {impact.country_iso3}
                            </span>
                            <span className="font-semibold text-sm text-slate-200">{impact.country_name}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">
                              {impact.timeline}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                IMPACT_COLORS[impact.impact_level]
                              }`}
                            >
                              {impact.impact_level}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-slate-400 leading-relaxed mb-3">{impact.mechanism}</p>

                        <div className="flex flex-wrap items-center gap-4 text-[10px] text-slate-500 border-t border-slate-800/30 pt-2.5">
                          <span className="flex items-center gap-1">
                            <Layers className="w-3.5 h-3.5" />
                            Sectors: {impact.affected_sectors?.join(", ") || "None"}
                          </span>
                          {impact.beneficiary && (
                            <span className="text-emerald-400 font-semibold bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10">
                              Beneficiary
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Scenario details / Supply chains */}
                <div className="space-y-6">
                  {/* Risks & Supply chains */}
                  <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-4">
                    <h4 className="font-semibold text-sm flex items-center gap-2 text-slate-300">
                      <TrendingDown className="w-4 h-4 text-orange-400" /> Material & Supply Chain Shocks
                    </h4>
                    <ul className="space-y-2 text-xs">
                      {forecastResult.supply_chain_risks?.map((risk: string, idx: number) => (
                        <li key={idx} className="flex gap-2 text-slate-400 items-start leading-relaxed">
                          <span className="text-orange-500 font-bold mt-0.5">•</span>
                          <span>{risk}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Scenarios Outlook */}
                  <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-4">
                    <h4 className="font-semibold text-sm flex items-center gap-2 text-slate-300">
                      <Clock className="w-4 h-4 text-indigo-400" /> Timeline Escalations
                    </h4>
                    <div className="space-y-3.5 text-xs">
                      <div className="border-l-2 border-blue-500/40 pl-3">
                        <p className="font-semibold text-slate-300 mb-0.5">Short-term Outlook (1-3 mos)</p>
                        <p className="text-slate-400 leading-relaxed">{forecastResult.scenario_short}</p>
                      </div>
                      <div className="border-l-2 border-indigo-500/40 pl-3">
                        <p className="font-semibold text-slate-300 mb-0.5">Medium-term Outlook (3-12 mos)</p>
                        <p className="text-slate-400 leading-relaxed">{forecastResult.scenario_medium}</p>
                      </div>
                      <div className="border-l-2 border-purple-500/40 pl-3">
                        <p className="font-semibold text-slate-300 mb-0.5">Long-term Outlook (1-3 yrs)</p>
                        <p className="text-slate-400 leading-relaxed">{forecastResult.scenario_long}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function ForecastQueryBox({
  setResult,
  setLoading,
  loading,
  setError,
}: {
  setResult: (res: any) => void;
  setLoading: (loading: boolean) => void;
  loading: boolean;
  setError: (err: string | null) => void;
}) {
  const [query, setQuery] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const result = await api.predictImpact(query);
      setResult(result);
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message || "Failed to generate geopolitical forecast. Please verify connection credentials."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="flex flex-col sm:flex-row gap-3" onSubmit={handleSubmit}>
      <input
        name="query"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g., What happens if China bans semiconductor material exports to Germany?"
        className="flex-1 bg-slate-950/60 border border-slate-800/80 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition"
        disabled={loading}
      />
      <button
        type="submit"
        className="bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition px-6 py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 shadow-lg shadow-blue-500/10 shrink-0"
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <Play className="w-3.5 h-3.5 fill-current" />
            Forecast
          </>
        )}
      </button>
    </form>
  );
}
