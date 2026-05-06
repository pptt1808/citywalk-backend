import { env } from "../config/env";

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
}

export class WeatherTool {
  async getRainProbability(city = "南京"): Promise<number> {
    return (await this.getWeatherContext(city)).rainProbability;
  }

  async getWeatherContext(city: string): Promise<WeatherContext> {
    if (!env.QWEATHER_KEY) {
      return this.mockWeatherContext(city);
    }

    try {
      const locationId = await this.lookupLocation(city);
      const [hourly, warning, indices] = await Promise.all([
        this.fetchQWeather<{ hourly?: Array<{ precip?: string; text?: string }> }>(
          "https://devapi.qweather.com/v7/weather/24h",
          { location: locationId }
        ),
        this.fetchQWeather<{ warning?: Array<{ title?: string; level?: string; typeName?: string; text?: string }> }>(
          "https://devapi.qweather.com/v3/warning/now",
          { location: locationId }
        ).catch(() => ({ warning: [] })),
        this.fetchQWeather<{ daily?: Array<{ name?: string; category?: string; text?: string }> }>(
          "https://devapi.qweather.com/v7/indices/1d",
          { location: locationId, type: "1,5,8" }
        ).catch(() => ({ daily: [] }))
      ]);

      const precipitation = (hourly.hourly ?? [])
        .slice(0, 8)
        .map((item) => Number(item.precip ?? 0));
      const rainProbability = Math.min(95, Math.round(precipitation.filter((value) => value > 0).length * 12));
      const activeWarning = warning.warning?.[0];
      const risk = this.inferRisk(rainProbability, activeWarning?.level);

      return {
        rainProbability,
        risk,
        summary: `${city} 未来数小时${rainProbability >= 60 ? "降雨风险较高" : rainProbability >= 30 ? "可能有降雨" : "适合户外漫步"}`,
        warning: activeWarning
          ? {
              title: activeWarning.title ?? "天气预警",
              level: activeWarning.level ?? "未知",
              type: activeWarning.typeName ?? "未知",
              text: activeWarning.text ?? ""
            }
          : undefined,
        indices: (indices.daily ?? []).map((item) => ({
          name: item.name ?? "生活指数",
          category: item.category ?? "未知",
          text: item.text ?? ""
        }))
      };
    } catch {
      return this.mockWeatherContext(city);
    }
  }

  private async lookupLocation(city: string): Promise<string> {
    const data = await this.fetchQWeather<{ location?: Array<{ id?: string }> }>(
      "https://geoapi.qweather.com/v2/city/lookup",
      { location: city }
    );

    return data.location?.[0]?.id ?? "101190101";
  }

  private async fetchQWeather<T>(url: string, query: Record<string, string>): Promise<T> {
    const search = new URLSearchParams({
      ...query,
      key: env.QWEATHER_KEY ?? ""
    });
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`${url}?${search.toString()}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.json()) as T & { code?: string };
        if (data.code && data.code !== "200") {
          throw new Error(`QWeather code ${data.code}`);
        }
        return data;
      } catch (error) {
        lastError = error;
        await this.delay(300 * 2 ** attempt);
      }
    }

    throw lastError;
  }

  private inferRisk(rainProbability: number, warningLevel?: string): "low" | "medium" | "high" {
    if (warningLevel && /红|橙|黄/.test(warningLevel)) return "high";
    if (rainProbability >= 60) return "high";
    if (rainProbability >= 30) return "medium";
    return "low";
  }

  private mockWeatherContext(city: string): WeatherContext {
    return {
      rainProbability: 45,
      risk: "medium",
      summary: `${city} 未来有中等降雨可能，建议准备室内备选点位`,
      indices: [
        {
          name: "舒适度指数",
          category: "较舒适",
          text: "适合轻量城市漫步，建议关注短时降雨。"
        },
        {
          name: "运动指数",
          category: "较适宜",
          text: "适合步行，但长时间户外需预留休息点。"
        }
      ]
    };
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
