import { env } from "../config/env";
import { PoiCategory } from "../types/plan";

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

export interface RouteLeg {
  origin: string;
  destination: string;
  distanceMeters: number;
  durationMinutes: number;
  mode: "walk" | "transit";
}

export class MapTool {
  async geocode(address: string, city: string): Promise<string | undefined> {
    if (!env.AMAP_KEY) {
      return this.mockLocationFor(address);
    }

    const data = await this.fetchWithRetry<{ geocodes?: Array<{ location?: string }> }>(
      "https://restapi.amap.com/v3/geocode/geo",
      {
        key: env.AMAP_KEY,
        address,
        city
      }
    );

    return data.geocodes?.[0]?.location ?? this.mockLocationFor(address);
  }

  async searchNearbyPoi(
    keywords: string[],
    options: {
      city: string;
      location?: string;
      indoorOnly?: boolean;
      radius?: number;
    }
  ): Promise<Poi[]> {
    const normalizedKeywords = keywords.length > 0 ? keywords : ["书店", "咖啡", "博物馆"];
    if (!env.AMAP_KEY) {
      return this.filterMockPois(normalizedKeywords, options.indoorOnly);
    }

    const requests = normalizedKeywords.map((keyword) =>
      this.fetchPoiByKeyword(keyword, options.city, options.location, options.radius)
    );
    const results = (await Promise.allSettled(requests))
      .flatMap((item) => (item.status === "fulfilled" ? item.value : []))
      .filter((poi) => !options.indoorOnly || poi.indoor);

    return this.dedupePois(results.length > 0 ? results : this.filterMockPois(normalizedKeywords, options.indoorOnly));
  }

  async planRoute(
    origin: string,
    destinations: string[],
    mode: "walk" | "transit" | "mixed"
  ): Promise<RouteLeg[]> {
    if (destinations.length === 0) {
      return [];
    }

    if (!env.AMAP_KEY || mode === "mixed") {
      return this.mockRoute(origin, destinations, mode === "transit" ? "transit" : "walk");
    }

    const legs: RouteLeg[] = [];
    let current = origin;
    for (const destination of destinations) {
      if (!current || !destination) {
        continue;
      }

      try {
        const endpoint =
          mode === "transit"
            ? "https://restapi.amap.com/v3/direction/transit/integrated"
            : "https://restapi.amap.com/v3/direction/walking";
        const data = await this.fetchWithRetry<Record<string, any>>(endpoint, {
          key: env.AMAP_KEY,
          origin: current,
          destination,
          city: "南京"
        });
        const distance = Number(data.route?.paths?.[0]?.distance ?? data.route?.transits?.[0]?.distance ?? 1200);
        const duration = Number(data.route?.paths?.[0]?.duration ?? data.route?.transits?.[0]?.duration ?? 1200);
        legs.push({
          origin: current,
          destination,
          distanceMeters: distance,
          durationMinutes: Math.max(1, Math.round(duration / 60)),
          mode
        });
      } catch {
        legs.push(...this.mockRoute(current, [destination], mode));
      }

      current = destination;
    }

    return legs;
  }

  private async fetchPoiByKeyword(
    keyword: string,
    city: string,
    location?: string,
    radius = 3000
  ): Promise<Poi[]> {
    const endpoint = location
      ? "https://restapi.amap.com/v3/place/around"
      : "https://restapi.amap.com/v3/place/text";
    const data = await this.fetchWithRetry<{ pois?: Array<Record<string, any>> }>(endpoint, {
      key: env.AMAP_KEY ?? "",
      keywords: keyword,
      city,
      location: location ?? "",
      radius: String(radius),
      offset: "10",
      extensions: "all"
    });

    return (data.pois ?? []).map((item) => {
      const category = this.inferCategory(`${item.name ?? ""}${item.type ?? ""}${keyword}`);
      return {
        name: String(item.name ?? keyword),
        category,
        averageCost: this.estimateCost(category, Number(item.biz_ext?.cost ?? 0)),
        location: typeof item.location === "string" ? item.location : undefined,
        address: typeof item.address === "string" ? item.address : undefined,
        rating: Number(item.biz_ext?.rating ?? 4.2),
        distanceMeters: Number(item.distance ?? 0),
        indoor: this.isIndoorCategory(category)
      };
    });
  }

  private async fetchWithRetry<T>(url: string, query: Record<string, string>, retries = 2): Promise<T> {
    const search = new URLSearchParams(
      Object.entries(query).filter(([, value]) => value !== "")
    );
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(`${url}?${search.toString()}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.json()) as T & { status?: string; info?: string };
        if (data.status === "0") {
          throw new Error(data.info ?? "AMap API failed");
        }
        return data;
      } catch (error) {
        lastError = error;
        await this.delay(300 * 2 ** attempt);
      }
    }

    throw lastError;
  }

  private filterMockPois(keywords: string[], indoorOnly?: boolean): Poi[] {
    const candidates: Poi[] = [
      { name: "先锋书店", category: "bookstore", averageCost: 30, location: "118.769,32.047", rating: 4.8, indoor: true },
      { name: "北岸咖啡", category: "cafe", averageCost: 28, location: "118.783,32.060", rating: 4.5, indoor: true },
      { name: "南京市博物馆", category: "museum", averageCost: 0, location: "118.789,32.042", rating: 4.6, indoor: true },
      { name: "德基广场", category: "mall", averageCost: 45, location: "118.784,32.044", rating: 4.7, indoor: true },
      { name: "颐和路街区", category: "sight", averageCost: 0, location: "118.764,32.063", rating: 4.4, indoor: false },
      { name: "玄武湖公园", category: "park", averageCost: 0, location: "118.795,32.070", rating: 4.6, indoor: false },
      { name: "南京大牌档", category: "restaurant", averageCost: 65, location: "118.784,32.047", rating: 4.3, indoor: true }
    ];

    const matched = candidates.filter((item) => {
      const hit = keywords.some((keyword) => item.name.includes(keyword) || this.keywordMatchesCategory(keyword, item.category));
      return hit && (!indoorOnly || item.indoor);
    });

    return matched.length > 0 ? matched : candidates.filter((item) => !indoorOnly || item.indoor);
  }

  private mockRoute(origin: string, destinations: string[], mode: "walk" | "transit"): RouteLeg[] {
    return destinations.map((destination, index) => ({
      origin: index === 0 ? origin : destinations[index - 1],
      destination,
      distanceMeters: 800 + index * 350,
      durationMinutes: mode === "transit" ? 12 + index * 4 : 14 + index * 6,
      mode
    }));
  }

  private dedupePois(pois: Poi[]): Poi[] {
    const seen = new Set<string>();
    return pois.filter((poi) => {
      if (seen.has(poi.name)) {
        return false;
      }
      seen.add(poi.name);
      return true;
    });
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

  private estimateCost(category: PoiCategory, apiCost: number): number {
    if (apiCost > 0) return apiCost;
    const defaults: Record<PoiCategory, number> = {
      bookstore: 25,
      cafe: 30,
      sight: 0,
      museum: 0,
      mall: 45,
      park: 0,
      restaurant: 60
    };
    return defaults[category];
  }

  private keywordMatchesCategory(keyword: string, category: PoiCategory): boolean {
    const aliases: Record<PoiCategory, string[]> = {
      bookstore: ["书店", "书局", "阅读"],
      cafe: ["咖啡", "下午茶"],
      sight: ["景点", "街区", "CityWalk", "拍照"],
      museum: ["博物馆", "美术馆", "展览"],
      mall: ["商场", "购物", "室内"],
      park: ["公园", "湖", "户外"],
      restaurant: ["餐厅", "美食", "吃饭"]
    };
    return aliases[category].some((alias) => keyword.includes(alias) || alias.includes(keyword));
  }

  private isIndoorCategory(category: PoiCategory): boolean {
    return ["bookstore", "cafe", "museum", "mall", "restaurant"].includes(category);
  }

  private mockLocationFor(address: string): string {
    if (address.includes("新街口")) return "118.784,32.044";
    if (address.includes("南京")) return "118.796,32.060";
    return "118.784,32.044";
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
