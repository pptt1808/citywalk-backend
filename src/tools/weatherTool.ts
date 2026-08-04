import { env } from "../config/env";
import { cache } from "../utils/cache";
import { fetchJsonWithRetry } from "../utils/httpClient";

const WEATHER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface WeatherContext {
  rainProbability: number;
  risk: "low" | "medium" | "high";
  summary: string;
  warning?: {
    title: string;
    level: string;
    type: string;
    text: string;
  };
  indices: Array<{
    name: string;
    category: string;
    text: string;
  }>;
  minutely?: {
    summary: string;
    items: Array<{
      fxTime: string;
      precip: number;
      type: string;
    }>;
  };
  airQuality?: {
    aqi: number;
    category: string;
    primary: string;
  };
}

function isOutdoorIndexConcern(index: WeatherContext["indices"][number]): boolean {
  return /(?:较?不宜|很强|极强|非常不舒适|炎热|酷热|扬沙|浮尘)/u.test(`${index.category} ${index.text}`);
}

export function inferWeatherRisk(
  rainProbability: number,
  warningLevel?: string,
  aqi?: number,
  indices: WeatherContext["indices"] = []
): "low" | "medium" | "high" {
  if (warningLevel && /红|橙|黄/.test(warningLevel)) return "high";
  if (typeof aqi === "number" && aqi >= 150) return "high";
  if (rainProbability >= 60) return "high";
  if (typeof aqi === "number" && aqi >= 100) return "medium";
  if (rainProbability >= 30) return "medium";
  if (indices.some(isOutdoorIndexConcern)) return "medium";
  return "low";
}

export class WeatherTool {
  async getRainProbability(city = "", signal?: AbortSignal): Promise<number> {
    if (!city.trim()) return 0;
    return (await this.getWeatherContext(city, signal)).rainProbability;
  }

  async getWeatherContext(city: string, signal?: AbortSignal): Promise<WeatherContext> {
    const cacheKey = `weather:${city}`;
    const cached = cache.get<WeatherContext>(cacheKey);
    if (cached) return cached;

    if (!env.QWEATHER_KEY) {
      console.warn("[WeatherTool] QWEATHER_KEY not set — weather data unavailable");
      return { rainProbability: 0, risk: "low", summary: `${city} 天气数据不可用`, indices: [] };
    }

    try {
      const locationId = await this.lookupLocation(city, signal);
      const [hourly, warning, indices, airQuality] = await Promise.all([
        this.fetchQWeather<{ hourly?: Array<{ pop?: string; precip?: string; text?: string }> }>(
          "https://devapi.qweather.com/v7/weather/24h",
          { location: locationId }, signal
        ),
        this.fetchQWeather<{ warning?: Array<{ title?: string; level?: string; typeName?: string; text?: string }> }>(
          "https://devapi.qweather.com/v3/warning/now",
          { location: locationId }, signal
        ).catch((error) => {
          if (signal?.aborted) throw error;
          return { warning: [] };
        }),
        this.fetchQWeather<{ daily?: Array<{ name?: string; category?: string; text?: string }> }>(
          "https://devapi.qweather.com/v7/indices/1d",
          { location: locationId, type: "1,5,8" }, signal
        ).catch((error) => {
          if (signal?.aborted) throw error;
          return { daily: [] };
        }),
        this.getAirQuality(locationId, signal).catch((error) => {
          if (signal?.aborted) throw error;
          return undefined;
        })
      ]);

      const forecastHours = (hourly.hourly ?? []).slice(0, 8);
      const popValues = forecastHours.map((item) => Number(item.pop ?? 0)).filter(Number.isFinite);
      const precipitation = forecastHours.map((item) => Number(item.precip ?? 0));
      const rainProbability =
        popValues.length > 0
          ? Math.max(...popValues)
          : Math.min(95, Math.round(precipitation.filter((value) => value > 0).length * 12));
      const activeWarning = warning.warning?.[0];
      const normalizedIndices = (indices.daily ?? []).map((item) => ({
        name: item.name ?? "生活指数",
        category: item.category ?? "未知",
        text: item.text ?? ""
      }));
      const risk = inferWeatherRisk(rainProbability, activeWarning?.level, airQuality?.aqi, normalizedIndices);
      const outdoorConcerns = normalizedIndices.filter(isOutdoorIndexConcern).slice(0, 2);
      const rainSummary = rainProbability >= 60
        ? "降雨风险较高"
        : rainProbability >= 30 ? "可能有降雨" : "降雨风险较低";
      const summary = outdoorConcerns.length > 0
        ? `${city} 未来数小时${rainSummary}；${outdoorConcerns.map((item) => `${item.name}${item.category}`).join("、")}，户外需做好防护`
        : `${city} 未来数小时${rainProbability >= 30 ? rainSummary : "适合户外漫步"}`;

      const result: WeatherContext = {
        rainProbability,
        risk,
        summary,
        warning: activeWarning
          ? {
              title: activeWarning.title ?? "天气预警",
              level: activeWarning.level ?? "未知",
              type: activeWarning.typeName ?? "未知",
              text: activeWarning.text ?? ""
            }
          : undefined,
        indices: normalizedIndices,
        airQuality
      };
      cache.set(cacheKey, result, WEATHER_CACHE_TTL);
      return result;
    } catch (error) {
      if (signal?.aborted) throw error;
      return { rainProbability: 0, risk: "low", summary: `${city} 天气数据不可用`, indices: [] };
    }
  }

  async getMinutelyPrecipitation(location: string, signal?: AbortSignal): Promise<WeatherContext["minutely"]> {
    if (!env.QWEATHER_KEY) {
      return {
        summary: "未来两小时可能有零星降水（mock）",
        items: []
      };
    }

    const data = await this.fetchQWeather<{
      summary?: string;
      minutely?: Array<{ fxTime?: string; precip?: string; type?: string }>;
    }>("https://devapi.qweather.com/v7/minutely/5m", {
      location: this.toQWeatherLonLat(location)
    }, signal);

    return {
      summary: data.summary ?? "暂无分钟级降水摘要",
      items: (data.minutely ?? []).map((item) => ({
        fxTime: item.fxTime ?? "",
        precip: Number(item.precip ?? 0),
        type: item.type ?? "rain"
      }))
    };
  }

  async getWeatherWarning(locationIdOrCity: string, signal?: AbortSignal): Promise<WeatherContext["warning"] | undefined> {
    if (!env.QWEATHER_KEY) {
      return undefined;
    }

    const location = /^\d+$/.test(locationIdOrCity) ? locationIdOrCity : await this.lookupLocation(locationIdOrCity, signal);
    const data = await this.fetchQWeather<{
      warning?: Array<{ title?: string; level?: string; typeName?: string; text?: string }>;
    }>("https://devapi.qweather.com/v3/warning/now", { location }, signal);
    const warning = data.warning?.[0];
    return warning
      ? {
          title: warning.title ?? "天气预警",
          level: warning.level ?? "未知",
          type: warning.typeName ?? "未知",
          text: warning.text ?? ""
        }
      : undefined;
  }

  async getWeatherIndices(locationIdOrCity: string, type = "1,5,8", signal?: AbortSignal): Promise<WeatherContext["indices"]> {
    if (!env.QWEATHER_KEY) {
      console.warn("[WeatherTool] QWEATHER_KEY not set — weather indices unavailable");
      return [];
    }

    const location = /^\d+$/.test(locationIdOrCity) ? locationIdOrCity : await this.lookupLocation(locationIdOrCity, signal);
    const data = await this.fetchQWeather<{ daily?: Array<{ name?: string; category?: string; text?: string }> }>(
      "https://devapi.qweather.com/v7/indices/1d",
      { location, type }, signal
    );
    return (data.daily ?? []).map((item) => ({
      name: item.name ?? "生活指数",
      category: item.category ?? "未知",
      text: item.text ?? ""
    }));
  }

  async getAirQuality(locationIdOrCity: string, signal?: AbortSignal): Promise<NonNullable<WeatherContext["airQuality"]> | undefined> {
    if (!env.QWEATHER_KEY) {
      console.warn("[WeatherTool] QWEATHER_KEY not set — air quality unavailable");
      return undefined;
    }

    const location = /^\d+$/.test(locationIdOrCity) ? locationIdOrCity : await this.lookupLocation(locationIdOrCity, signal);
    const data = await this.fetchQWeather<{
      now?: { aqi?: string; category?: string; primary?: string };
    }>("https://devapi.qweather.com/v7/air/now", { location }, signal);

    if (!data.now) {
      return undefined;
    }
    return {
      aqi: Number(data.now.aqi ?? 0),
      category: data.now.category ?? "未知",
      primary: data.now.primary ?? "NA"
    };
  }

  private async lookupLocation(city: string, signal?: AbortSignal): Promise<string> {
    const data = await this.fetchQWeather<{ location?: Array<{ id?: string }> }>(
      "https://geoapi.qweather.com/v2/city/lookup",
      { location: city }, signal
    );

    return data.location?.[0]?.id ?? "101190101";
  }

  private async fetchQWeather<T>(url: string, query: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const hasDedicatedHost = Boolean(env.QWEATHER_API_HOST);
    const parsedUrl = new URL(url);
    const path = parsedUrl.hostname.startsWith("geoapi.")
      ? `/geo${parsedUrl.pathname}`
      : parsedUrl.pathname;
    const endpoint = hasDedicatedHost
      ? `https://${env.QWEATHER_API_HOST!.replace(/^https?:\/\//, "").replace(/\/$/, "")}${path}`
      : url;
    const search = new URLSearchParams(query);
    if (!hasDedicatedHost) search.set("key", env.QWEATHER_KEY ?? "");
    const data = await fetchJsonWithRetry<T & { code?: string }>(`${endpoint}?${search.toString()}`, {
      headers: hasDedicatedHost ? { "X-QW-Api-Key": env.QWEATHER_KEY ?? "" } : undefined
    }, {
      retries: 2,
      timeoutMs: env.EXTERNAL_API_TIMEOUT_MS,
      signal
    });
    if (data.code && data.code !== "200") throw new Error(`QWeather code ${data.code}`);
    return data;
  }

  private toQWeatherLonLat(location: string): string {
    const [lon, lat] = location.split(",");
    if (!lon || !lat) {
      return location;
    }
    return `${Number(lon).toFixed(2)},${Number(lat).toFixed(2)}`;
  }

}
