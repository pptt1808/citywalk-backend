import { env } from "../config/env";
import { TravelTimePrecision } from "../types/plan";
import { cache } from "../utils/cache";
import { fetchJsonWithRetry } from "../utils/httpClient";

const WEATHER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface WeatherContext {
  rainProbability: number;
  risk: "low" | "medium" | "high";
  summary: string;
  /** Whether this forecast may affect route selection. */
  decisionUsable?: boolean;
  forecastKind?: "hourly" | "daily" | "unavailable";
  targetDate?: string;
  timeRange?: { start: string; end: string };
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

export interface WeatherQuery {
  departureAt?: string;
  visitDate?: string;
  durationMinutes?: number;
  timezone?: "Asia/Shanghai";
  precision?: TravelTimePrecision;
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
    return (await this.getWeatherContext(city, { departureAt: new Date().toISOString(), precision: "exact" }, signal)).rainProbability;
  }

  async getWeatherContext(city: string, signal?: AbortSignal): Promise<WeatherContext>;
  async getWeatherContext(city: string, query: WeatherQuery, signal?: AbortSignal): Promise<WeatherContext>;
  async getWeatherContext(
    city: string,
    queryOrSignal?: WeatherQuery | AbortSignal,
    maybeSignal?: AbortSignal
  ): Promise<WeatherContext> {
    const legacySignal = queryOrSignal && "aborted" in queryOrSignal ? queryOrSignal as AbortSignal : undefined;
    const query = legacySignal ? undefined : queryOrSignal as WeatherQuery | undefined;
    const signal = legacySignal ?? maybeSignal;
    if (!query?.departureAt && !query?.visitDate) {
      return this.unavailableWeather(city, "未提供出行日期与时间，未使用当前天气替代行程天气");
    }
    const departure = query.departureAt ? new Date(query.departureAt) : undefined;
    if (departure && !Number.isFinite(departure.getTime())) {
      return this.unavailableWeather(city, "出行时间格式无效，无法匹配天气预报", query.visitDate);
    }
    const targetDate = query.visitDate ?? this.shanghaiDate(departure!);
    const now = new Date();
    if (departure && departure.getTime() < now.getTime() - 60 * 60_000) {
      return this.unavailableWeather(city, "计划出发时刻已经过去，未使用当前天气替代", targetDate);
    }
    const cacheKey = `weather:${city}:${targetDate}:${query.departureAt?.slice(11, 13) ?? "day"}:${Math.ceil((query.durationMinutes ?? 180) / 60)}`;
    const cached = cache.get<WeatherContext>(cacheKey);
    if (cached) return cached;

    if (!env.QWEATHER_KEY) {
      console.warn("[WeatherTool] QWEATHER_KEY not set — weather data unavailable");
      return this.unavailableWeather(city, "天气服务未配置，无法查询出行时段天气", targetDate);
    }

    try {
      const locationId = await this.lookupLocation(city, signal);
      const deltaHours = departure ? (departure.getTime() - now.getTime()) / 3_600_000 : Number.POSITIVE_INFINITY;
      const result = departure && deltaHours >= -1 && deltaHours <= 24
        ? await this.getHourlyTripWeather(city, locationId, departure, query.durationMinutes ?? 180, targetDate, signal)
        : await this.getDailyTripWeather(city, locationId, targetDate, now, signal);
      cache.set(cacheKey, result, WEATHER_CACHE_TTL);
      return result;
    } catch (error) {
      if (signal?.aborted) throw error;
      return this.unavailableWeather(city, "没有获得该出行日期的可靠天气预报", targetDate);
    }
  }

  private async getHourlyTripWeather(
    city: string,
    locationId: string,
    departure: Date,
    durationMinutes: number,
    targetDate: string,
    signal?: AbortSignal
  ): Promise<WeatherContext> {
    type Hour = { fxTime?: string; pop?: string; precip?: string; text?: string; temp?: string };
    const nearNow = Math.abs(departure.getTime() - Date.now()) <= 6 * 3_600_000;
    const [hourly, warning, indices, airQuality] = await Promise.all([
      this.fetchQWeather<{ hourly?: Hour[] }>("https://devapi.qweather.com/v7/weather/24h", { location: locationId }, signal),
      this.fetchQWeather<{ warning?: Array<{ title?: string; level?: string; typeName?: string; text?: string }> }>(
        "https://devapi.qweather.com/v3/warning/now", { location: locationId }, signal
      ).catch((error) => {
        if (signal?.aborted) throw error;
        return { warning: [] };
      }),
      targetDate === this.shanghaiDate(new Date())
        ? this.fetchQWeather<{ daily?: Array<{ name?: string; category?: string; text?: string }> }>(
            "https://devapi.qweather.com/v7/indices/1d", { location: locationId, type: "1,5,8" }, signal
          ).catch((error) => {
            if (signal?.aborted) throw error;
            return { daily: [] };
          })
        : Promise.resolve({ daily: [] }),
      nearNow ? this.getAirQuality(locationId, signal).catch((error) => {
        if (signal?.aborted) throw error;
        return undefined;
      }) : Promise.resolve(undefined)
    ]);
    const start = departure.getTime();
    const end = start + Math.max(60, durationMinutes) * 60_000;
    let selected = (hourly.hourly ?? []).filter((item) => {
      const time = item.fxTime ? new Date(item.fxTime).getTime() : Number.NaN;
      return Number.isFinite(time) && time >= start - 30 * 60_000 && time <= end + 30 * 60_000;
    });
    if (!selected.length) {
      selected = (hourly.hourly ?? []).filter((item) => {
        const time = item.fxTime ? new Date(item.fxTime).getTime() : Number.NaN;
        return Number.isFinite(time) && Math.abs(time - start) <= 2 * 3_600_000;
      }).slice(0, 1);
    }
    if (!selected.length) return this.unavailableWeather(city, "逐小时预报尚未覆盖计划出发时段", targetDate);
    const popValues = selected.map((item) => Number(item.pop ?? 0)).filter(Number.isFinite);
    const precipitation = selected.map((item) => Number(item.precip ?? 0)).filter(Number.isFinite);
    const rainProbability = popValues.length
      ? Math.max(...popValues)
      : Math.min(95, precipitation.filter((value) => value > 0).length * 20);
    const activeWarning = warning.warning?.[0];
    const normalizedIndices = (indices.daily ?? []).map((item) => ({
      name: item.name ?? "生活指数", category: item.category ?? "未知", text: item.text ?? ""
    }));
    const risk = inferWeatherRisk(rainProbability, activeWarning?.level, airQuality?.aqi, normalizedIndices);
    const conditions = [...new Set(selected.map((item) => item.text).filter(Boolean))].slice(0, 3);
    const temperatures = selected.map((item) => Number(item.temp)).filter(Number.isFinite);
    const rangeStart = selected[0].fxTime ?? departure.toISOString();
    const rangeEnd = selected.at(-1)?.fxTime
      ? new Date(new Date(selected.at(-1)!.fxTime!).getTime() + 3_600_000).toISOString()
      : new Date(end).toISOString();
    const rainSummary = rainProbability >= 60 ? "降雨风险较高" : rainProbability >= 30 ? "可能有降雨" : "降雨风险较低";
    return {
      rainProbability,
      risk,
      summary: `${city} ${targetDate} 出行时段${conditions.length ? conditions.join("转") : "天气"}，${rainSummary}${temperatures.length ? `，约${Math.min(...temperatures)}–${Math.max(...temperatures)}℃` : ""}`,
      decisionUsable: true,
      forecastKind: "hourly",
      targetDate,
      timeRange: { start: rangeStart, end: rangeEnd },
      warning: activeWarning ? {
        title: activeWarning.title ?? "天气预警",
        level: activeWarning.level ?? "未知",
        type: activeWarning.typeName ?? "未知",
        text: activeWarning.text ?? ""
      } : undefined,
      indices: normalizedIndices,
      airQuality
    };
  }

  private async getDailyTripWeather(
    city: string,
    locationId: string,
    targetDate: string,
    now: Date,
    signal?: AbortSignal
  ): Promise<WeatherContext> {
    const today = this.shanghaiDate(now);
    const days = Math.round((new Date(`${targetDate}T00:00:00+08:00`).getTime() - new Date(`${today}T00:00:00+08:00`).getTime()) / 86_400_000);
    if (days < 0) return this.unavailableWeather(city, "出行日期已经过去，无法用于未来路线规划", targetDate);
    if (days > 6) return this.unavailableWeather(city, "出行日期超出当前七日天气预报范围", targetDate);
    type Day = { fxDate?: string; textDay?: string; textNight?: string; tempMin?: string; tempMax?: string; precip?: string };
    const data = await this.fetchQWeather<{ daily?: Day[] }>(
      "https://devapi.qweather.com/v7/weather/7d", { location: locationId }, signal
    );
    const day = data.daily?.find((item) => item.fxDate === targetDate);
    if (!day) return this.unavailableWeather(city, "天气预报暂未覆盖该出行日期", targetDate);
    const conditions = [...new Set([day.textDay, day.textNight].filter(Boolean))].join("转");
    const precipitation = Number(day.precip ?? 0);
    const rainProbability = /雨|雪|雷/u.test(conditions) ? (precipitation > 0 ? 70 : 50) : precipitation > 0 ? 40 : 10;
    return {
      rainProbability,
      risk: inferWeatherRisk(rainProbability),
      summary: `${city} ${targetDate} 预计${conditions || "天气情况待更新"}${day.tempMin || day.tempMax ? `，${day.tempMin ?? "?"}–${day.tempMax ?? "?"}℃` : ""}`,
      decisionUsable: true,
      forecastKind: "daily",
      targetDate,
      indices: []
    };
  }

  private unavailableWeather(city: string, reason: string, targetDate?: string): WeatherContext {
    return {
      rainProbability: 0,
      risk: "low",
      summary: `${city}${targetDate ? ` ${targetDate}` : ""}：${reason}`,
      decisionUsable: false,
      forecastKind: "unavailable",
      targetDate,
      indices: []
    };
  }

  private shanghaiDate(value: Date): string {
    return new Date(value.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
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
