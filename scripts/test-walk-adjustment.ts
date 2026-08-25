import assert from "node:assert/strict";
import { WalkAdjustmentService } from "../src/services/walkAdjustmentService";
import { MapTool, Poi } from "../src/tools/mapTool";
import { PlanningResult } from "../src/types/plan";

class FakeMapTool extends MapTool {
  override async searchNearbyPoi(keywords: string[]): Promise<Poi[]> {
    const restroom = keywords.some((keyword) => keyword.includes("厕所"));
    const quiet = keywords.some((keyword) => keyword.includes("安静") || keyword.includes("公园") || keyword.includes("展馆"));
    return [{
      name: restroom ? "沿途公共卫生间" : quiet ? "安静社区花园" : "临时休息咖啡",
      category: restroom ? "sight" : quiet ? "park" : "cafe",
      averageCost: restroom ? 0 : 25,
      location: "118.050000,32.050000",
      address: "测试路 5 号",
      city: "南京",
      rating: 4.8,
      distanceMeters: 300
    }];
  }

  override async planRoute(origin: string, destinations: string[]) {
    return destinations.map((destination, index) => ({
      origin: index ? destinations[index - 1] : origin,
      destination,
      distanceMeters: 350,
      durationMinutes: 5,
      mode: "walk" as const
    }));
  }
}

class LongLegMapTool extends FakeMapTool {
  override async planRoute(origin: string, destinations: string[]) {
    return destinations.map((destination, index) => ({
      origin: index ? destinations[index - 1] : origin,
      destination,
      distanceMeters: 3000,
      durationMinutes: 40,
      mode: "walk" as const
    }));
  }
}

const route = {
  intent: { intent: "route_create", confidence: 1, reason: "test" },
  responseKind: "route",
  title: "南京行中测试路线",
  summary: "测试路线",
  totalEstimatedCost: 80,
  totalEstimatedMinutes: 150,
  startLocation: "118.000000,32.000000",
  stops: [
    { name: "起点公园", category: "park", estimatedCost: 0, estimatedStayMinutes: 30, reason: "起点", location: "118.010000,32.010000" },
    { name: "热门街区", category: "sight", estimatedCost: 0, estimatedStayMinutes: 35, reason: "街区", location: "118.020000,32.020000" },
    { name: "独立咖啡馆", category: "cafe", estimatedCost: 40, estimatedStayMinutes: 35, reason: "休息", location: "118.030000,32.030000" },
    { name: "城市博物馆", category: "museum", estimatedCost: 40, estimatedStayMinutes: 40, reason: "室内", location: "118.040000,32.040000" }
  ],
  constraints: {
    city: "南京", startPoint: "起点公园", durationMinutes: 150, budget: 200,
    preferences: ["书店", "咖啡"], party: { total: 1, adults: 1, children: 0, childAges: [], seniors: 0, stroller: false, mobilityNeeds: [] },
    experience: { pace: "normal", familyFriendly: false, restStopRequired: false, restroomPreferred: false, avoidCrowds: false },
    accessibility: { wheelchairAccessRequired: false, stepFreeRequired: false, elevatorRequired: false, accessibleRestroomRequired: false, frequentRestRequired: false },
    style: { rawText: "", summary: "", tags: [], desiredScenes: [], avoidances: [], searchHints: [], narrativeArc: [], confidence: 0 },
    constraintLedger: []
  },
  routeLegs: [
    { origin: "118.000000,32.000000", destination: "118.010000,32.010000", distanceMeters: 500, durationMinutes: 7, mode: "walk" },
    { origin: "118.010000,32.010000", destination: "118.020000,32.020000", distanceMeters: 500, durationMinutes: 7, mode: "walk" },
    { origin: "118.020000,32.020000", destination: "118.030000,32.030000", distanceMeters: 500, durationMinutes: 7, mode: "walk" },
    { origin: "118.030000,32.030000", destination: "118.040000,32.040000", distanceMeters: 500, durationMinutes: 7, mode: "walk" }
  ],
  decisionLog: []
} as unknown as PlanningResult;

async function main() {
  const service = new WalkAdjustmentService(new FakeMapTool());
  const currentLocation = { lng: 118.011, lat: 32.011 };

  const tired = await service.adjust({ route, reason: "tired", visitedStopNames: ["起点公园"], currentLocation, remainingMinutes: 60 });
  assert.equal(tired.route.stops[0].name, "起点公园", "已完成站点必须锁定为路线前缀");
  assert.deepEqual(tired.revision.completedStopNames, ["起点公园"]);
  assert.ok(tired.route.stops.length <= 3, "疲劳模式最多保留两个未完成站点");
  assert.equal(route.stops.length, 4, "行中调整不得直接修改原路线对象");

  const compact = await service.adjust({ route, reason: "time_short", visitedStopNames: ["起点公园"], currentLocation, remainingMinutes: 30 });
  assert.ok(compact.revision.remainingMinutes <= 30, "时间不足时剩余路线必须收紧到用户时间内");
  assert.equal(compact.route.stops[0].name, "起点公园");

  const longLegService = new WalkAdjustmentService(new LongLegMapTool());
  const unreachable = await longLegService.adjust({ route, reason: "time_short", visitedStopNames: ["起点公园"], currentLocation, remainingMinutes: 30 });
  assert.equal(unreachable.revision.remainingMinutes, 0, "下一站路程已超过剩余时间时不应继续推荐不可执行的站点");
  assert.ok(unreachable.revision.warnings.some((item) => item.includes("仅路上")));

  const midRoute = await service.adjust({ route, reason: "rest", visitedStopNames: ["热门街区"], currentLocation });
  assert.deepEqual(midRoute.revision.completedStopNames, ["热门街区"], "中途开始记录时只能锁定真正完成的站点");
  assert.ok(midRoute.revision.retainedStopNames.includes("起点公园"), "未到访的前序站点仍应作为可调整的剩余路线处理");

  const deviation = await service.adjust({ route, reason: "deviation", visitedStopNames: ["起点公园"], currentLocation });
  assert.deepEqual(deviation.revision.addedStopNames, [], "偏航重连不应擅自增加新地点");
  assert.equal(deviation.route.routeLegs?.at(-3)?.origin, `${currentLocation.lng.toFixed(6)},${currentLocation.lat.toFixed(6)}`);

  const rain = await service.adjust({ route, reason: "rain", visitedStopNames: ["起点公园"], currentLocation, remainingMinutes: 100 });
  assert.ok(rain.route.stops.slice(1).every((stop) => ["bookstore", "cafe", "museum", "mall", "restaurant"].includes(stop.category)), "雨天剩余站点应为室内类别");
  assert.equal(rain.route.constraints.weatherPreference, "indoor_first");

  const crowded = await service.adjust({ route, reason: "crowded", visitedStopNames: ["起点公园"], currentLocation });
  assert.ok(!crowded.route.stops.some((stop) => stop.name === "热门街区"), "现场拥挤时应替换当前未完成站点");
  assert.ok(crowded.revision.addedStopNames.includes("安静社区花园"));
  assert.ok(crowded.revision.warnings.some((item) => item.includes("实时人流")), "不得伪装拥有实时人流数据");

  const skipped = await service.adjust({
    route, reason: "custom", visitedStopNames: ["起点公园"], skippedStopNames: ["热门街区"],
    currentLocation, customRequest: "跳过热门街区，换成安静的公园"
  });
  assert.ok(!skipped.route.stops.some((stop) => stop.name === "热门街区"));
  assert.equal(skipped.route.stops[0].name, "起点公园");

  console.log("PASS walk adjustment: visited lock / actual time cap / mid-route start / deviation reconnect / rain fallback / crowd honesty / skip remainder");
}

void main();
