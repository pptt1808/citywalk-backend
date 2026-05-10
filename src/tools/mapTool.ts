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

  async geocode(address: string, city: string): Promise<string | undefined> {
    if (!env.AMAP_KEY) {
      return this.mockLocationFor(address, city);
    }

    try {
      const data = await this.fetchAmapV3<{ geocodes?: Array<{ location?: string }> }>("/v3/geocode/geo", {
        address,
        city
      });

      return data.geocodes?.[0]?.location ?? this.mockLocationFor(address, city);
    } catch {
      return this.mockLocationFor(address, city);
    }
  }

  async searchPoi(
    keywords: string[],
    options: {
      city: string;
      indoorOnly?: boolean;
      page?: number;
      offset?: number;
    }
  ): Promise<Poi[]> {
    const normalizedKeywords = this.normalizeKeywords(keywords);
    if (!env.AMAP_KEY) {
      return this.filterMockPois(normalizedKeywords, options.indoorOnly, options.city);
    }

    const requests = normalizedKeywords.map((keyword) =>
      this.fetchPoi("/v3/place/text", {
        keywords: keyword,
        city: options.city,
        extensions: "all",
        offset: String(options.offset ?? 10),
        page: String(options.page ?? 1)
      }, keyword)
    );

    const results = (await Promise.allSettled(requests))
      .flatMap((item) => (item.status === "fulfilled" ? item.value : []))
      .filter((poi) => !options.indoorOnly || poi.indoor);

    return this.dedupePois(results.length > 0 ? results : this.filterMockPois(normalizedKeywords, options.indoorOnly, options.city));
  }

  async searchNearbyPoi(
    keywords: string[],
    options: {
      city: string;
      location?: string;
      indoorOnly?: boolean;
      radius?: number;
      page?: number;
      offset?: number;
    }
  ): Promise<Poi[]> {
    const normalizedKeywords = this.normalizeKeywords(keywords);
    if (!options.location) {
      return this.searchPoi(normalizedKeywords, options);
    }
    if (!env.AMAP_KEY) {
      return this.filterMockPois(normalizedKeywords, options.indoorOnly, options.city);
    }

    const requests = normalizedKeywords.map((keyword) =>
      this.fetchPoi("/v3/place/around", {
        location: options.location ?? "",
        keywords: keyword,
        radius: String(options.radius ?? 2000),
        extensions: "all",
        offset: String(options.offset ?? 10),
        page: String(options.page ?? 1)
      }, keyword)
    );
    const results = (await Promise.allSettled(requests))
      .flatMap((item) => (item.status === "fulfilled" ? item.value : []))
      .filter((poi) => !options.indoorOnly || poi.indoor);

    return this.dedupePois(results.length > 0 ? results : this.filterMockPois(normalizedKeywords, options.indoorOnly, options.city));
  }

  async planRoute(
    origin: string,
    destinations: string[],
    mode: "walk" | "transit" | "mixed",
    city: string
  ): Promise<RouteLeg[]> {
    if (destinations.length === 0) {
      return [];
    }
    if (!env.AMAP_KEY) {
      return this.mockRoute(origin, destinations, mode === "transit" ? "transit" : "walk");
    }

    const legs: RouteLeg[] = [];
    let current = origin;
    for (const destination of destinations) {
      if (!current || !destination) {
        continue;
      }

      try {
        if (mode === "transit") {
          legs.push(await this.planTransitRoute(current, destination, city));
        } else if (mode === "walk") {
          legs.push(await this.planWalkingRoute(current, destination));
        } else {
          // "mixed": try walk first, switch to transit if too far
          const walkLeg = await this.planWalkingRoute(current, destination);
          if (walkLeg.durationMinutes > 45 || walkLeg.distanceMeters > 3000) {
            legs.push(await this.planTransitRoute(current, destination, city));
          } else {
            legs.push(walkLeg);
          }
        }
      } catch {
        legs.push(...this.mockRoute(current, [destination], mode === "transit" ? "transit" : "walk"));
      }

      current = destination;
    }

    return legs;
  }

  async planBicyclingRoute(origin: string, destination: string): Promise<RouteLeg> {
    if (!env.AMAP_KEY) {
      return this.mockRoute(origin, [destination], "bicycling")[0];
    }

    const data = await this.fetchAmapV4<{
      data?: { paths?: Array<{ distance?: number | string; duration?: number | string }> };
    }>("/v4/direction/bicycling", {
      origin,
      destination
    });
    const path = data.data?.paths?.[0];
    return {
      origin,
      destination,
      distanceMeters: Number(path?.distance ?? 1200),
      durationMinutes: Math.max(1, Math.round(Number(path?.duration ?? 900) / 60)),
      mode: "bicycling"
    };
  }

  async distanceMatrix(
    origins: string[],
    destination: string,
    type: "walk" | "bicycling" = "walk"
  ): Promise<DistanceMatrixItem[]> {
    if (origins.length === 0) {
      return [];
    }
    if (!env.AMAP_KEY) {
      return origins.map((origin, index) => ({
        origin,
        destination,
        distanceMeters: 900 + index * 250,
        durationMinutes: type === "bicycling" ? 6 + index * 2 : 12 + index * 3
      }));
    }

    const data = await this.fetchAmapV3<{
      results?: Array<{ origin_id?: string; distance?: string; duration?: string }>;
    }>("/v3/distance", {
      origins: origins.join("|"),
      destination,
      type: type === "bicycling" ? "3" : "1"
    });

    return (data.results ?? []).map((item, index) => ({
      origin: origins[Number(item.origin_id ?? index + 1) - 1] ?? origins[index],
      destination,
      distanceMeters: Number(item.distance ?? 0),
      durationMinutes: Math.max(1, Math.round(Number(item.duration ?? 0) / 60))
    }));
  }

  private async planWalkingRoute(origin: string, destination: string): Promise<RouteLeg> {
    const data = await this.fetchAmapV3<{
      route?: { paths?: Array<{ distance?: string; duration?: string }> };
    }>("/v3/direction/walking", {
      origin,
      destination
    });
    const path = data.route?.paths?.[0];
    return {
      origin,
      destination,
      distanceMeters: Number(path?.distance ?? 1200),
      durationMinutes: Math.max(1, Math.round(Number(path?.duration ?? 900) / 60)),
      mode: "walk"
    };
  }

  private async planTransitRoute(origin: string, destination: string, city: string): Promise<RouteLeg> {
    const data = await this.fetchAmapV3<{
      route?: { transits?: Array<{ distance?: string; duration?: string }> };
    }>("/v3/direction/transit/integrated", {
      origin,
      destination,
      city,
      city1: city,
      strategy: "0"  // 0 = 最快捷模式（地铁优先），5 = 不乘地铁
    });
    const transit = data.route?.transits?.[0];
    return {
      origin,
      destination,
      distanceMeters: Number(transit?.distance ?? 3000),
      durationMinutes: Math.max(1, Math.round(Number(transit?.duration ?? 1500) / 60)),
      mode: "transit"
    };
  }

  private async fetchPoi(path: string, query: Record<string, string>, keyword: string): Promise<Poi[]> {
    const data = await this.fetchAmapV3<{ pois?: AmapPoi[] }>(path, query);
    return (data.pois ?? []).map((item) => this.normalizePoi(item, keyword));
  }

  private normalizePoi(item: AmapPoi, keyword: string): Poi {
    const category = this.inferCategory(`${item.name ?? ""}${item.type ?? ""}${keyword}`);
    const rating = Number(item.biz_ext?.rating ?? item.rating ?? 4.2);
    return {
      name: String(item.name ?? keyword),
      category,
      averageCost: this.estimateCost(category, Number(item.biz_ext?.cost ?? 0)),
      location: item.location,
      address: item.address,
      rating: Number.isFinite(rating) ? rating : 4.2,
      distanceMeters: Number(item.distance ?? 0),
      indoor: this.isIndoorCategory(category)
    };
  }

  private async fetchAmapV3<T>(path: string, query: Record<string, string>, retries = 2): Promise<T> {
    const data = await this.fetchWithRetry<T & { status?: string; info?: string }>(
      `${this.amapBaseUrl}${path}`,
      { key: env.AMAP_KEY ?? "", ...query },
      retries
    );
    if (data.status === "0") {
      throw new Error(data.info ?? "AMap API failed");
    }
    return data;
  }

  private async fetchAmapV4<T>(path: string, query: Record<string, string>, retries = 2): Promise<T> {
    const data = await this.fetchWithRetry<T & { errcode?: number; errmsg?: string }>(
      `${this.amapBaseUrl}${path}`,
      { key: env.AMAP_KEY ?? "", ...query },
      retries
    );
    if (typeof data.errcode === "number" && data.errcode !== 0) {
      throw new Error(data.errmsg ?? "AMap v4 API failed");
    }
    return data;
  }

  private async fetchWithRetry<T>(url: string, query: Record<string, string>, retries = 2): Promise<T> {
    const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== ""));
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(`${url}?${search.toString()}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        await this.delay(300 * 2 ** attempt);
      }
    }

    throw lastError;
  }

  private filterMockPois(keywords: string[], indoorOnly?: boolean, city?: string): Poi[] {
    const candidates = this.cityMockPois(city ?? "南京");
    const matched = candidates.filter((item) => {
      const hit = keywords.some((keyword) => item.name.includes(keyword) || this.keywordMatchesCategory(keyword, item.category));
      return hit && (!indoorOnly || item.indoor);
    });

    return matched.length > 0 ? matched : candidates.filter((item) => !indoorOnly || item.indoor);
  }

  private cityMockPois(city: string): Poi[] {
    const center = this.cityCenter(city);
    const [clon, clat] = (center ?? "118.784,32.044").split(",").map(Number);

    const generic: Record<string, Poi[]> = {
      "南京": [
        { name: "先锋书店", category: "bookstore", averageCost: 30, rating: 4.8, indoor: true },
        { name: "北岸咖啡", category: "cafe", averageCost: 28, rating: 4.5, indoor: true },
        { name: "南京市博物馆", category: "museum", averageCost: 0, rating: 4.6, indoor: true },
        { name: "德基广场", category: "mall", averageCost: 45, rating: 4.7, indoor: true },
        { name: "颐和路街区", category: "sight", averageCost: 0, rating: 4.4, indoor: false },
        { name: "玄武湖公园", category: "park", averageCost: 0, rating: 4.6, indoor: false },
        { name: "南京大牌档", category: "restaurant", averageCost: 65, rating: 4.3, indoor: true },
        { name: "羊山公园", category: "park", averageCost: 0, rating: 4.3, indoor: false },
        { name: "仙林湖公园", category: "park", averageCost: 0, rating: 4.4, indoor: false },
        { name: "南大仙林图书馆", category: "bookstore", averageCost: 0, rating: 4.6, indoor: true },
        { name: "仙林金鹰", category: "mall", averageCost: 50, rating: 4.4, indoor: true },
        { name: "学则路美食街", category: "restaurant", averageCost: 40, rating: 4.2, indoor: true },
        { name: "万达茂", category: "mall", averageCost: 45, rating: 4.3, indoor: true },
        { name: "栖霞山", category: "sight", averageCost: 25, rating: 4.6, indoor: false },
        { name: "仙林大学城奶茶街", category: "cafe", averageCost: 20, rating: 4.1, indoor: true },
      ],
      "北京": [
        { name: "PageOne 书店", category: "bookstore", averageCost: 35, rating: 4.7, indoor: true },
        { name: "胡同咖啡", category: "cafe", averageCost: 32, rating: 4.4, indoor: true },
        { name: "中国国家博物馆", category: "museum", averageCost: 0, rating: 4.9, indoor: true },
        { name: "国贸商城", category: "mall", averageCost: 60, rating: 4.6, indoor: true },
        { name: "什刹海", category: "sight", averageCost: 0, rating: 4.5, indoor: false },
        { name: "朝阳公园", category: "park", averageCost: 0, rating: 4.5, indoor: false },
        { name: "四季民福", category: "restaurant", averageCost: 80, rating: 4.7, indoor: true }
      ],
      "上海": [
        { name: "钟书阁", category: "bookstore", averageCost: 30, rating: 4.6, indoor: true },
        { name: "Seesaw Coffee", category: "cafe", averageCost: 35, rating: 4.3, indoor: true },
        { name: "上海博物馆", category: "museum", averageCost: 0, rating: 4.8, indoor: true },
        { name: "新天地", category: "mall", averageCost: 50, rating: 4.6, indoor: true },
        { name: "外滩", category: "sight", averageCost: 0, rating: 4.8, indoor: false },
        { name: "世纪公园", category: "park", averageCost: 0, rating: 4.4, indoor: false },
        { name: "光明邨", category: "restaurant", averageCost: 70, rating: 4.2, indoor: true }
      ]
    };

    const cityPois = generic[city];
    if (cityPois) {
      return cityPois.map((poi) => ({
        ...poi,
        location: `${clon + (Math.random() - 0.5) * 0.04},${clat + (Math.random() - 0.5) * 0.04}`
      }));
    }

    // Generic fallback for unknown cities
    return [
      { name: `${city}书店`, category: "bookstore" as const, averageCost: 25, rating: 4.2, indoor: true },
      { name: `${city}咖啡`, category: "cafe" as const, averageCost: 28, rating: 4.1, indoor: true },
      { name: `${city}博物馆`, category: "museum" as const, averageCost: 0, rating: 4.5, indoor: true },
      { name: `${city}购物中心`, category: "mall" as const, averageCost: 40, rating: 4.3, indoor: true },
      { name: `${city}老街`, category: "sight" as const, averageCost: 0, rating: 4.2, indoor: false },
      { name: `${city}中心公园`, category: "park" as const, averageCost: 0, rating: 4.4, indoor: false },
      { name: `${city}本地餐厅`, category: "restaurant" as const, averageCost: 55, rating: 4.0, indoor: true }
    ].map((poi) => ({
      ...poi,
      location: `${clon + (Math.random() - 0.5) * 0.04},${clat + (Math.random() - 0.5) * 0.04}`
    }));
  }

  private normalizeKeywords(keywords: string[] | unknown): string[] {
    if (Array.isArray(keywords)) {
      const normalized = keywords.map((keyword) => String(keyword).trim()).filter(Boolean);
      return normalized.length > 0 ? normalized : ["书店", "咖啡", "博物馆", "公园", "景点", "美食", "奶茶"];
    }
    if (typeof keywords === "string" && keywords.trim()) {
      return keywords
        .split(/[、,，\s]+/)
        .map((keyword) => keyword.trim())
        .filter(Boolean);
    }
    return ["书店", "咖啡", "博物馆", "公园", "景点", "美食", "奶茶"];
  }

  private mockRoute(origin: string, destinations: string[], mode: "walk" | "transit" | "bicycling"): RouteLeg[] {
    return destinations.map((destination, index) => ({
      origin: index === 0 ? origin : destinations[index - 1],
      destination,
      distanceMeters: 800 + index * 350,
      durationMinutes: mode === "transit" ? 12 + index * 4 : mode === "bicycling" ? 6 + index * 3 : 14 + index * 6,
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

  private mockLocationFor(address: string, city?: string): string {
    if (address.includes("新街口")) return "118.784,32.044";
    const center = this.cityCenter(city ?? "南京");
    if (center) return center;
    return "118.784,32.044";
  }

  private cityCenter(city: string): string | undefined {
    const centers: Record<string, string> = {
      "南京": "118.796,32.060",
      "北京": "116.407,39.904",
      "上海": "121.473,31.230",
      "杭州": "120.155,30.274",
      "苏州": "120.595,31.299",
      "广州": "113.264,23.129",
      "深圳": "114.058,22.543",
      "成都": "104.066,30.573",
      "西安": "108.940,34.260",
      "武汉": "114.305,30.593",
      "重庆": "106.551,29.563",
      "天津": "117.190,39.125",
      "长沙": "112.939,28.228",
      "郑州": "113.625,34.747",
      "青岛": "120.383,36.067",
      "厦门": "118.089,24.480",
      "昆明": "102.833,24.881",
      "大连": "121.615,38.914",
      "宁波": "121.544,29.869",
      "无锡": "120.312,31.491",
      "合肥": "117.227,31.820",
      "福州": "119.296,26.074",
      "济南": "117.001,36.651",
      "沈阳": "123.464,41.678",
      "哈尔滨": "126.535,45.802",
      "长春": "125.324,43.887",
      "太原": "112.549,37.857",
      "南昌": "115.858,28.683",
      "南宁": "108.367,22.817",
      "贵阳": "106.630,26.647",
      "兰州": "103.834,36.061",
      "银川": "106.231,38.487",
      "海口": "110.199,20.044",
      "拉萨": "91.172,29.650",
      "乌鲁木齐": "87.617,43.793"
    };
    return centers[city];
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
