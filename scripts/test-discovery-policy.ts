import assert from "node:assert/strict";
import type { InformationSource, WebDiscoveredPlace } from "../src/types/plan";
import type { Poi } from "../src/tools/mapTool";

for (const key of [
  "AMAP_KEY", "TAVILY_API_KEY", "QWEATHER_KEY", "HEFENG_KEY", "DS_", "DEEPSEEK_API_KEY",
  "DEEPSEEK_FLASH_API_KEY", "DEEPSEEK_PRO_API_KEY", "EMBEDDING_API_KEY"
]) process.env[key] = "";

async function main() {
  const policyModule = await import("../src/services/discoveryPolicyService");
  const {
    compileDiscoveryPolicySignals,
    deriveDiscoveryMode,
    discoveryPolicyFromMode,
    mergeDiscoveryPolicies
  } = policyModule;

  const globalAvoidance = mergeDiscoveryPolicies(
    compileDiscoveryPolicySignals("在上海安排一条三小时路线，避开网红地点")
  );
  assert.equal(globalAvoidance.avoidOverexposed, true);
  assert.deepEqual(globalAvoidance.exposureScopes, ["all"]);
  assert.equal(globalAvoidance.noveltyPreference, "long_tail");
  assert.equal(globalAvoidance.sourcePolicy, "web_assisted");
  assert.equal(deriveDiscoveryMode(globalAvoidance), "hidden_gems");

  const scopedAvoidance = mergeDiscoveryPolicies(
    compileDiscoveryPolicySignals("想看经典建筑，但餐饮别选网红店")
  );
  assert.equal(scopedAvoidance.avoidOverexposed, true);
  assert.deepEqual(scopedAvoidance.exposureScopes, ["restaurant"]);
  assert.equal(scopedAvoidance.noveltyPreference, "mainstream");
  assert.equal(scopedAvoidance.sourcePolicy, "web_assisted");
  assert.equal(deriveDiscoveryMode(scopedAvoidance), "balanced",
    "餐饮局部排除不能把经典建筑路线整体改成 hidden_gems");

  const mapVerifiedLongTail = mergeDiscoveryPolicies(
    { sourcePolicy: "map_only" },
    compileDiscoveryPolicySignals("小众冷门路线，优先独立小店")
  );
  assert.equal(mapVerifiedLongTail.sourcePolicy, "map_only");
  assert.equal(mapVerifiedLongTail.noveltyPreference, "long_tail");
  assert.equal(deriveDiscoveryMode(mapVerifiedLongTail), "hidden_gems",
    "legacy mode may summarize novelty while policy independently preserves map-only");

  const allowed = mergeDiscoveryPolicies(
    compileDiscoveryPolicySignals("网红店也可以，不介意热门打卡点")
  );
  assert.equal(allowed.avoidOverexposed, false);
  assert.equal(
    mergeDiscoveryPolicies(compileDiscoveryPolicySignals("这次不必避开网红，也可以去热门店")).avoidOverexposed,
    false,
    "明确取消曝光回避时不能被‘网红’关键词反向触发"
  );

  const [{ PlaceDiscoveryService }, { MapTool }, { WeatherTool }, { UrbanPulseAgent }, { historyStore }] = await Promise.all([
    import("../src/services/placeDiscoveryService"),
    import("../src/tools/mapTool"),
    import("../src/tools/weatherTool"),
    import("../src/agents/urbanPulseAgent"),
    import("../src/services/historyStore")
  ]);

  const mapPois: Poi[] = [
    {
      id: "restaurant-hot", name: "刷屏餐厅", category: "restaurant", averageCost: 80,
      location: "121.470,31.230", distanceMeters: 500, rating: 4.7,
      tags: ["网红打卡店"], discoverySource: "amap", verificationStatus: "verified"
    },
    {
      id: "sight-hot", name: "经典建筑", category: "sight", averageCost: 0,
      location: "121.471,31.231", distanceMeters: 500, rating: 4.7,
      tags: ["热门景区"], discoverySource: "amap", verificationStatus: "verified"
    }
  ];
  const source: InformationSource = {
    title: "测试来源", url: "https://example.com/place", domain: "example.com",
    sourceType: "unverified", verificationReason: "test", provider: "tavily",
    retrievedAt: new Date().toISOString()
  };
  const noCandidates: WebDiscoveredPlace[] = [];
  let webCalls = 0;
  const discovery = new PlaceDiscoveryService(
    {
      async searchPoi() { return mapPois; },
      async searchNearbyPoi() { return mapPois; },
      async resolvePoiCandidate() { return undefined; }
    },
    { available: true, async search() { webCalls += 1; return [source]; } },
    { async extractCityWalkPlaceCandidates() { return { data: noCandidates }; } }
  );
  const scopedResult = await discovery.discover({
    city: "上海",
    task: "想看经典建筑，但餐饮别选网红店",
    keywords: ["经典建筑", "餐饮"],
    mode: "balanced",
    policy: scopedAvoidance
  });
  assert.equal(webCalls, 1, "过度曝光回避需要启用公开证据发现");
  assert.ok(
    (scopedResult.pois.find((poi) => poi.id === "restaurant-hot")?.cityWalkScore ?? 1)
      < (scopedResult.pois.find((poi) => poi.id === "sight-hot")?.cityWalkScore ?? 0),
    "餐饮作用域不得惩罚同一路线中的经典建筑"
  );

  webCalls = 0;
  await discovery.discover({
    city: "上海",
    task: "只用高德找小众独立小店",
    keywords: ["独立小店"],
    mode: "hidden_gems",
    policy: mapVerifiedLongTail
  });
  assert.equal(webCalls, 0, "map_only 与 long_tail 必须可以同时成立");

  class FakeMapTool extends MapTool {
    override async geocode(): Promise<string> { return "121.469,31.229"; }
    override async searchNearbyPoi(): Promise<Poi[]> { return mapPois; }
    override async searchPoi(): Promise<Poi[]> { return mapPois; }
    override async planRoute(origin: string, destinations: string[]) {
      return destinations.map((destination) => ({
        origin, destination, distanceMeters: 500, durationMinutes: 8, mode: "walk" as const
      }));
    }
  }
  class FakeWeatherTool extends WeatherTool {
    override async getWeatherContext() {
      return { rainProbability: 0, risk: "low" as const, summary: "适合步行", indices: [] };
    }
  }

  const agent = new UrbanPulseAgent(new FakeMapTool(), new FakeWeatherTool());
  const mixed = await agent.plan({ task: "上海人民广场出发，2小时想看经典建筑，但餐饮别选网红店" });
  assert.equal(mixed.constraints.discoveryMode, "balanced");
  assert.equal(mixed.constraints.discoveryPolicy.noveltyPreference, "mainstream");
  assert.deepEqual(mixed.constraints.discoveryPolicy.exposureScopes, ["restaurant"]);

  const scope = { userId: "discovery-policy-user", threadId: "discovery-policy-thread" };
  const initialRequest = { task: "上海人民广场出发，安排2小时普通城市路线", ...scope };
  const initial = await agent.plan(initialRequest);
  historyStore.save(initialRequest, initial);
  const modified = await agent.plan({ task: "把刚才路线里的网红店换掉，其他不变", ...scope });
  assert.equal(modified.intent.intent, "route_modify");
  assert.equal(modified.constraints.discoveryPolicy.avoidOverexposed, true);
  assert.deepEqual(modified.constraints.discoveryPolicy.exposureScopes, ["all"]);
  assert.equal(modified.constraints.discoveryMode, "hidden_gems",
    "路线修改必须采用本轮明确的曝光回避策略，不能继续继承 balanced");

  console.log("PASS discovery policy: normalization / scoped exposure / source-novelty split / route modification");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
