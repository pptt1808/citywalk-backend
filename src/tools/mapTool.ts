import { env } from "../config/env";
import {
  PoiCategory,
  PoiDiscoverySource,
  PoiKind,
  PoiVerificationStatus,
  RouteLeg
} from "../types/plan";
import { fetchJsonWithRetry, throwIfAborted } from "../utils/httpClient";
import { setTimeout as wait } from "node:timers/promises";
import { createHash } from "node:crypto";
import { cache } from "../utils/cache";

const POI_CACHE_TTL_MS = 15 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type AmapPoi = {
  id?: string;
  name?: string;
  type?: string;
  typecode?: string;
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
  business?: {
    business_area?: string;
    tel?: string;
    tag?: string;
    rating?: string;
    cost?: string;
    opentime_today?: string;
    opentime_week?: string;
  };
  indoor_data?: {
    indoor_map?: string;
  };
};

export interface PoiSearchOptions {
  city: string;
  location?: string;
  indoorOnly?: boolean;
  radius?: number;
  page?: number;
  offset?: number;
  types?: string[];
  sortRule?: "distance" | "weight";
  signal?: AbortSignal;
}

export function inferPoiCategory(text: string): PoiCategory {
  if (/书店|书局|图书|阅读空间/u.test(text)) return "bookstore";
  if (/咖啡|甜品|甜点|蛋糕|烘焙|面包店|茶馆|茶室|饮品店/u.test(text)) return "cafe";
  if (/博物馆|美术馆|展览馆|展馆|纪念馆/u.test(text)) return "museum";
  if (/菜市场|集贸市场|跳蚤市场|创意市集|周末市集|街市/u.test(text)) return "market";
  if (/工作室|工坊|手作体验|创意空间|独立画廊|艺术家空间/u.test(text)) return "studio";
  if (/古着|唱片店|买手店|花店|杂货店|文创店|二手店|旧货店|独立小店|主理人店|服装鞋帽|专卖店|零售店|精品店/u.test(text)) return "shop";
  if (/公园|湿地|植物园|森林|绿地|湖泊|滨水/u.test(text)) return "park";
  if (/餐厅|饭店|小吃|美食|餐饮服务|面馆|酒楼|料理店/u.test(text)) return "restaurant";
  if (/商场|购物中心|商业综合体|百货大楼/u.test(text)) return "mall";
  if (/市集活动|展会|节庆|音乐节|临时活动|快闪活动/u.test(text)) return "event";
  if (/天桥|胡同|小巷|街角|步道|河岸|沿江|建筑立面|楼梯|观景点|街道/u.test(text)) return "street_scene";
  return "sight";
}

export function inferPoiKind(category: PoiCategory): PoiKind {
  if (["bookstore", "cafe", "mall", "restaurant", "shop", "market", "studio"].includes(category)) return "business";
  if (category === "museum") return "culture";
  if (category === "street_scene") return "street_scene";
  if (category === "event") return "event";
  return "landscape";
}

export interface Poi {
  id?: string;
  name: string;
  category: PoiCategory;
  kind?: PoiKind;
  subtype?: string;
  amapTypeCode?: string;
  averageCost: number;
  location?: string;
  address?: string;
  city?: string;
  rating?: number;
  distanceMeters?: number;
  indoor?: boolean;
  tags?: string[];
  discoverySource?: PoiDiscoverySource;
  verificationStatus?: PoiVerificationStatus;
  evidenceUrls?: string[];
  discoveryReasons?: string[];
  discoveryConfidence?: number;
  cityWalkScore?: number;
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
    const cacheKey = `amap-geocode:${createHash("sha256").update(`${city}:${address}`).digest("hex")}`;
    const cached = cache.get<string>(cacheKey);
    if (cached) return cached;
    try {
      const data = await this.fetchAmap<{ geocodes?: Array<{ location?: string }> }>("/v3/geocode/geo", {
        address,
        city
      }, 2, signal);
      const location = data.geocodes?.[0]?.location;
      if (location) cache.set(cacheKey, location, GEOCODE_CACHE_TTL_MS);
      return location;
    } catch (err) {
      console.warn(`[MapTool] geocode failed for "${address}": ${err}`);
      return undefined;
    }
  }

  // ── POI search (real API only, no mock fallback) ──

  async searchPoi(
    keywords: string[],
    options: PoiSearchOptions
  ): Promise<Poi[]> {
    const kw = this.normalizeKeywords(keywords);
    if (!env.AMAP_KEY) { console.warn("[MapTool] AMAP_KEY not set"); return []; }
    const requests = kw.length ? kw : options.types?.length ? [""] : [];
    const results = (await this.mapWithConcurrency(requests, env.MAP_SEARCH_CONCURRENCY, (k) =>
      this.fetchPoi("/v5/place/text", {
        keywords: k,
        types: options.types?.join("|") ?? "",
        region: options.city,
        city_limit: "true",
        show_fields: "business,indoor,photos",
        page_size: String(options.offset ?? 15),
        page_num: String(options.page ?? 1)
      }, k, options.signal),
      options.signal
    ))
      .flatMap((items) => items)
      .filter(p => !options.indoorOnly || p.indoor);
    return this.dedupePois(results);
  }

  async searchNearbyPoi(
    keywords: string[],
    options: PoiSearchOptions
  ): Promise<Poi[]> {
    const kw = this.normalizeKeywords(keywords);
    if (!options.location) return this.searchPoi(kw, options);
    if (!env.AMAP_KEY) { console.warn("[MapTool] AMAP_KEY not set"); return []; }
    const requests = kw.length ? kw : options.types?.length ? [""] : [];
    const results = (await this.mapWithConcurrency(requests, env.MAP_SEARCH_CONCURRENCY, (k) =>
      this.fetchPoi("/v5/place/around", {
        location: options.location ?? "",
        keywords: k,
        types: options.types?.join("|") ?? "",
        radius: String(options.radius ?? 2000),
        sortrule: options.sortRule ?? "distance",
        region: options.city,
        city_limit: "true",
        show_fields: "business,indoor,photos",
        page_size: String(options.offset ?? 15),
        page_num: String(options.page ?? 1)
      }, k, options.signal),
      options.signal
    ))
      .flatMap((items) => items)
      .filter(p => !options.indoorOnly || p.indoor);
    return this.dedupePois(results);
  }

  /**
   * Resolve a name found outside the map provider back to a nearby AMap POI.
   * A loose keyword hit is not enough: the returned name must pass a local
   * similarity threshold so web prose cannot silently turn into a wrong pin.
   */
  async resolvePoiCandidate(
    name: string,
    options: Pick<PoiSearchOptions, "city" | "location" | "radius" | "signal">
  ): Promise<Poi | undefined> {
    const query = name.trim();
    if (!query) return undefined;
    const candidates = options.location
      ? await this.searchNearbyPoi([query], { ...options, offset: 8, sortRule: "weight" })
      : await this.searchPoi([query], { ...options, offset: 8 });
    return candidates
      .map((poi) => ({ poi, score: this.placeNameSimilarity(query, poi.name) }))
      .filter((item) => item.score >= 0.62)
      .sort((left, right) => right.score - left.score
        || (left.poi.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (right.poi.distanceMeters ?? Number.MAX_SAFE_INTEGER))[0]?.poi;
  }

  /** Returns factual POI metadata from AMap. Booking rules are intentionally not inferred. */
  async getPoiDetails(keyword: string, city: string, signal?: AbortSignal): Promise<PoiDetails | undefined> {
    if (!env.AMAP_KEY || !keyword.trim()) return undefined;
    const cacheKey = `amap-poi-detail:${createHash("sha256").update(`${city}:${keyword.trim()}`).digest("hex")}`;
    const cached = cache.get<PoiDetails>(cacheKey);
    if (cached) return cached;
    const search = await this.fetchAmap<{ pois?: AmapPoi[] }>("/v5/place/text", {
      keywords: keyword.trim(),
      region: city,
      city_limit: "true",
      show_fields: "business,indoor,photos",
      page_size: "5",
      page_num: "1"
    }, 2, signal);
    const first = search.pois?.[0];
    if (!first) return undefined;
    let detail = first;
    if (first.id) {
      try {
        const payload = await this.fetchAmap<{ pois?: AmapPoi[] }>("/v5/place/detail", {
          id: first.id,
          show_fields: "business,indoor,photos"
        }, 1, signal);
        detail = payload.pois?.[0] ?? first;
      } catch (error) {
        if (signal?.aborted) throw error;
        console.warn(`[MapTool] POI detail fallback to search result: ${error}`);
      }
    }
    const normalized = this.normalizePoi(detail, keyword);
    const result: PoiDetails = {
      ...normalized,
      telephone: detail.business?.tel || detail.tel || undefined,
      openingHours: detail.business?.opentime_today || detail.business?.opentime_week || detail.opentime2 || detail.biz_ext?.open_time || undefined,
      businessArea: detail.business?.business_area || detail.business_area || undefined,
      source: "amap",
      sourceUpdatedAt: new Date().toISOString()
    };
    cache.set(cacheKey, result, POI_CACHE_TTL_MS);
    return result;
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
          try {
            legs.push(await this.planTransitRoute(current, dest, city, signal));
          } catch (transitError) {
            const walking = await this.planWalkingRoute(current, dest, signal);
            legs.push({
              ...walking,
              fallbackReason: "公交或地铁未返回可用方案，已改用步行路径"
            });
            console.warn(`[MapTool] transit route unavailable; walking fallback used: ${transitError}`);
          }
        } else if (mode === "walk") {
          legs.push(await this.planWalkingRoute(current, dest, signal));
        } else {
          const walk = await this.planWalkingRoute(current, dest, signal);
          if (walk.durationMinutes > 45 || walk.distanceMeters > 3000) {
            try {
              legs.push(await this.planTransitRoute(current, dest, city, signal));
            } catch (transitError) {
              legs.push({
                ...walk,
                fallbackReason: "公交或地铁未返回可用方案，已保留可用的步行路径"
              });
              console.warn(`[MapTool] transit route unavailable; valid walking route retained: ${transitError}`);
            }
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
    const metrics = this.requireRouteMetrics(path?.distance, path?.duration, "bicycling");
    return {
      origin, destination,
      distanceMeters: metrics.distanceMeters,
      durationMinutes: metrics.durationMinutes,
      mode: "bicycling"
    };
  }

  async distanceMatrix(
    origins: string[], destination: string, type: "walk" | "bicycling" = "walk", signal?: AbortSignal
  ): Promise<DistanceMatrixItem[]> {
    if (origins.length === 0) return [];
    if (!env.AMAP_KEY) { console.warn("[MapTool] AMAP_KEY not set"); return []; }
    const data = await this.fetchAmap<{ results?: Array<{ origin_id?: string; distance?: string; duration?: string }> }>(
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
    const data = await this.fetchAmap<{ route?: { paths?: Array<{ distance?: string; duration?: string }> } }>(
      "/v3/direction/walking", { origin, destination }, 2, signal
    );
    const path = data.route?.paths?.[0];
    const metrics = this.requireRouteMetrics(path?.distance, path?.duration, "walking");
    return {
      origin, destination,
      distanceMeters: metrics.distanceMeters,
      durationMinutes: metrics.durationMinutes,
      mode: "walk"
    };
  }

  private async planTransitRoute(origin: string, destination: string, city: string, signal?: AbortSignal): Promise<RouteLeg> {
    const data = await this.fetchAmap<{ route?: { transits?: Array<{ distance?: string; duration?: string }> } }>(
      "/v3/direction/transit/integrated", { origin, destination, city, city1: city, strategy: "0" }, 2, signal
    );
    const transit = data.route?.transits?.[0];
    const metrics = this.requireRouteMetrics(transit?.distance, transit?.duration, "transit");
    return {
      origin, destination,
      distanceMeters: metrics.distanceMeters,
      durationMinutes: metrics.durationMinutes,
      mode: "transit"
    };
  }

  private requireRouteMetrics(
    distance: number | string | undefined,
    durationSeconds: number | string | undefined,
    mode: string
  ): Pick<RouteLeg, "distanceMeters" | "durationMinutes"> {
    const distanceMeters = Number(distance);
    const seconds = Number(durationSeconds);
    if (!Number.isFinite(distanceMeters) || !Number.isFinite(seconds) || distanceMeters <= 0 || seconds <= 0) {
      throw new Error(`AMap ${mode} response contains no usable route path`);
    }
    return {
      distanceMeters: Math.round(distanceMeters),
      durationMinutes: Math.max(1, Math.round(seconds / 60))
    };
  }

  // ── API helpers ──

  private async fetchPoi(path: string, query: Record<string, string>, keyword: string, signal?: AbortSignal): Promise<Poi[]> {
    const cacheKey = `amap-poi:${createHash("sha256").update(`${path}:${JSON.stringify(query)}`).digest("hex")}`;
    const cached = cache.get<Poi[]>(cacheKey);
    if (cached) return cached;
    const data = await this.fetchAmap<{ pois?: AmapPoi[] }>(path, query, 2, signal);
    const pois = (data.pois ?? []).map(item => this.normalizePoi(item, keyword));
    cache.set(cacheKey, pois, POI_CACHE_TTL_MS);
    return pois;
  }

  private normalizePoi(item: AmapPoi, keyword: string): Poi {
    const descriptor = `${item.name ?? ""};${item.type ?? ""};${item.business?.tag ?? ""};${keyword}`;
    const category = inferPoiCategory(descriptor);
    const rating = Number(item.business?.rating ?? item.biz_ext?.rating ?? item.rating ?? 0);
    const typeTags = String(item.type ?? "").split(/[;|,，]/u).map((tag) => tag.trim()).filter(Boolean);
    const businessTags = String(item.business?.tag ?? "").split(/[;|,，]/u).map((tag) => tag.trim()).filter(Boolean);
    const subtype = typeTags.at(-1) || undefined;
    const explicitIndoor = item.indoor_data?.indoor_map === "1";
    return {
      id: item.id,
      name: String(item.name ?? keyword),
      category,
      kind: inferPoiKind(category),
      subtype,
      amapTypeCode: item.typecode,
      averageCost: Number(item.business?.cost ?? item.biz_ext?.cost ?? 0),
      location: item.location,
      address: item.address,
      city: typeof item.cityname === "string" && item.cityname.trim() ? item.cityname.trim() : undefined,
      rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
      distanceMeters: Number(item.distance ?? 0),
      indoor: explicitIndoor || this.isIndoorCategory(category),
      tags: [...new Set([...typeTags, ...businessTags])].slice(0, 16),
      discoverySource: "amap",
      verificationStatus: "verified"
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
    return pois.filter((poi) => {
      const key = poi.id || `${this.normalizePlaceName(poi.name)}@${poi.location ?? poi.address ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private isIndoorCategory(category: PoiCategory): boolean {
    return ["bookstore", "cafe", "museum", "mall", "restaurant", "shop", "studio"].includes(category);
  }

  private normalizePlaceName(value: string): string {
    return value.toLocaleLowerCase("zh-CN")
      .replace(/[（(][^）)]*[）)]/gu, "")
      .replace(/(?:旗舰店|总店|分店|门店|店)$/gu, "")
      .replace(/[\s\p{P}\p{S}]/gu, "");
  }

  private placeNameSimilarity(left: string, right: string): number {
    const a = this.normalizePlaceName(left);
    const b = this.normalizePlaceName(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))) return 0.82;
    const grams = (value: string) => new Set(Array.from(value).slice(0, -1).map((char, index) => char + Array.from(value)[index + 1]));
    const leftGrams = grams(a);
    const rightGrams = grams(b);
    if (!leftGrams.size || !rightGrams.size) return 0;
    const intersection = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
    return (2 * intersection) / (leftGrams.size + rightGrams.size);
  }

  private async fetchAmap<T>(path: string, query: Record<string, string>, retries = 2, signal?: AbortSignal): Promise<T> {
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
