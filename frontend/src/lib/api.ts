/**
 * lib/api.ts — Centralized API client for Sarwagya backend
 * Handles auth token injection, refresh, and error normalization.
 */
import axios, { AxiosError, AxiosInstance } from "axios";
import { getSupabaseClient } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

class ApiClient {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      timeout: 30000,
      headers: { "Content-Type": "application/json" },
    });

    this.client.interceptors.request.use((config) => {
      if (this.accessToken) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401 && this.refreshToken) {
          try {
            const newTokens = await this.refreshAccessToken();
            if (newTokens && error.config) {
              error.config.headers.Authorization = `Bearer ${newTokens.access_token}`;
              return this.client.request(error.config);
            }
          } catch {
            this.clearTokens();
            if (typeof window !== "undefined") {
              window.location.href = "/auth/login";
            }
          }
        }
        return Promise.reject(this.normalizeError(error));
      }
    );

    // Restore tokens from sessionStorage on init (never localStorage for security)
    if (typeof window !== "undefined") {
      this.accessToken = sessionStorage.getItem("sarwagya_access_token");
      this.refreshToken = sessionStorage.getItem("sarwagya_refresh_token");
    }
  }

  private normalizeError(error: AxiosError) {
    const detail = (error.response?.data as any)?.detail;
    return {
      message: detail || error.message || "An unexpected error occurred",
      status: error.response?.status,
    };
  }

  setTokens(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    if (typeof window !== "undefined") {
      sessionStorage.setItem("sarwagya_access_token", accessToken);
      sessionStorage.setItem("sarwagya_refresh_token", refreshToken);
    }
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("sarwagya_access_token");
      sessionStorage.removeItem("sarwagya_refresh_token");
    }
  }

  private async refreshAccessToken() {
    const res = await axios.post(`${API_URL}/auth/refresh`, {
      refresh_token: this.refreshToken,
    });
    this.setTokens(res.data.access_token, res.data.refresh_token);
    return res.data;
  }

  // ── Public API methods ──────────────────────────────────────────────

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
    try {
      await this.client.post("/auth/logout");
    } finally {
      this.clearTokens();
    }
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

  async getCountryNetwork(iso3: string, depth: number = 1) {
    const res = await this.client.get(`/graph/network/${iso3}`, { params: { depth } });
    return res.data;
  }

  async getEvents(params?: {
    event_type?: string;
    min_severity?: number;
    country?: string;
    limit?: number;
  }) {
    const res = await this.client.get("/events", { params });
    return res.data;
  }

  async getTrendingEvents(hours: number = 24) {
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
    const res = await this.client.post("/reports/bilateral-brief", {
      country_a_iso3: countryAIso3,
      country_b_iso3: countryBIso3,
    });
    return res.data;
  }

  async getBilateralTrade(isoA: string, isoB: string) {
    const res = await this.client.get(`/trade/${isoA}/${isoB}`);
    return res.data;
  }
}

export const api = new ApiClient();
