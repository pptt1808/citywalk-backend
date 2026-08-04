import assert from "node:assert/strict";

for (const key of [
  "AMAP_KEY", "QWEATHER_KEY", "HEFENG_KEY", "DS_", "DEEPSEEK_API_KEY",
  "DEEPSEEK_FLASH_API_KEY", "DEEPSEEK_PRO_API_KEY", "DEEPSEEK_V3_API_KEY",
  "DSV4PRO_API_KEY", "EMBEDDING_API_KEY"
]) process.env[key] = "";

async function main() {
  const [{ UrbanPulseAgent }, { MapTool }, { WeatherTool, inferWeatherRisk }, { favoriteStore }, { historyStore }, { buildEvaluationTrace }, { extractRouteRemovalTarget }] = await Promise.all([
    import("../src/agents/urbanPulseAgent"),
    import("../src/tools/mapTool"),
    import("../src/tools/weatherTool"),
    import("../src/services/favoriteStore"),
    import("../src/services/historyStore"),
    import("../src/services/evaluationTraceService"),
    import("../src/graph/citywalkGraph")
  ]);

  assert.equal(
    extractRouteRemovalTarget("把刚才那条路线缩短到90分钟，保留书店，把咖啡馆换成公园。"),
    "咖啡馆",
    "替换目标解析不能跨过标点误伤明确保留的类别"
  );
  assert.equal(
    inferWeatherRisk(0, undefined, 60, [{ name: "紫外线指数", category: "很强", text: "注意防晒" }]),
    "medium",
    "无降雨不代表户外风险低，强紫外线或酷热必须进入风险判断"
  );

  const calls: string[] = [];
  class FakeMapTool extends MapTool {
    override async geocode(name: string): Promise<string> { calls.push(`geocode:${name}`); return name === "新街口" ? "118,32" : "118.01,32.01"; }
    override async searchNearbyPoi() {
      calls.push("search_poi_nearby");
      return [
        { name: "安静书房", category: "bookstore" as const, averageCost: 20, location: "118.01,32.01", address: "测试路1号", rating: 4.7, distanceMeters: 600, styleScore: 0.8 },
        { name: "安静咖啡馆", category: "cafe" as const, averageCost: 35, location: "118.02,32.02", address: "测试路2号", rating: 4.6, distanceMeters: 800, styleScore: 0.8 },
        { name: "梧桐公园", category: "park" as const, averageCost: 0, location: "118.03,32.03", address: "测试路3号", rating: 4.8, distanceMeters: 1000, styleScore: 0 }
      ];
    }
    override async searchPoi() { calls.push("search_poi"); return this.searchNearbyPoi([], {}); }
    override async planRoute(origin: string, destinations: string[]) {
      calls.push("plan_route");
      return destinations.map((destination) => ({ origin, destination, distanceMeters: 1200, durationMinutes: 16, mode: "walk" as const }));
    }
  }
  class FakeWeatherTool extends WeatherTool {
    override async getWeatherContext(city: string) {
      calls.push("get_weather");
      return { rainProbability: 20, risk: "low" as const, summary: `${city}适合出行`, indices: [] };
    }
  }

  const agent = new UrbanPulseAgent(new FakeMapTool(), new FakeWeatherTool());
  const run = async (task: string, userId?: string) => {
    calls.length = 0;
    return agent.plan({ task, userId, threadId: userId ? `thread_${userId}` : undefined });
  };

  let result = await run("南京博物院需要预约吗？");
  assert.equal(result.intent.intent, "info_query");
  assert.equal(result.responseKind, "information");
  assert.deepEqual(calls, [], "基础问答不应误触发路线工具");

  result = await run("新街口附近有什么安静书店？");
  assert.equal(result.intent.intent, "poi_discovery");
  assert.equal(result.responseKind, "information");
  assert.ok(calls.includes("search_poi_nearby"));
  assert.ok(!calls.includes("plan_route"));

  result = await run("从新街口到南京博物院怎么走？");
  assert.equal(result.intent.intent, "navigation_query");
  assert.equal(result.responseKind, "information");
  assert.ok(calls.includes("plan_route"));
  assert.ok(!calls.includes("search_poi_nearby"));

  result = await run("比较路线A和路线B，哪条更适合带孩子？");
  assert.equal(result.intent.intent, "route_compare");
  assert.equal(result.responseKind, "comparison");
  assert.ok(result.comparison);

  result = await run("你记得我什么？", `intent_mem_${Date.now()}`);
  assert.equal(result.intent.intent, "memory_query");
  assert.equal(result.responseKind, "memory");

  result = await run("根据刚才的路线写三条朋友圈文案");
  assert.equal(result.intent.intent, "social_copy");
  assert.equal(result.responseKind, "social_copy");
  assert.equal(result.socialCopy?.variants.length, 3);

  result = await run("南京从新街口出发，2小时，预算100元，想逛书店和咖啡");
  assert.equal(result.intent.intent, "route_create");
  assert.equal(result.responseKind, "route");
  assert.ok(result.routeOverview);
  assert.ok(result.stops.length > 0);
  assert.ok(result.stops.some((stop) => stop.category === "bookstore"));
  assert.ok(result.stops.some((stop) => stop.category === "cafe"));
  assert.ok(result.summary.length < 100);
  assert.ok(calls.includes("get_weather") && calls.includes("search_poi_nearby") && calls.includes("plan_route"));

  const modifyUser = `modify_test_${Date.now()}`;
  const modifyThread = `thread_${modifyUser}`;
  historyStore.save({ task: "南京从新街口出发，2小时，预算100元，想逛书店和咖啡", userId: modifyUser, threadId: modifyThread }, result);
  const modified = await agent.plan({ task: "把上一条路线的咖啡馆换成公园，其他地点保留", userId: modifyUser, threadId: modifyThread });
  assert.equal(modified.intent.intent, "route_modify");
  assert.equal(modified.responseKind, "route");
  assert.ok(modified.stops.some((stop) => stop.name === "安静书房"), "未修改的旧站点应保留");
  assert.ok(modified.stops.every((stop) => stop.category !== "cafe"), "被换掉的类别不应重新混入候选");

  const compactModified = await agent.plan({
    task: "把刚才那条路线缩短到90分钟，保留书店，把咖啡馆换成公园。",
    userId: modifyUser,
    threadId: modifyThread
  });
  assert.ok(compactModified.stops.some((stop) => stop.category === "bookstore"), "短路线必须保留书店");
  assert.ok(compactModified.stops.some((stop) => stop.category === "park"), "短路线必须加入替换后的公园");
  assert.ok(compactModified.stops.every((stop) => stop.category !== "cafe"), "短路线不得保留被替换的咖啡馆");
  assert.ok(compactModified.totalEstimatedMinutes <= 90, "缩短后的路线不得超过90分钟");
  assert.ok(!compactModified.constraints.preferences.some((item) => /咖啡/.test(item)), "修改后偏好不得残留咖啡");

  calls.length = 0;
  const rainAdjusted = await agent.plan({
    task: "刚看到天气预报会下大雨，请把路线调整为室内优先，但时长预算不变。",
    userId: modifyUser,
    threadId: modifyThread
  });
  assert.equal(rainAdjusted.intent.intent, "route_modify", "雨天触发的路线调整不能误判为天气问答");
  assert.equal(rainAdjusted.responseKind, "route");
  assert.equal(rainAdjusted.constraints.city, "南京", "未明确改城市的路线修改必须继承原路线城市");
  assert.ok(calls.includes("get_weather") && calls.includes("search_poi_nearby") && calls.includes("plan_route"));
  const evaluationTrace = buildEvaluationTrace(rainAdjusted);
  const routeSummary = evaluationTrace.steps.find((step) => step.type === "tool_result" && step.tool === "route_summary");
  const evaluationAnswer = evaluationTrace.steps.findLast((step) => step.type === "final_answer")?.content ?? "";
  assert.ok(routeSummary?.output, "评测轨迹必须携带结构化路线证据");
  assert.match(evaluationAnswer, new RegExp(rainAdjusted.stops[0].name));
  assert.match(evaluationAnswer, /站点明细|路线分段|核算/);
  historyStore.list(modifyUser, 100, 0).entries.forEach((entry) => historyStore.deleteById(entry.id, modifyUser));

  const favoriteUser = `favorite_test_${Date.now()}`;
  const first = favoriteStore.save(favoriteUser, result);
  const duplicate = favoriteStore.save(favoriteUser, result);
  assert.equal(duplicate.id, first.id, "相同路线重复收藏应去重");
  assert.equal(favoriteStore.list(favoriteUser).length, 1);
  assert.equal(favoriteStore.delete(first.id, favoriteUser), true);
  assert.equal(favoriteStore.list(favoriteUser).length, 0);

  console.log("PASS intents: routing / dedicated tools / structured route / direct favorite operation");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
