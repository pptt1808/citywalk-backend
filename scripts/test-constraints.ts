import assert from "node:assert/strict";
import type { Poi } from "../src/tools/mapTool";
import type { WeatherContext } from "../src/tools/weatherTool";

process.env.AMAP_KEY = "";
process.env.QWEATHER_KEY = "";
process.env.HEFENG_KEY = "";
process.env.DEEPSEEK_API_KEY = "";
process.env.DEEPSEEK_FLASH_API_KEY = "";
process.env.DEEPSEEK_PRO_API_KEY = "";
process.env.DS_ = "";
process.env.DEEPSEEK_V3_API_KEY = "";
process.env.DSV4PRO_API_KEY = "";
process.env.EMBEDDING_API_KEY = "";

async function main() {
  const [{ UrbanPulseAgent }, llm, { MapTool }, { WeatherTool }] = await Promise.all([
    import("../src/agents/urbanPulseAgent"),
    import("../src/llm/llmRouter"),
    import("../src/tools/mapTool"),
    import("../src/tools/weatherTool")
  ]);
  const { normalizePlanSteps, normalizeTransportMode, parseConstraintPayload } = llm;
  const candidatePois: Poi[] = [
    { name: "亲子博物馆", category: "museum", averageCost: 40, location: "118,32", distanceMeters: 300, rating: 4.8, indoor: true },
    { name: "中央商场", category: "mall", averageCost: 30, location: "118.001,32.001", distanceMeters: 500, rating: 4.6, indoor: true },
    { name: "儿童咖啡馆", category: "cafe", averageCost: 25, location: "118.002,32.002", distanceMeters: 700, rating: 4.5, indoor: true },
    { name: "城市公园", category: "park", averageCost: 0, location: "118.0025,32.0025", distanceMeters: 750, rating: 4.7, indoor: false },
    { name: "某夜店", category: "sight", averageCost: 10, location: "118.003,32.003", distanceMeters: 350, rating: 5, indoor: false },
    { name: "无障碍洗手间(测试商场)", category: "sight", averageCost: 0, location: "118.004,32.004", distanceMeters: 200, rating: 5, indoor: true },
    { name: "名创优品(测试店)", category: "mall", averageCost: 0, location: "118.005,32.005", distanceMeters: 250, rating: 5, indoor: true }
  ];

  class FakeMapTool extends MapTool {
    override async geocode(): Promise<string> { return "118,32"; }
    override async searchNearbyPoi(): Promise<Poi[]> { return candidatePois; }
    override async searchPoi(): Promise<Poi[]> { return candidatePois; }
    override async planRoute(origin: string, destinations: string[], mode: "walk" | "transit" | "mixed") {
      return destinations.map((destination) => ({
        origin,
        destination,
        distanceMeters: 500,
        durationMinutes: 8,
        mode: mode === "transit" ? "transit" as const : "walk" as const
      }));
    }
  }

  class FakeWeatherTool extends WeatherTool {
    override async getWeatherContext(city: string): Promise<WeatherContext> {
      return { rainProbability: 10, risk: "low", summary: `${city}天气良好`, indices: [] };
    }
  }

  const normalizedPlan = normalizePlanSteps([
    { id: 7 as unknown as string, description: "先规划路线", toolHint: "route_plan", dependsOn: [], status: "pending" },
    { id: "poi_book", description: "搜索书店", toolHint: "poi_search", dependsOn: [], status: "pending" },
    { id: "weather", description: "查询天气", toolHint: "weather", dependsOn: [], status: "pending" },
    { id: "poi_cafe", description: "搜索咖啡馆", toolHint: "poi_search", dependsOn: [], status: "pending" },
    { id: "route_retry", description: "再次规划路线", toolHint: "route_plan", dependsOn: [], status: "pending" },
    { id: "check", description: "检查约束", toolHint: "constraint_check", dependsOn: [], status: "pending" }
  ]);
  assert.deepEqual(normalizedPlan.map((step) => step.toolHint), [
    "weather", "poi_search", "route_plan", "constraint_check"
  ]);
  assert.match(normalizedPlan[1].description, /搜索书店.*搜索咖啡馆/);
  assert.deepEqual(normalizedPlan[2].dependsOn, [normalizedPlan[1].id]);
  assert.equal(normalizedPlan[2].id, "7", "LLM 返回数字步骤 ID 时也必须安全归一化");

  assert.equal(normalizeTransportMode("walking"), "walk");
  assert.equal(normalizeTransportMode("public transport"), "transit");
  assert.equal(normalizeTransportMode("hybrid"), "mixed");
  assert.equal(normalizeTransportMode(["walking", "public transport"]), "mixed");

  const tolerantPayload = parseConstraintPayload({
    city: "香港",
    budget: "NaN",
    transportMode: ["walking", "public transport"],
    experience: { pace: "unexpected", restStopRequired: true }
  });
  assert.equal(tolerantPayload.city, "香港", "一个格式错误的可选字段不能丢弃有效城市");
  assert.equal(tolerantPayload.budget, undefined, "不限或非数值预算应归一化为无上限");
  assert.equal(tolerantPayload.transportMode, "mixed", "数组式交通偏好应归一化为 mixed");
  const accessiblePayload = parseConstraintPayload({
    city: "南京",
    accessibility: {
      wheelchairAccessRequired: "是",
      stepFreeRequired: true,
      accessibleRestroomRequired: 1
    }
  });
  assert.equal(accessiblePayload.accessibility?.wheelchairAccessRequired, true);
  assert.equal(accessiblePayload.accessibility?.accessibleRestroomRequired, true);

  const task = "南京一家三口带6岁孩子，从新街口出发，4小时，预算180元，想要轻松一点，有休息点，最好包含商场、咖啡或展览";
  const result = await new UrbanPulseAgent(new FakeMapTool(), new FakeWeatherTool()).plan({ task });

  assert.equal(result.constraints.party.total, 3);
  assert.equal(result.constraints.party.adults, 2);
  assert.equal(result.constraints.party.children, 1);
  assert.deepEqual(result.constraints.party.childAges, [6]);
  assert.equal(result.constraints.experience.familyFriendly, true);
  assert.equal(result.constraints.experience.pace, "relaxed");
  assert.equal(result.constraints.experience.restStopRequired, true);
  assert.ok(result.constraints.constraintLedger.some((entry) => entry.path === "party.children" && entry.priority === "hard"));
  assert.ok(result.constraints.constraintLedger.some((entry) => entry.path === "experience.restStopRequired" && entry.priority === "hard"));
  assert.ok(result.stops.length > 0);
  assert.ok(result.stops.every((stop) => stop.name !== "某夜店"));
  assert.ok(result.stops.every((stop) => !/无障碍洗手间|名创优品/.test(stop.name)), "设施点和零售小店不能作为游览站点");
  assert.ok(result.stops.some((stop) => ["cafe", "mall", "restaurant", "park", "bookstore"].includes(stop.category)));
  assert.equal(result.responseKind, "route");
  assert.match(result.routeOverview?.importantNotes.join("；") ?? "", /3人/);
  assert.match(result.routeOverview?.importantNotes.join("；") ?? "", /6岁/);
  assert.match(result.routeOverview?.importantNotes.join("；") ?? "", /休息点/);
  assert.ok(result.summary.length < 100, "路线摘要应保持紧凑，详细信息使用结构化字段");

  const poiAction = result.events?.find((event) => event.tool_call?.tool === "search_poi_nearby");
  assert.equal((poiAction?.tool_call?.input as { party?: { total?: number } } | undefined)?.party?.total, 3);

  const accessible = await new UrbanPulseAgent(new FakeMapTool(), new FakeWeatherTool()).plan({
    task: "南京新街口出发，2小时轮椅无障碍路线，必须全程无台阶、有电梯和无障碍卫生间，并能频繁休息。"
  });
  assert.equal(accessible.constraints.accessibility.wheelchairAccessRequired, true);
  assert.equal(accessible.constraints.accessibility.stepFreeRequired, true);
  assert.equal(accessible.constraints.accessibility.elevatorRequired, true);
  assert.equal(accessible.constraints.accessibility.accessibleRestroomRequired, true);
  assert.equal(accessible.constraints.accessibility.frequentRestRequired, true);
  assert.equal(accessible.constraints.startPoint, "南京新街口", "省略‘从’字时也必须识别明确起点");
  assert.equal(accessible.constraints.experience.pace, "relaxed");
  assert.equal(accessible.constraints.experience.restStopRequired, true);
  assert.equal(accessible.constraints.experience.restroomPreferred, true);
  assert.ok(accessible.constraints.constraintLedger.some((entry) =>
    entry.path === "accessibility.wheelchairAccessRequired" && entry.priority === "hard" && entry.value === true
  ));
  assert.ok(accessible.routeLegs.every((leg) => leg.mode !== "walk" || leg.durationMinutes <= 15));
  assert.ok(accessible.routeOverview, JSON.stringify({
    summary: accessible.summary,
    constraints: accessible.constraints,
    stops: accessible.stops,
    decisions: accessible.decisionLog
  }));
  assert.match(accessible.routeOverview?.importantNotes.join("；") ?? "", /无障碍硬约束/);
  assert.match(accessible.routeOverview?.importantNotes.join("；") ?? "", /出发前.*确认/);
  assert.ok(accessible.tradeoffs?.some((tradeoff) =>
    tradeoff.id === "accessibility-data-verification"
      && tradeoff.kind === "uncertainty"
      && tradeoff.alternatives.length > 0
  ), "无障碍设施无法由地图标签完全证明时，返回中必须显式声明不确定性、当前取舍和用户选项");
  assert.match(
    accessible.routeOverview?.importantNotes.join("；") ?? "",
    /取舍说明：.*地图 POI 标签.*当前选择：.*可选调整：/,
    "最终可见回答必须包含结构化取舍的可读说明"
  );
  const accessiblePoiAction = accessible.events?.find((event) => event.tool_call?.tool === "search_poi_nearby");
  assert.equal(
    (accessiblePoiAction?.tool_call?.input as { accessibility?: { stepFreeRequired?: boolean } } | undefined)?.accessibility?.stepFreeRequired,
    true
  );

  const stroller = await new UrbanPulseAgent(new FakeMapTool(), new FakeWeatherTool()).plan({
    task: "南京新街口出发，带婴儿车做2小时亲子路线，必须避开楼梯，优先电梯可达，并安排一个能休息和上卫生间的地方。"
  });
  assert.equal(stroller.constraints.party.stroller, true);
  assert.equal(stroller.constraints.accessibility.stepFreeRequired, true);
  assert.equal(stroller.constraints.accessibility.wheelchairAccessRequired, false,
    "婴儿车需要无台阶，但不能被模型扩张成轮椅硬约束");
  assert.notEqual(stroller.constraints.accessibility.accessibleRestroomRequired, true,
    "普通卫生间偏好不能被模型扩张成无障碍卫生间硬约束");
  assert.equal(stroller.constraints.experience.restroomPreferred, true);
  assert.ok(stroller.stops.length >= 2, "两小时亲子 CityWalk 不应因过度预留交通时间退化成单一站点");

  const indoorFacilityOnly = await new UrbanPulseAgent(new FakeMapTool(), new FakeWeatherTool()).plan({
    task: "南京新街口出发，3小时想去公园和博物馆，其中必须至少有一个无障碍卫生间较可靠的室内地点，单段步行不超过15分钟。"
  });
  assert.equal(indoorFacilityOnly.constraints.weatherPreference, undefined,
    "要求一个室内设施点不能扩张成整条路线室内优先");
  assert.ok(indoorFacilityOnly.stops.some((stop) => stop.category === "park"));
  assert.ok(indoorFacilityOnly.stops.some((stop) => stop.category === "museum"));
  const indoorFacilityPoiAction = indoorFacilityOnly.events?.find((event) => event.tool_call?.tool === "search_poi_nearby");
  assert.equal((indoorFacilityPoiAction?.tool_call?.input as { indoorOnly?: boolean } | undefined)?.indoorOnly, false);

  const multiTurnAgent = new UrbanPulseAgent(new FakeMapTool(), new FakeWeatherTool());
  const multiTurnScope = { userId: "constraint-regression-user", threadId: "constraint-regression-thread" };
  const initialRequest = {
    task: "从南京新街口出发安排3小时、预算180元的书店和公园路线。",
    ...multiTurnScope
  };
  const initialRoute = await multiTurnAgent.plan(initialRequest);
  assert.equal(initialRoute.constraints.endPoint, undefined, "明确起点不能被 LLM 复制为同名终点");
  const { historyStore } = await import("../src/services/historyStore");
  historyStore.save(initialRequest, initialRoute);
  const accessibleRevision = await multiTurnAgent.plan({
    task: "同行人临时需要使用轮椅，请改成全程无台阶、单段步行不超过15分钟，其他要求不变。",
    ...multiTurnScope
  });
  assert.equal(accessibleRevision.intent.intent, "route_modify");
  assert.equal(accessibleRevision.constraints.durationMinutes, 180,
    "单段步行15分钟不能覆盖上一轮3小时总时长");
  assert.equal(accessibleRevision.constraints.maxLegMinutes, 15);
  assert.equal(accessibleRevision.constraints.accessibility.wheelchairAccessRequired, true);
  assert.equal(accessibleRevision.constraints.accessibility.stepFreeRequired, true);
  assert.equal(accessibleRevision.constraints.party.total, 1, "‘同行人使用轮椅’不能被扩张成新增一人");
  assert.equal(accessibleRevision.constraints.transportMode, "mixed", "步行分段上限不能改写整条路线交通方式");
  assert.equal(accessibleRevision.constraints.experience.restStopRequired, true, "轮椅需求应派生休息点");
  assert.notEqual(accessibleRevision.constraints.experience.restroomPreferred, true,
    "未要求无障碍卫生间时不能由 LLM 新增硬偏好");

  const cityCalls: string[] = [];
  class LocationSafeMapTool extends MapTool {
    override async geocode(name: string, city: string): Promise<string> {
      cityCalls.push(`geocode:${city}:${name}`);
      return "114.16,22.28";
    }

    override async searchNearbyPoi(_keywords: string[], options: { city: string }): Promise<Poi[]> {
      cityCalls.push(`search:${options.city}`);
      return [
        { name: "重庆大厦", category: "sight", averageCost: 0, location: "114.173,22.297", city: "香港特别行政区", tags: ["旧楼", "霓虹", "街巷"], rating: 4.7 },
        { name: "中环街市", category: "mall", averageCost: 20, location: "114.155,22.284", city: "香港", tags: ["旧城", "建筑", "街市"], rating: 4.6 },
        { name: "南京错误候选", category: "cafe", averageCost: 30, location: "118.78,32.04", city: "南京市", tags: ["咖啡"], rating: 5 }
      ];
    }

    override async searchPoi(keywords: string[], options: { city: string }): Promise<Poi[]> {
      return this.searchNearbyPoi(keywords, options);
    }

    override async planRoute(origin: string, destinations: string[]) {
      return destinations.map((destination) => ({ origin, destination, distanceMeters: 600, durationMinutes: 9, mode: "walk" as const }));
    }
  }

  const locationAgent = new UrbanPulseAgent(new LocationSafeMapTool(), new FakeWeatherTool());
  const hongKong = await locationAgent.plan({ task: "我想在香港选一条有王家卫特色的漫游路径，一个人，预算不限" });
  assert.equal(hongKong.constraints.city, "香港");
  assert.equal(hongKong.constraints.startPoint, "香港市中心");
  assert.equal(hongKong.constraints.budget, undefined);
  assert.match(hongKong.constraints.style.rawText, /王家卫/);
  assert.ok(hongKong.stops.length > 0, JSON.stringify({
    constraints: hongKong.constraints,
    summary: hongKong.summary,
    decisions: hongKong.decisionLog,
    poiEvent: hongKong.events?.find((event) => event.tool_call?.tool === "search_poi_nearby" || event.tool_call?.tool === "search_poi")
  }));
  assert.ok(hongKong.stops.every((stop) => stop.city !== "南京市" && stop.name !== "南京错误候选"));
  assert.ok(hongKong.constraints.constraintLedger.some((entry) => entry.path === "city" && entry.value === "香港" && entry.source === "current_turn"));
  assert.ok(hongKong.constraints.constraintLedger.some((entry) => entry.path === "budget" && entry.value === "unlimited"));
  assert.match(hongKong.routeOverview?.title ?? "", /^香港 CityWalk/);
  assert.ok(cityCalls.some((call) => call === "search:香港"));

  const missingCity = await locationAgent.plan({ task: "帮我生成一条王家卫特色的漫游路线" });
  assert.equal(missingCity.constraints.city, "待确认城市");
  assert.equal(missingCity.constraints.startPoint, "待确认起点");
  assert.equal(missingCity.stops.length, 0);
  assert.match(missingCity.summary, /请先告诉我想在哪座城市/);
  assert.ok(missingCity.tradeoffs?.some((tradeoff) =>
    tradeoff.id === "no-feasible-route" && tradeoff.severity === "critical" && tradeoff.userChoiceRequired
  ));
  assert.doesNotMatch(`${missingCity.title}${missingCity.summary}`, /南京|新街口/);

  console.log("PASS constraint pipeline: tolerant LLM fields / accessibility hard constraints / location lock / party suitability");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
