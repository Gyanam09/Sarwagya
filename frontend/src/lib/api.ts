/**
 * lib/api.ts — Sarwagya API client
 * Uses localStorage for token persistence (survives tab close/refresh)
 */
import axios, { AxiosError, AxiosInstance } from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
const ACCESS_KEY = "sarwagya_access_token";
const REFRESH_KEY = "sarwagya_refresh_token";

class ApiClient {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      timeout: 60000,
      headers: { "Content-Type": "application/json" },
    });

    // Restore tokens from localStorage on init
    if (typeof window !== "undefined") {
      this.accessToken = localStorage.getItem(ACCESS_KEY);
      this.refreshToken = localStorage.getItem(REFRESH_KEY);
    }

    this.client.interceptors.request.use((config) => {
      if (this.accessToken) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (r) => r,
      async (error: AxiosError) => {
        if (error.response?.status === 401 && this.refreshToken) {
          try {
            const res = await axios.post(`${API_URL}/auth/refresh`, {
              refresh_token: this.refreshToken,
            });
            this.setTokens(res.data.access_token, res.data.refresh_token);
            if (error.config) {
              error.config.headers.Authorization = `Bearer ${res.data.access_token}`;
              return this.client.request(error.config);
            }
          } catch {
            this.clearTokens();
            if (typeof window !== "undefined") window.location.href = "/auth/login";
          }
        }
        const detail = (error.response?.data as any)?.detail;
        return Promise.reject({ message: detail || error.message || "Unexpected error", status: error.response?.status });
      }
    );
  }

  setTokens(access: string, refresh: string) {
    this.accessToken = access;
    this.refreshToken = refresh;
    if (typeof window !== "undefined") {
      localStorage.setItem(ACCESS_KEY, access);
      localStorage.setItem(REFRESH_KEY, refresh);
    }
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
    }
  }

  hasTokens(): boolean {
    if (typeof window !== "undefined") {
      return !!localStorage.getItem(ACCESS_KEY);
    }
    return !!this.accessToken;
  }

  async login(email: string, password: string) {
    const res = await this.client.post("/auth/login", { email, password });
    this.setTokens(res.data.access_token, res.data.refresh_token);
    return res.data;
  }

  async register(email: string, password: string, name: string) {
    const res = await this.client.post("/auth/register", { email, password, name });
    this.setTokens(res.data.access_token, res.data.refresh_token);
    return res.data;
  }

  async logout() {
    try { await this.client.post("/auth/logout"); } finally { this.clearTokens(); }
  }

  async getMe() {
    const res = await this.client.get("/auth/me");
    return res.data;
  }

  async getCountries(params?: { region?: string; search?: string; limit?: number }) {
    const res = await this.client.get("/countries", { params });
    return res.data;
  }

  async getCountry(iso3: string) {
    const res = await this.client.get(`/countries/${iso3}`);
    return res.data;
  }

  async getCountryRelationships(iso3: string, relationshipType?: string) {
    const res = await this.client.get(`/countries/${iso3}/relationships`, {
      params: { relationship_type: relationshipType },
    });
    return res.data;
  }

  async getCountryNetwork(iso3: string, depth = 1) {
    const res = await this.client.get(`/graph/network/${iso3}`, { params: { depth } });
    return res.data;
  }

  async getEvents(params?: { event_type?: string; min_severity?: number; country?: string; limit?: number }) {
    const res = await this.client.get("/events", { params });
    return res.data;
  }

  async getTrendingEvents(hours = 24) {
    const res = await this.client.get("/events/trending/now", { params: { hours } });
    return res.data;
  }

  async getDailyDigest() {
    const res = await this.client.get("/reports/daily-digest");
    return res.data;
  }

  async predictImpact(eventDescription: string, triggerIso3?: string, targetIso3?: string) {
    const res = await this.client.post("/forecasts/predict", {
      event_description: eventDescription,
      trigger_country_iso3: triggerIso3,
      target_country_iso3: targetIso3,
    });
    return res.data;
  }

  async generateCountryBrief(countryIso3: string) {
    const res = await this.client.post("/reports/country-brief", { country_iso3: countryIso3 });
    return res.data;
  }

  async generateBilateralBrief(countryAIso3: string, countryBIso3: string) {
    const res = await this.client.post("/reports/bilateral-brief", { country_a_iso3: countryAIso3, country_b_iso3: countryBIso3 });
    return res.data;
  }

  async getBilateralTrade(isoA: string, isoB: string) {
    const res = await this.client.get(`/trade/${isoA}/${isoB}`);
    return res.data;
  }

  async intelSearch(query: string, contextCountries?: string[]) {
    const res = await this.client.post("/search/intel", {
      query,
      context_countries: contextCountries ?? [],
    });
    return res.data as {
      query: string;
      answer: string;
      key_points: string[];
      relevant_events: Array<{
        title: string;
        event_type: string;
        severity: number;
        summary: string;
        countries_involved: string[];
        affected_sectors: string[];
      }>;
      countries_involved: string[];
      sectors_affected: string[];
      confidence: "HIGH" | "MEDIUM" | "LOW";
      sources: string[];
      query_type: string;
      generated_at: string;
    };
  }
}

export const api = new ApiClient();
