import { env } from "../config/env";
import { PoiCategory, RouteLeg } from "../types/plan";

type AmapPoi = {
  name?: string;
  type?: string;
  address?: string;
  location?: string;
  distance?: string;
  rating?: string;
  biz_ext?: {
    rating?: string;
    cost?: string;
  };
};

export interface Poi {
  name: string;
  category: PoiCategory;
  averageCost: number;
  location?: string;
  address?: string;
  rating?: number;
  distanceMeters?: number;
  indoor?: boolean;
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

  async geocode(address: string, city: string): Promise<string | undefined> {
    if (!env.AMAP_KEY) {
      console.warn("[MapTool] AMAP_KEY not set — geocoding unavailable");
      return undefined;
    }
    try {
      const data = await this.fetchAmapV3<{ geocodes?: Array<{ location?: string }> }>("/v3/geocode/geo", {
        address,
        city
      });
      return data.geocodes?.[0]?.location;
    } catch (err) {
      console.warn(`[MapTool] geocode failed for "${address}": ${err}`);
      return undefined;
    }
  }

  // ── POI search (real API only, no mock fallback) ──

  async searchPoi(
    keywords: string[],
    options: { city: string; indoorOnly?: boolean; page?: number; offset?: number }
  ): Promise<Poi[]> {
    const kw = this.normalizeKeywords(keywords);
    if (!env.AMAP_KEY) { console.warn("[MapTool] AMAP_KEY not set"); return []; }
    const requests = kw.map((k) =>
      this.fetchPoi("/v3/place/text", {
        keywords: k, city: options.city, extensions: "all",
        offset: String(options.offset ?? 10), page: String(options.page ?? 1)
      }, k)
    );
    const results = (await Promise.allSettled(requests))
      .flatMap(r => r.status === "fulfilled" ? r.value : [])
      .filter(p => !options.indoorOnly || p.indoor);
    return this.dedupePois(results);
  }

  async searchNearbyPoi(
    keywords: string[],
    options: { city: string; location?: string; indoorOnly?: boolean; radius?: number; page?: number; offset?: number }
  ): Promise<Poi[]> {
    const kw = this.normalizeKeywords(keywords);
    if (!options.location) return this.searchPoi(kw, options);
    if (!env.AMAP_KEY) { console.warn("[MapTool] AMAP_KEY not set"); return []; }
    const requests = kw.map((k) =>
      this.fetchPoi("/v3/place/around", {
        location: options.location ?? "", keywords: k,
        radius: String(options.radius ?? 2000), extensions: "all",
        offset: String(options.offset ?? 10), page: String(options.page ?? 1)
      }, k)
    );
    const results = (await Promise.allSettled(requests))
      .flatMap(r => r.status === "fulfilled" ? r.value : [])
      .filter(p => !options.indoorOnly || p.indoor);
    return this.dedupePois(results);
  }

  // ── Route planning (real API only, no mock fallback) ──

  async planRoute(
    origin: string, destinations: string[],
    mode: "walk" | "transit" | "mixed", city: string
  ): Promise<RouteLeg[]> {
    if (destinations.length === 0) return [];
    if (!env.AMAP_KEY) { console.warn("[MapTool] AMAP_KEY not set"); return []; }

    const legs: RouteLeg[] = [];
    let current = origin;
    for (const dest of destinations) {
      if (!current || !dest) continue;
      try {
        if (mode === "transit") {
          legs.push(await this.planTransitRoute(current, dest, city));
        } else if (mode === "walk") {
          legs.push(await this.planWalkingRoute(current, dest));
        } else {
          const walk = await this.planWalkingRoute(current, dest);
          if (walk.durationMinutes > 45 || walk.distanceMeters > 3000) {
            legs.push(await this.planTransitRoute(current, dest, city));
          } else {
            legs.push(walk);
          }
        }
      } catch (err) { console.warn(`[MapTool] route leg failed: ${err}`); }
      current = dest;
    }
    return legs;
  }

  async planBicyclingRoute(origin: string, destination: string): Promise<RouteLeg> {
    if (!env.AMAP_KEY) return { origin, destination, distanceMeters: 0, durationMinutes: 0, mode: "bicycling" };
    const data = await this.fetchAmapV4<{ data?: { paths?: Array<{ distance?: number | string; duration?: number | string }> } }>(
      "/v4/direction/bicycling", { origin, destination }
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
    origins: string[], destination: string, type: "walk" | "bicycling" = "walk"
  ): Promise<DistanceMatrixItem[]> {
    if (origins.length === 0) return [];
    if (!env.AMAP_KEY) { console.warn("[MapTool] AMAP_KEY not set"); return []; }
    const data = await this.fetchAmapV3<{ results?: Array<{ origin_id?: string; distance?: string; duration?: string }> }>(
      "/v3/distance", { origins: origins.join("|"), destination, type: type === "bicycling" ? "3" : "1" }
    );
    return (data.results ?? []).map((item, i) => ({
      origin: origins[Number(item.origin_id ?? i + 1) - 1] ?? origins[i],
      destination,
      distanceMeters: Number(item.distance ?? 0),
      durationMinutes: Math.max(1, Math.round(Number(item.duration ?? 0) / 60))
    }));
  }

  // ── Private route helpers ──

  private async planWalkingRoute(origin: string, destination: string): Promise<RouteLeg> {
    const data = await this.fetchAmapV3<{ route?: { paths?: Array<{ distance?: string; duration?: string }> } }>(
      "/v3/direction/walking", { origin, destination }
    );
    const path = data.route?.paths?.[0];
    return {
      origin, destination,
      distanceMeters: Number(path?.distance ?? 0),
      durationMinutes: Math.max(1, Math.round(Number(path?.duration ?? 0) / 60)),
      mode: "walk"
    };
  }

  private async planTransitRoute(origin: string, destination: string, city: string): Promise<RouteLeg> {
    const data = await this.fetchAmapV3<{ route?: { transits?: Array<{ distance?: string; duration?: string }> } }>(
      "/v3/direction/transit/integrated", { origin, destination, city, city1: city, strategy: "0" }
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

  private async fetchPoi(path: string, query: Record<string, string>, keyword: string): Promise<Poi[]> {
    const data = await this.fetchAmapV3<{ pois?: AmapPoi[] }>(path, query);
    return (data.pois ?? []).map(item => this.normalizePoi(item, keyword));
  }

  private normalizePoi(item: AmapPoi, keyword: string): Poi {
    const category = this.inferCategory(`${item.name ?? ""}${item.type ?? ""}${keyword}`);
    const rating = Number(item.biz_ext?.rating ?? item.rating ?? 0);
    return {
      name: String(item.name ?? keyword),
      category,
      averageCost: Number(item.biz_ext?.cost ?? 0),
      location: item.location,
      address: item.address,
      rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
      distanceMeters: Number(item.distance ?? 0),
      indoor: this.isIndoorCategory(category)
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

  private async fetchAmapV3<T>(path: string, query: Record<string, string>, retries = 2): Promise<T> {
    const data = await this.fetchWithRetry<T & { status?: string; info?: string }>(
      `${this.amapBaseUrl}${path}`, { key: env.AMAP_KEY ?? "", ...query }, retries
    );
    if (data.status === "0") throw new Error(data.info ?? "AMap API failed");
    return data;
  }

  private async fetchAmapV4<T>(path: string, query: Record<string, string>, retries = 2): Promise<T> {
    const data = await this.fetchWithRetry<T & { errcode?: number; errmsg?: string }>(
      `${this.amapBaseUrl}${path}`, { key: env.AMAP_KEY ?? "", ...query }, retries
    );
    if (typeof data.errcode === "number" && data.errcode !== 0) throw new Error(data.errmsg ?? "AMap v4 API failed");
    return data;
  }

  private async fetchWithRetry<T>(url: string, query: Record<string, string>, retries = 2): Promise<T> {
    const search = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== ""));
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(`${url}?${search.toString()}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as T;
      } catch (error) { lastError = error; await this.delay(300 * 2 ** attempt); }
    }
    throw lastError;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}
