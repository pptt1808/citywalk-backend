import assert from "node:assert/strict";
import type { InformationSource, WebDiscoveredPlace } from "../src/types/plan";
import type { Poi } from "../src/tools/mapTool";

for (const key of [
  "AMAP_KEY", "TAVILY_API_KEY", "QWEATHER_KEY", "HEFENG_KEY", "DS_", "DEEPSEEK_API_KEY",
  "DEEPSEEK_FLASH_API_KEY", "DEEPSEEK_PRO_API_KEY", "EMBEDDING_API_KEY"
]) process.env[key] = "";

async function main() {
  const [{ PlaceDiscoveryService }, { inferPoiCategory, inferPoiKind, MapTool }, { UrbanPulseAgent }, { WeatherTool }] = await Promise.all([
    import("../src/services/placeDiscoveryService"),
    import("../src/tools/mapTool"),
    import("../src/agents/urbanPulseAgent"),
    import("../src/tools/weatherTool")
  ]);

  assert.equal(inferPoiCategory("购物服务;专卖店;服装鞋帽皮具店;时差古着店"), "shop");
  assert.equal(inferPoiCategory("餐饮服务;甜品店;手作蛋糕"), "cafe");
  assert.equal(inferPoiCategory("生活服务;手作工作室"), "studio");
  assert.equal(inferPoiCategory("老城小巷建筑立面"), "street_scene");
  assert.equal(inferPoiKind("shop"), "business");

  const mapPois: Poi[] = [
    {
      id: "mall-1", name: "普通购物中心", category: "mall", kind: "business", subtype: "购物中心",
      averageCost: 80, location: "118.780000,32.040000", distanceMeters: 500, rating: 4.8,
      tags: ["商业综合体"], discoverySource: "amap", verificationStatus: "verified"
    }
  ];
  const resolvedShop: Poi = {
    id: "shop-1", name: "时差古着", category: "shop", kind: "business", subtype: "服装鞋帽皮具店",
    averageCost: 0, location: "118.781000,32.041000", distanceMeters: 700, rating: 4.4,
    tags: ["购物服务", "专卖店"], discoverySource: "amap", verificationStatus: "verified"
  };
  const source: InformationSource = {
    title: "南京旧城里的时差古着与独立唱片店",
    url: "https://example.com/nanjing-vintage",
    domain: "example.com",
    snippet: "时差古着是一家藏在社区街巷里的独立小店。",
    sourceType: "unverified",
    provider: "tavily",
    retrievedAt: new Date().toISOString()
  };
  const extracted: WebDiscoveredPlace = {
    name: "时差古着",
    subtype: "古着店",
    tags: ["独立小店", "社区街巷"],
    evidence: "来源明确称其为藏在社区街巷里的独立小店",
    sourceUrl: source.url,
    confidence: 0.86
  };
  const fakeMap = {
    async searchPoi() { return mapPois; },
    async searchNearbyPoi() { return mapPois; },
    async resolvePoiCandidate(name: string) { return name === "时差古着" ? resolvedShop : undefined; }
  };
  const fakeWeb = { available: true, async search() { return [source]; } };
  const fakeLlm = { async extractCityWalkPlaceCandidates() { return { data: [extracted] }; } };
  const discovery = await new PlaceDiscoveryService(fakeMap, fakeWeb, fakeLlm).discover({
    city: "南京",
    task: "从新街口出发找小众古着店和社区空间",
    keywords: ["古着店", "独立小店"],
    location: "118.778000,32.043000",
    radius: 5000,
    mode: "hidden_gems"
  });
  const shop = discovery.pois.find((poi) => poi.name === "时差古着");
  assert.equal(discovery.webMatchedCount, 1);
  assert.deepEqual(discovery.sources.map((item) => item.url), [source.url]);
  assert.equal(shop?.category, "shop");
  assert.equal(shop?.subtype, "古着店");
  assert.equal(shop?.discoverySource, "web");
  assert.equal(shop?.verificationStatus, "map_matched");
  assert.equal(shop?.discoveryConfidence, 0.86);
  assert.deepEqual(shop?.evidenceUrls, [source.url]);
  assert.ok(Boolean(shop?.location), "网页发现的候选没有高德坐标时不能进入路线池");
  assert.ok((shop?.cityWalkScore ?? 0) > (discovery.pois.find((poi) => poi.category === "mall")?.cityWalkScore ?? 1));

  const unmatched = await new PlaceDiscoveryService(
    { ...fakeMap, async resolvePoiCandidate() { return undefined; } },
    fakeWeb,
    { async extractCityWalkPlaceCandidates() { return { data: [{ ...extracted, name: "无法核验的小店" }] }; } }
  ).discover({ city: "南京", task: "找小众店", keywords: ["古着店"], mode: "hidden_gems" });
  assert.ok(unmatched.pois.every((poi) => poi.name !== "无法核验的小店"), "未通过地图匹配的网页地点不能成为路线点");

  const routeCandidates: Poi[] = [
    { ...resolvedShop, subtype: "公司", tags: ["公司企业", "古着"] },
    { name: "名创优品测试店", category: "shop", kind: "business", averageCost: 0, location: "118.782,32.042", tags: ["零售店", "全国连锁"], rating: 5 },
    { name: "梧桐街角", category: "street_scene", kind: "street_scene", averageCost: 0, location: "118.783,32.043", tags: ["城市街巷"], rating: 4.3 }
  ];
  class FakeMapTool extends MapTool {
    override async geocode(): Promise<string> { return "118.778,32.043"; }
    override async searchNearbyPoi(): Promise<Poi[]> { return routeCandidates; }
    override async searchPoi(): Promise<Poi[]> { return routeCandidates; }
    override async planRoute(origin: string, destinations: string[]) {
      return destinations.map((destination) => ({ origin, destination, distanceMeters: 500, durationMinutes: 8, mode: "walk" as const }));
    }
  }
  class FakeWeatherTool extends WeatherTool {
    override async getWeatherContext() { return { rainProbability: 0, risk: "low" as const, summary: "适合步行", indices: [] }; }
  }
  const route = await new UrbanPulseAgent(new FakeMapTool(), new FakeWeatherTool()).plan({
    task: "南京从新街口出发，2小时，找一家小众古着店和有城市肌理的街角",
    discoveryMode: "hidden_gems"
  });
  assert.ok(route.stops.some((stop) => stop.name === "时差古着"), "特色零售店不应再被专卖店规则误过滤");
  assert.ok(route.stops.every((stop) => !stop.name.includes("名创优品")), "普通连锁工具型零售仍应过滤");
  assert.equal(route.constraints.discoveryMode, "hidden_gems");

  console.log("PASS place discovery: open subtype / web evidence map-match / niche retail route selection");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
