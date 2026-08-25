import assert from "node:assert/strict";
import type { RouteLeg, RouteStop } from "../src/types/plan";
import type { Poi } from "../src/tools/mapTool";
import type { WeatherContext, WeatherQuery } from "../src/tools/weatherTool";

for (const key of [
  "AMAP_KEY", "TAVILY_API_KEY", "QWEATHER_KEY", "HEFENG_KEY", "DS_", "DEEPSEEK_API_KEY",
  "DEEPSEEK_FLASH_API_KEY", "DEEPSEEK_PRO_API_KEY", "EMBEDDING_API_KEY"
]) process.env[key] = "";

async function main() {
  const temporal = await import("../src/services/temporalService");
  const fixedNow = new Date("2026-08-11T02:00:00Z"); // Asia/Shanghai Tuesday 10:00

  const exact = temporal.resolveTravelTemporal(temporal.parseTravelTemporal("本周六下午三点出发", fixedNow));
  assert.equal(exact.visitDate, "2026-08-15");
  assert.equal(exact.startTime, "15:00");
  assert.equal(exact.departureAt, "2026-08-15T15:00:00+08:00");
  assert.equal(exact.precision, "exact");

  const nextWeek = temporal.resolveTravelTemporal(temporal.parseTravelTemporal("下周一下午去", fixedNow));
  assert.equal(nextWeek.visitDate, "2026-08-17", "下周必须按下一个自然周计算");
  assert.equal(nextWeek.startTime, "14:00");
  assert.equal(nextWeek.precision, "period");
  assert.equal(nextWeek.inferred, true);

  const dateOnly = temporal.resolveTravelTemporal(temporal.parseTravelTemporal("明天去南京", fixedNow));
  assert.equal(dateOnly.visitDate, "2026-08-12");
  assert.equal(dateOnly.departureAt, undefined);
  assert.equal(dateOnly.precision, "date_only");
  const timeOnly = temporal.resolveTravelTemporal(temporal.parseTravelTemporal("下午三点出发", fixedNow));
  assert.equal(timeOnly.visitDate, "2026-08-11");
  assert.equal(timeOnly.inferred, true, "只说时刻时必须披露日期按今天推断");
  const editedPeriod = temporal.resolveTravelTemporal(
    temporal.parseTravelTemporal("改成晚上", fixedNow),
    exact
  );
  assert.equal(editedPeriod.visitDate, "2026-08-15", "只修改时段时应继承原路线日期");
  assert.equal(editedPeriod.startTime, "18:00", "新时段必须替换旧时刻，而不是保留下午三点");

  const unspecified = temporal.resolveTravelTemporal(temporal.parseTravelTemporal("南京安排一条路线", fixedNow));
  assert.equal(unspecified.precision, "unspecified");
  assert.equal(unspecified.departureAt, undefined, "未指定时间不能默认成请求时刻");
  assert.equal(
    temporal.resolveTravelTemporal(temporal.parseTravelTemporal("两个点之间少走一点", fixedNow)).precision,
    "unspecified",
    "地点数量和‘一点’程度副词不能被误识别成凌晨时间"
  );

  const stops: RouteStop[] = [
    { name: "第一站", category: "bookstore", estimatedCost: 0, estimatedStayMinutes: 30, reason: "test", location: "1,1" },
    { name: "第二站", category: "cafe", estimatedCost: 20, estimatedStayMinutes: 40, reason: "test", location: "2,2" }
  ];
  const legs: RouteLeg[] = [
    { origin: "0,0", destination: "1,1", destinationName: "第一站", distanceMeters: 600, durationMinutes: 10, mode: "walk" },
    { origin: "1,1", destination: "2,2", destinationName: "第二站", distanceMeters: 800, durationMinutes: 12, mode: "walk" }
  ];
  const scheduled = temporal.scheduleRouteByDeparture(stops, legs, exact);
  assert.equal(scheduled.stops[0].estimatedArrivalAt, "2026-08-15T15:10:00+08:00");
  assert.equal(scheduled.stops[0].estimatedDepartureAt, "2026-08-15T15:40:00+08:00");
  assert.equal(scheduled.stops[1].estimatedArrivalAt, "2026-08-15T15:52:00+08:00");
  assert.equal(scheduled.endAt, "2026-08-15T16:32:00+08:00");

  const [{ MapTool }, { WeatherTool }, { UrbanPulseAgent }, { historyStore }, { env }] = await Promise.all([
    import("../src/tools/mapTool"),
    import("../src/tools/weatherTool"),
    import("../src/agents/urbanPulseAgent"),
    import("../src/services/historyStore"),
    import("../src/config/env")
  ]);

  // Exercise the real WeatherTool selection logic with provider calls stubbed:
  // only hours overlapping the trip may affect risk, and date-only trips use
  // the matching daily forecast instead of request-time weather.
  env.QWEATHER_KEY = "temporal-test-key";
  const providerWeather = new WeatherTool();
  let providerCalls = 0;
  const target = new Date(Date.now() + 2 * 3_600_000);
  const targetDate = new Date(target.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  const futureDate = new Date(Date.now() + 3 * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10);
  (providerWeather as unknown as { lookupLocation: () => Promise<string> }).lookupLocation = async () => "test-location";
  (providerWeather as unknown as { getAirQuality: () => Promise<undefined> }).getAirQuality = async () => undefined;
  (providerWeather as unknown as { fetchQWeather: (url: string) => Promise<unknown> }).fetchQWeather = async (url: string) => {
    providerCalls += 1;
    if (url.includes("weather/24h")) return {
      hourly: [
        { fxTime: target.toISOString(), pop: "80", precip: "1.2", text: "小雨", temp: "27" },
        { fxTime: new Date(target.getTime() + 3_600_000).toISOString(), pop: "20", precip: "0", text: "阴", temp: "26" }
      ]
    };
    if (url.includes("weather/7d")) return {
      daily: [{ fxDate: futureDate, textDay: "多云", textNight: "小雨", tempMin: "24", tempMax: "31", precip: "1" }]
    };
    if (url.includes("indices")) return { daily: [] };
    if (url.includes("warning")) return { warning: [] };
    return {};
  };
  const hourlyWeather = await providerWeather.getWeatherContext("时段天气测试", {
    departureAt: target.toISOString(), visitDate: targetDate, durationMinutes: 120, precision: "exact"
  });
  assert.equal(hourlyWeather.forecastKind, "hourly");
  assert.equal(hourlyWeather.rainProbability, 80);
  assert.equal(hourlyWeather.decisionUsable, true);
  const dailyWeather = await providerWeather.getWeatherContext("日期天气测试", {
    visitDate: futureDate, precision: "date_only"
  });
  assert.equal(dailyWeather.forecastKind, "daily");
  assert.equal(dailyWeather.targetDate, futureDate);
  assert.equal(dailyWeather.rainProbability, 70);
  const callsBeforeMissingTime = providerCalls;
  const missingTimeWeather = await providerWeather.getWeatherContext("无时间天气测试", {});
  assert.equal(missingTimeWeather.decisionUsable, false);
  assert.equal(providerCalls, callsBeforeMissingTime, "缺少出行时间时不应调用天气供应商");
  env.QWEATHER_KEY = undefined;

  const mapPois: Poi[] = [
    { name: "测试书店", category: "bookstore", averageCost: 0, location: "118.78,32.04", distanceMeters: 300, rating: 4.7 },
    { name: "测试咖啡", category: "cafe", averageCost: 30, location: "118.79,32.04", distanceMeters: 600, rating: 4.6 }
  ];
  class FakeMap extends MapTool {
    override async geocode(): Promise<string> { return "118.77,32.04"; }
    override async searchPoi(): Promise<Poi[]> { return mapPois; }
    override async searchNearbyPoi(): Promise<Poi[]> { return mapPois; }
    override async planRoute(origin: string, destinations: string[]) {
      return destinations.map((destination) => ({ origin, destination, distanceMeters: 600, durationMinutes: 10, mode: "walk" as const }));
    }
  }
  class CapturingWeather extends WeatherTool {
    queries: Array<WeatherQuery | undefined> = [];
    override async getWeatherContext(_city: string, query?: WeatherQuery | AbortSignal): Promise<WeatherContext> {
      const value = query && !("aborted" in query) ? query : undefined;
      this.queries.push(value);
      const usable = Boolean(value?.visitDate || value?.departureAt);
      return {
        rainProbability: usable ? 10 : 0,
        risk: "low",
        summary: usable ? "已匹配出行时段天气" : "未提供出行时间",
        decisionUsable: usable,
        forecastKind: usable ? "hourly" : "unavailable",
        targetDate: value?.visitDate,
        indices: []
      };
    }
  }

  const weather = new CapturingWeather();
  const agent = new UrbanPulseAgent(new FakeMap(), weather);
  const timed = await agent.plan({
    task: "南京新街口出发，安排两小时书店和咖啡路线",
    temporal: { visitDate: "2026-08-15", startTime: "15:00", timezone: "Asia/Shanghai" }
  });
  assert.equal(weather.queries.at(-1)?.departureAt, "2026-08-15T15:00:00+08:00");
  assert.equal(timed.constraints.temporal.departureAt, "2026-08-15T15:00:00+08:00");
  assert.ok(timed.stops.every((stop) => stop.estimatedArrivalAt && stop.estimatedDepartureAt));
  assert.equal(timed.routeOverview?.time.startAt, "2026-08-15T15:00:00+08:00");

  const noTime = await agent.plan({ task: "南京新街口出发，安排两小时书店路线" });
  assert.equal(weather.queries.at(-1)?.departureAt, undefined);
  assert.equal(weather.queries.at(-1)?.visitDate, undefined);
  assert.equal(noTime.constraints.temporal.precision, "unspecified");
  assert.equal(noTime.weatherRisk, undefined);
  assert.equal(noTime.routeOverview?.weather.risk, "unknown");
  assert.ok(noTime.stops.every((stop) => !stop.estimatedArrivalAt));

  const scope = { userId: "temporal-test-user", threadId: "temporal-test-thread" };
  const initialRequest = {
    task: "南京新街口出发，安排两小时路线",
    temporal: { visitDate: "2026-08-15", startTime: "15:00", timezone: "Asia/Shanghai" as const },
    ...scope
  };
  const initial = await agent.plan(initialRequest);
  historyStore.save(initialRequest, initial);
  const modified = await agent.plan({ task: "把这条路线改得轻松一点，其他不变", ...scope });
  assert.equal(modified.intent.intent, "route_modify");
  assert.equal(modified.constraints.temporal.departureAt, initial.constraints.temporal.departureAt,
    "路线修改必须继承原路线的绝对出行时间");

  console.log("PASS temporal planning: normalization / no silent now / weather anchor / route schedule / multi-turn inheritance");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
