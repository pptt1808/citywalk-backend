import { env } from "../config/env";
import { PoiCategory, RouteLeg } from "../types/plan";
import { fetchJsonWithRetry, throwIfAborted } from "../utils/httpClient";
import { setTimeout as wait } from "node:timers/promises";

type AmapPoi = {
  id?: string;
  name?: string;
  type?: string;
  address?: string;
  location?: string;
  distance?: string;
  rating?: string;
  tel?: string;
  opentime2?: string;
  business_area?: string;
  cityname?: string;
  biz_ext?: {
    rating?: string;
    cost?: string;
    open_time?: string;
  };
};

export interface Poi {
  id?: string;
  name: string;
  category: PoiCategory;
  averageCost: number;
  location?: string;
  address?: string;
  city?: string;
  rating?: number;
  distanceMeters?: number;
  indoor?: boolean;
  tags?: string[];
  /** Added by the planner after map retrieval; absent on raw map results. */
  styleScore?: number;
  styleMatches?: string[];
  styleConflicts?: string[];
  styleRetrieval?: "lexical" | "vector" | "hybrid" | "none";
}

export interface PoiDetails extends Poi {
  telephone?: string;
  openingHours?: string;
  businessArea?: string;
  source: "amap";
  sourceUpdatedAt: string;
}

export interface DistanceMatrixItem {
  origin: string;
  destination: string;
  distanceMeters: number;
  durationMinutes: number;
}

export class MapTool {
  private readonly amapBaseUrl = "https://restapi.amap.com";

  // ── Geocoding ──

  async geocode(address: string, city: string, signal?: AbortSignal): Promise<string | undefined> {
    if (!env.AMAP_KEY) {
      console.warn("[MapTool] AMAP_KEY not set — geocoding unavailable");
      return undefined;
    }
    try {
      const data = await this.fetchAmapV3<{ geocodes?: Array<{ location?: string }> }>("/v3/geocode/geo", {
        address,
        city
      }, 2, signal);
      return data.geocodes?.[0]?.location;
    } catch (err) {
      console.warn(`[MapTool] geocode failed for "${address}": ${err}`);
      return undefined;
    }
  }

  // ── POI search (real API only, no mock fallback) ──

  async searchPoi(
    keywords: string[],
    options: { city: string; indoorOnly?: boolean; page?: number; offset?: number; signal?: AbortSignal }
  ): Promise<Poi[]> {
    const kw = this.normalizeKeywords(keywords);
    if (!env.AMAP_KEY) { console.warn("[MapTool] AMAP_KEY not set"); return []; }
    const results = (await this.mapWithConcurrency(kw, env.MAP_SEARCH_CONCURRENCY, (k) =>
      this.fetchPoi("/v3/place/text", {
        keywords: k, city: options.city, extensions: "all",
        citylimit: "true",
        offset: String(options.offset ?? 10), page: String(options.page ?? 1)
      }, k, options.signal),
      options.signal
    ))
      .flatMap((items) => items)
      .filter(p => !options.indoorOnly || p.indoor);
    return this.dedupePois(results);
  }

  async searchNearbyPoi(
    keywords: string[],
    options: { city: string; location?: string; indoorOnly?: boolean; radius?: number; page?: number; offset?: number; signal?: AbortSignal }
  ): Promise<Poi[]> {
    const kw = this.normalizeKeywords(keywords);
    if (!options.location) return this.searchPoi(kw, options);
    if (!env.AMAP_KEY) { console.warn("[MapTool] AMAP_KEY not set"); return []; }
    const results = (await this.mapWithConcurrency(kw, env.MAP_SEARCH_CONCURRENCY, (k) =>
      this.fetchPoi("/v3/place/around", {
        location: options.location ?? "", keywords: k,
        radius: String(options.radius ?? 2000), extensions: "all",
        offset: String(options.offset ?? 10), page: String(options.page ?? 1)
      }, k, options.signal),
      options.signal
    ))
      .flatMap((items) => items)
      .filter(p => !options.indoorOnly || p.indoor);
    return this.dedupePois(results);
  }

  /** Returns factual POI metadata from AMap. Booking rules are intentionally not inferred. */
  async getPoiDetails(keyword: string, city: string, signal?: AbortSignal): Promise<PoiDetails | undefined> {
    if (!env.AMAP_KEY || !keyword.trim()) return undefined;
    const search = await this.fetchAmapV3<{ pois?: AmapPoi[] }>("/v3/place/text", {
      keywords: keyword.trim(),
      city,
      citylimit: "true",
      extensions: "all",
      offset: "5",
      page: "1"
    }, 2, signal);
    const first = search.pois?.[0];
    if (!first) return undefined;
    let detail = first;
    if (first.id) {
      try {
        const payload = await this.fetchAmapV3<{ pois?: AmapPoi[] }>("/v3/place/detail", {
          id: first.id,
          extensions: "all"
        }, 1, signal);
        detail = payload.pois?.[0] ?? first;
      } catch (error) {
        if (signal?.aborted) throw error;
        console.warn(`[MapTool] POI detail fallback to search result: ${error}`);
      }
    }
    const normalized = this.normalizePoi(detail, keyword);
    return {
      ...normalized,
      telephone: detail.tel || undefined,
      openingHours: detail.opentime2 || detail.biz_ext?.open_time || undefined,
      businessArea: detail.business_area || undefined,
      source: "amap",
      sourceUpdatedAt: new Date().toISOString()
    };
  }

  // ── Route planning (real API only, no mock fallback) ──

  async planRoute(
    origin: string, destinations: string[],
    mode: "walk" | "transit" | "mixed", city: string, signal?: AbortSignal
  ): Promise<RouteLeg[]> {
    if (destinations.length === 0) return [];
    if (!env.AMAP_KEY) { console.warn("[MapTool] AMAP_KEY not set"); return []; }

    const legs: RouteLeg[] = [];
    let current = origin;
    for (const dest of destinations) {
      throwIfAborted(signal);
      if (!current || !dest) continue;
      try {
        if (mode === "transit") {
          legs.push(await this.planTransitRoute(current, dest, city, signal));
        } else if (mode === "walk") {
          legs.push(await this.planWalkingRoute(current, dest, signal));
        } else {
          const walk = await this.planWalkingRoute(current, dest, signal);
          if (walk.durationMinutes > 45 || walk.distanceMeters > 3000) {
            legs.push(await this.planTransitRoute(current, dest, city, signal));
          } else {
            legs.push(walk);
          }
        }
      } catch (err) { console.warn(`[MapTool] route leg failed: ${err}`); }
      current = dest;
    }
    return legs;
  }

  async planBicyclingRoute(origin: string, destination: string, signal?: AbortSignal): Promise<RouteLeg> {
    if (!env.AMAP_KEY) return { origin, destination, distanceMeters: 0, durationMinutes: 0, mode: "bicycling" };
    const data = await this.fetchAmapV4<{ data?: { paths?: Array<{ distance?: number | string; duration?: number | string }> } }>(
      "/v4/direction/bicycling", { origin, destination }, 2, signal
    );
    const path = data.data?.paths?.[0];
    return {
      origin, destination,
      distanceMeters: Number(path?.distance ?? 0),
      durationMinutes: Math.max(1, Math.round(Number(path?.duration ?? 0) / 60)),
      mode: "bicycling"
    };
  }

  async distanceMatrix(
    origins: string[], destination: string, type: "walk" | "bicycling" = "walk", signal?: AbortSignal
  ): Promise<DistanceMatrixItem[]> {
    if (origins.length === 0) return [];
    if (!env.AMAP_KEY) { console.warn("[MapTool] AMAP_KEY not set"); return []; }
    const data = await this.fetchAmapV3<{ results?: Array<{ origin_id?: string; distance?: string; duration?: string }> }>(
      "/v3/distance", { origins: origins.join("|"), destination, type: type === "bicycling" ? "3" : "1" }, 2, signal
    );
    return (data.results ?? []).map((item, i) => ({
      origin: origins[Number(item.origin_id ?? i + 1) - 1] ?? origins[i],
      destination,
      distanceMeters: Number(item.distance ?? 0),
      durationMinutes: Math.max(1, Math.round(Number(item.duration ?? 0) / 60))
    }));
  }

  // ── Private route helpers ──

  private async planWalkingRoute(origin: string, destination: string, signal?: AbortSignal): Promise<RouteLeg> {
    const data = await this.fetchAmapV3<{ route?: { paths?: Array<{ distance?: string; duration?: string }> } }>(
      "/v3/direction/walking", { origin, destination }, 2, signal
    );
    const path = data.route?.paths?.[0];
    return {
      origin, destination,
      distanceMeters: Number(path?.distance ?? 0),
      durationMinutes: Math.max(1, Math.round(Number(path?.duration ?? 0) / 60)),
      mode: "walk"
    };
  }

  private async planTransitRoute(origin: string, destination: string, city: string, signal?: AbortSignal): Promise<RouteLeg> {
    const data = await this.fetchAmapV3<{ route?: { transits?: Array<{ distance?: string; duration?: string }> } }>(
      "/v3/direction/transit/integrated", { origin, destination, city, city1: city, strategy: "0" }, 2, signal
    );
    const transit = data.route?.transits?.[0];
    return {
      origin, destination,
      distanceMeters: Number(transit?.distance ?? 0),
      durationMinutes: Math.max(1, Math.round(Number(transit?.duration ?? 0) / 60)),
      mode: "transit"
    };
  }

  // ── API helpers ──

  private async fetchPoi(path: string, query: Record<string, string>, keyword: string, signal?: AbortSignal): Promise<Poi[]> {
    const data = await this.fetchAmapV3<{ pois?: AmapPoi[] }>(path, query, 2, signal);
    return (data.pois ?? []).map(item => this.normalizePoi(item, keyword));
  }

  private normalizePoi(item: AmapPoi, keyword: string): Poi {
    const category = this.inferCategory(`${item.name ?? ""}${item.type ?? ""}${keyword}`);
    const rating = Number(item.biz_ext?.rating ?? item.rating ?? 0);
    return {
      id: item.id,
      name: String(item.name ?? keyword),
      category,
      averageCost: Number(item.biz_ext?.cost ?? 0),
      location: item.location,
      address: item.address,
      city: typeof item.cityname === "string" && item.cityname.trim() ? item.cityname.trim() : undefined,
      rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
      distanceMeters: Number(item.distance ?? 0),
      indoor: this.isIndoorCategory(category),
      tags: String(item.type ?? "").split(/[;|,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 12)
    };
  }

  private normalizeKeywords(keywords: string[] | unknown): string[] {
    if (Array.isArray(keywords)) return keywords.map(k => String(k).trim()).filter(Boolean);
    if (typeof keywords === "string" && keywords.trim()) {
      return keywords.split(/[、,，\s]+/).map(k => k.trim()).filter(Boolean);
    }
    return [];
  }

  private dedupePois(pois: Poi[]): Poi[] {
    const seen = new Set<string>();
    return pois.filter(p => { if (seen.has(p.name)) return false; seen.add(p.name); return true; });
  }

  private inferCategory(text: string): PoiCategory {
    if (/书店|书局|图书/.test(text)) return "bookstore";
    if (/咖啡|茶/.test(text)) return "cafe";
    if (/博物馆|美术馆|展览|展馆/.test(text)) return "museum";
    if (/商场|广场|购物/.test(text)) return "mall";
    if (/公园|湖|绿地/.test(text)) return "park";
    if (/餐厅|饭店|小吃|美食/.test(text)) return "restaurant";
    return "sight";
  }

  private isIndoorCategory(category: PoiCategory): boolean {
    return ["bookstore", "cafe", "museum", "mall", "restaurant"].includes(category);
  }

  private async fetchAmapV3<T>(path: string, query: Record<string, string>, retries = 2, signal?: AbortSignal): Promise<T> {
    let lastInfo = "AMap API failed";
    for (let attempt = 0; attempt <= retries; attempt++) {
      const data = await this.fetchWithRetry<T & { status?: string; info?: string }>(
        `${this.amapBaseUrl}${path}`, { key: env.AMAP_KEY ?? "", ...query }, retries, signal
      );
      if (data.status !== "0") return data;
      lastInfo = data.info ?? lastInfo;
      const rateLimited = /QPS_HAS_EXCEEDED_THE_LIMIT|TOO_FREQUENT/iu.test(lastInfo);
      if (!rateLimited || attempt >= retries) throw new Error(lastInfo);
      // AMap reports quota throttling in a successful HTTP response, so the
      // generic network retry helper cannot see it. Back off with jitter to
      // avoid all concurrent keyword workers retrying in lockstep.
      const delayMs = 500 * (2 ** attempt) + Math.floor(Math.random() * 250);
      await wait(delayMs, undefined, signal ? { signal } : undefined);
    }
    throw new Error(lastInfo);
  }

  private async fetchAmapV4<T>(path: string, query: Record<string, string>, retries = 2, signal?: AbortSignal): Promise<T> {
    const data = await this.fetchWithRetry<T & { errcode?: number; errmsg?: string }>(
      `${this.amapBaseUrl}${path}`, { key: env.AMAP_KEY ?? "", ...query }, retries, signal
    );
    if (typeof data.errcode === "number" && data.errcode !== 0) throw new Error(data.errmsg ?? "AMap v4 API failed");
    return data;
  }

  private async fetchWithRetry<T>(url: string, query: Record<string, string>, retries = 2, signal?: AbortSignal): Promise<T> {
    const search = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== ""));
    return fetchJsonWithRetry<T>(`${url}?${search.toString()}`, {}, {
      retries,
      timeoutMs: env.EXTERNAL_API_TIMEOUT_MS,
      signal
    });
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<R[]>,
    signal?: AbortSignal
  ): Promise<R[][]> {
    const results: R[][] = new Array(items.length).fill(undefined).map(() => []);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        try {
          results[index] = await worker(items[index]);
        } catch (error) {
          // fetch() reports both its own timeout and parent cancellation as
          // AbortError. Only propagate the latter.
          if (signal?.aborted) throw error;
          console.warn(`[MapTool] POI keyword search failed: ${error}`);
        }
      }
    });
    await Promise.all(runners);
    return results;
  }
}
