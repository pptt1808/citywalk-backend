import { MapTool, Poi } from "../tools/mapTool";
import { PlanningResult, RouteLeg, RouteStop } from "../types/plan";
import {
  WalkAdjustmentReason,
  WalkAdjustmentRequest,
  WalkAdjustmentResponse,
  WalkRouteRevision
} from "../types/walk";

const REASON_LABELS: Record<WalkAdjustmentReason, string> = {
  tired: "有点累了",
  time_short: "时间不够",
  rain: "突然下雨",
  crowded: "这里太挤",
  rest: "想先休息",
  restroom: "需要卫生间",
  custom: "自定义调整",
  deviation: "偏离路线"
};

const INDOOR_CATEGORIES = new Set<RouteStop["category"]>(["bookstore", "cafe", "museum", "mall", "restaurant", "shop", "studio"]);
const REST_CATEGORIES = new Set<RouteStop["category"]>(["cafe", "park", "mall", "restaurant"]);

function pointText(point?: WalkAdjustmentRequest["currentLocation"]): string | undefined {
  if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) return undefined;
  return `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`;
}

function haversineMeters(origin: string, destination: string): number {
  const [lng1, lat1] = origin.split(",").map(Number);
  const [lng2, lat2] = destination.split(",").map(Number);
  if (![lng1, lat1, lng2, lat2].every(Number.isFinite)) return 0;
  const radius = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function estimatedLeg(origin: string, destination: string, originName: string, destinationName: string): RouteLeg {
  const distanceMeters = Math.round(haversineMeters(origin, destination));
  return {
    origin,
    destination,
    originName,
    destinationName,
    distanceMeters,
    durationMinutes: Math.max(1, Math.round(distanceMeters / 75)),
    mode: "walk",
    estimated: true
  };
}

function stopCost(stop: RouteStop): number {
  return Math.max(0, Number(stop.estimatedCost) || 0);
}

function uniqueStops(stops: RouteStop[]): RouteStop[] {
  const seen = new Set<string>();
  return stops.filter((stop) => {
    if (!stop.name || seen.has(stop.name)) return false;
    seen.add(stop.name);
    return true;
  });
}

function customSearchTerms(request: WalkAdjustmentRequest, fallback: string[]): string[] {
  const custom = request.customRequest?.trim() ?? "";
  if (!custom) return fallback;
  const captures = [
    custom.match(/(?:换成|改成|加一个|找一个|想去|想找)[：:\s]*([^，。；;]{2,24})/u)?.[1],
    custom.match(/(?:优先|偏向)[：:\s]*([^，。；;]{2,24})/u)?.[1]
  ].filter((value): value is string => Boolean(value));
  return [...new Set([...captures, ...fallback])].slice(0, 4);
}

function explicitlyRemoved(stop: RouteStop, request: WalkAdjustmentRequest): boolean {
  if (request.skippedStopNames?.includes(stop.name)) return true;
  const custom = request.customRequest ?? "";
  if (!custom) return false;
  if (new RegExp(`(?:跳过|不要|删掉|去掉|换掉).{0,8}${stop.name}`, "u").test(custom)) return true;
  const categoryWords: Partial<Record<RouteStop["category"], RegExp>> = {
    cafe: /咖啡馆|咖啡店/u,
    bookstore: /书店|书局/u,
    museum: /博物馆|美术馆|展馆/u,
    park: /公园|绿地/u,
    mall: /商场|购物中心/u,
    restaurant: /餐厅|饭店/u,
    shop: /古着|唱片|买手|花店|杂货|文创|二手|独立小店/u,
    market: /市场|市集|菜市场|街市/u,
    studio: /工作室|工坊|手作|独立画廊/u,
    street_scene: /街巷|胡同|小巷|天桥|步道|河岸/u,
    event: /活动|展会|节庆|快闪|音乐节/u
  };
  return /(?:不要|删掉|去掉|换掉)/u.test(custom) && Boolean(categoryWords[stop.category]?.test(custom));
}

function poiToStop(poi: Poi, route: PlanningResult, reason: string, stayMinutes: number): RouteStop {
  const perPerson = Math.max(0, poi.averageCost || 0);
  const people = Math.max(1, route.constraints.party?.total ?? route.constraints.peopleCount ?? 1);
  return {
    name: poi.name,
    category: poi.category,
    kind: poi.kind,
    subtype: poi.subtype,
    amapTypeCode: poi.amapTypeCode,
    estimatedCost: perPerson * people,
    estimatedCostPerPerson: perPerson,
    estimatedStayMinutes: stayMinutes,
    reason,
    location: poi.location,
    address: poi.address,
    city: poi.city,
    rating: poi.rating,
    distanceMeters: poi.distanceMeters,
    suitabilityTags: ["行中调整"],
    discoverySource: poi.discoverySource,
    verificationStatus: poi.verificationStatus,
    evidenceUrls: poi.evidenceUrls,
    discoveryReasons: poi.discoveryReasons,
    discoveryConfidence: poi.discoveryConfidence,
    cityWalkScore: poi.cityWalkScore
  };
}

function chooseCandidate(candidates: Poi[], excludedNames: Set<string>): Poi | undefined {
  return candidates
    .filter((poi) => poi.location && !excludedNames.has(poi.name))
    .sort((left, right) => (right.rating ?? 0) - (left.rating ?? 0)
      || (left.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (right.distanceMeters ?? Number.MAX_SAFE_INTEGER))[0];
}

function fitToTime(stops: RouteStop[], cap: number, relaxed = false): RouteStop[] {
  const safeCap = Math.max(20, Math.min(240, cap));
  const routeReserve = Math.max(10, Math.round(safeCap * 0.22));
  const result: RouteStop[] = [];
  let used = 0;
  for (const original of stops) {
    const maxStay = relaxed ? 25 : 40;
    const availableStay = Math.max(10, safeCap - routeReserve - used);
    const stay = Math.max(10, Math.min(maxStay, original.estimatedStayMinutes || 25, availableStay));
    if (result.length && used + stay + routeReserve > safeCap) break;
    result.push({ ...original, estimatedStayMinutes: stay });
    used += stay;
    if (relaxed && result.length >= 2) break;
  }
  return result.length ? result : stops.slice(0, 1).map((stop) => ({ ...stop, estimatedStayMinutes: Math.min(20, stop.estimatedStayMinutes || 20) }));
}

export class WalkAdjustmentService {
  constructor(private readonly mapTool: MapTool = new MapTool()) {}

  async adjust(request: WalkAdjustmentRequest, signal?: AbortSignal): Promise<WalkAdjustmentResponse> {
    const original = request.route;
    const skipped = new Set(request.skippedStopNames ?? []);
    const visited = new Set(request.visitedStopNames);
    const completedStops = original.stops.filter((stop) => visited.has(stop.name) && !skipped.has(stop.name));
    const originalRemaining = original.stops.filter((stop) => !visited.has(stop.name) && !skipped.has(stop.name) && !explicitlyRemoved(stop, request));
    const excludedNames = new Set(original.stops.map((stop) => stop.name));
    const currentOrigin = pointText(request.currentLocation)
      ?? completedStops.at(-1)?.location
      ?? original.startLocation
      ?? original.constraints.startPoint;
    const city = original.routeOverview?.city ?? original.constraints.city;
    const defaultCap = Math.max(30, Math.min(180, request.remainingMinutes ?? originalRemaining.reduce((sum, stop) => sum + stop.estimatedStayMinutes, 0) + 30));
    const warnings: string[] = [];
    let remaining = [...originalRemaining];

    if (request.reason === "tired") {
      remaining = fitToTime(remaining, request.remainingMinutes ?? Math.min(defaultCap, 75), true);
      const restIndex = remaining.findIndex((stop) => REST_CATEGORIES.has(stop.category));
      if (restIndex > 0) remaining = [remaining[restIndex], ...remaining.filter((_, index) => index !== restIndex)];
    } else if (request.reason === "time_short") {
      remaining = fitToTime(remaining, request.remainingMinutes ?? 45);
    } else if (request.reason === "rain") {
      remaining = remaining.filter((stop) => INDOOR_CATEGORIES.has(stop.category));
      if (remaining.length < 2) {
        const candidates = await this.mapTool.searchNearbyPoi(["博物馆", "书店", "商场", "咖啡馆"], {
          city,
          location: currentOrigin,
          indoorOnly: true,
          radius: 2500,
          offset: 8,
          signal
        });
        const candidate = chooseCandidate(candidates, excludedNames);
        if (candidate) remaining.unshift(poiToStop(candidate, original, "临时补充的室内避雨点", 30));
      }
      remaining = fitToTime(uniqueStops(remaining), request.remainingMinutes ?? defaultCap, true);
    } else if (request.reason === "deviation") {
      warnings.push("已从当前位置重新连接未完成站点，走过的轨迹和已完成地点保持不变。");
    } else if (request.reason === "rest" || request.reason === "restroom" || request.reason === "crowded" || request.reason === "custom") {
      if (request.reason === "crowded" && remaining.length) remaining.shift();
      const fallbackTerms = request.reason === "restroom"
        ? ["公共厕所", "商场"]
        : request.reason === "rest"
          ? ["咖啡馆", "公园", "商场"]
          : request.reason === "crowded"
            ? ["安静书店", "社区公园", "小型展馆"]
            : original.constraints.preferences.slice(0, 3);
      const candidates = await this.mapTool.searchNearbyPoi(customSearchTerms(request, fallbackTerms.length ? fallbackTerms : ["附近可逛地点"]), {
        city,
        location: currentOrigin,
        radius: request.reason === "restroom" ? 1200 : 2500,
        offset: 10,
        signal
      });
      const candidate = chooseCandidate(candidates, excludedNames);
      if (candidate) {
        const stay = request.reason === "restroom" ? 10 : request.reason === "rest" ? 25 : 30;
        const reason = request.reason === "restroom" ? "当前位置附近的临时卫生间支援点"
          : request.reason === "rest" ? "优先安排的休息点"
            : request.reason === "crowded" ? "用于避开当前拥挤点的附近备选"
              : `响应行中调整：${request.customRequest?.slice(0, 80) || "调整剩余路线"}`;
        remaining.unshift(poiToStop(candidate, original, reason, stay));
      } else {
        warnings.push("地图服务未返回合适的新地点，已保留其他可执行站点。");
      }
      if (request.reason === "crowded") warnings.push("高德基础 POI 不提供可核验的实时人流，本次是根据你的现场反馈替换当前站点。");
      remaining = fitToTime(uniqueStops(remaining), request.remainingMinutes ?? defaultCap, request.reason === "rest");
    }

    remaining = uniqueStops(remaining);
    const planRemaining = async (stops: RouteStop[]) => {
      const destinations = stops.filter((stop): stop is RouteStop & { location: string } => Boolean(stop.location));
      let legs = currentOrigin
        ? await this.mapTool.planRoute(currentOrigin, destinations.map((stop) => stop.location), request.reason === "tired" ? "mixed" : original.constraints.transportMode ?? "mixed", city, signal)
        : [];
      if (currentOrigin && destinations.length && legs.length !== destinations.length) {
        let origin = currentOrigin;
        legs = destinations.map((stop, index) => {
          const leg = legs[index] ?? estimatedLeg(origin, stop.location, index ? destinations[index - 1].name : "当前位置", stop.name);
          const normalized = {
            ...leg,
            origin,
            destination: stop.location,
            originName: index ? destinations[index - 1].name : "当前位置",
            destinationName: stop.name
          };
          origin = stop.location;
          return normalized;
        });
      } else {
        legs = legs.map((leg, index) => ({
          ...leg,
          originName: index ? destinations[index - 1]?.name : "当前位置",
          destinationName: destinations[index]?.name
        }));
      }
      return legs;
    };

    let remainingLegs = await planRemaining(remaining);
    // An explicitly supplied remaining-time budget is a hard user constraint
    // regardless of why the route is being adjusted (including deviation,
    // rain and restroom requests).  Falling back to the legacy 45-minute cap
    // is kept only for the time_short intent when no budget was supplied.
    const strictTimeCap = request.remainingMinutes != null
      ? request.remainingMinutes
      : request.reason === "time_short"
        ? 45
        : undefined;
    if (strictTimeCap) {
      const remainingDuration = () => remaining.reduce((sum, stop) => sum + Math.max(0, stop.estimatedStayMinutes), 0)
        + remainingLegs.reduce((sum, leg) => sum + Math.max(0, leg.durationMinutes), 0);
      while (remaining.length > 1 && remainingDuration() > strictTimeCap) {
        remaining.pop();
        remainingLegs = await planRemaining(remaining);
      }
      if (remaining.length === 1 && remainingDuration() > strictTimeCap) {
        const travelMinutes = remainingLegs.reduce((sum, leg) => sum + Math.max(0, leg.durationMinutes), 0);
        const availableStay = Math.floor(strictTimeCap - travelMinutes);
        if (availableStay >= 5) {
          remaining[0] = { ...remaining[0], estimatedStayMinutes: Math.min(remaining[0].estimatedStayMinutes, availableStay) };
        } else {
          warnings.push(`最近的下一站仅路上就约需 ${travelMinutes} 分钟，已结束剩余安排，建议就近休息或返程。`);
          remaining = [];
          remainingLegs = [];
        }
      }
    }
    if (!remaining.length && !completedStops.length) {
      const fallbackLocation = currentOrigin && /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/u.test(currentOrigin) ? currentOrigin : undefined;
      remaining = [{
        name: "当前位置 · 结束漫步",
        category: "sight",
        estimatedCost: 0,
        estimatedStayMinutes: 0,
        reason: "剩余时间不足以安全到达下一站，路线在当前位置收尾",
        location: fallbackLocation,
        suitabilityTags: ["行中调整", "就地结束"]
      }];
      remainingLegs = [];
    }

    const completedPrefixLength = original.stops.findIndex((stop) => !visited.has(stop.name));
    const safePrefixLength = completedPrefixLength === -1 ? original.stops.length : completedPrefixLength;
    const completedLegs = (original.routeLegs ?? []).slice(0, Math.min(safePrefixLength, original.routeLegs?.length ?? 0));
    const allStops = [...completedStops, ...remaining];
    const allLegs = [...completedLegs, ...remainingLegs];
    const totalCost = allStops.reduce((sum, stop) => sum + stopCost(stop), 0);
    const totalMinutes = allStops.reduce((sum, stop) => sum + Math.max(0, stop.estimatedStayMinutes), 0)
      + allLegs.reduce((sum, leg) => sum + Math.max(0, leg.durationMinutes), 0);
    const remainingMinutes = remaining.reduce((sum, stop) => sum + Math.max(0, stop.estimatedStayMinutes), 0)
      + remainingLegs.reduce((sum, leg) => sum + Math.max(0, leg.durationMinutes), 0);
    const originalRemainingNames = new Set(originalRemaining.map((stop) => stop.name));
    const remainingNames = new Set(remaining.map((stop) => stop.name));
    const retainedStopNames = remaining.filter((stop) => originalRemainingNames.has(stop.name)).map((stop) => stop.name);
    const removedStopNames = original.stops.filter((stop) => !visited.has(stop.name) && !remainingNames.has(stop.name)).map((stop) => stop.name);
    const addedStopNames = remaining.filter((stop) => !originalRemainingNames.has(stop.name)).map((stop) => stop.name);
    const revision: WalkRouteRevision = {
      id: `wr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      reason: request.reason,
      reasonLabel: REASON_LABELS[request.reason],
      summary: this.summary(request.reason, completedStops.length, retainedStopNames, removedStopNames, addedStopNames, remainingMinutes),
      adjustedAt: new Date().toISOString(),
      completedStopNames: completedStops.map((stop) => stop.name),
      retainedStopNames,
      removedStopNames,
      addedStopNames,
      remainingMinutes,
      warnings
    };

    return {
      route: {
        ...original,
        title: original.title.replace(/\s*·\s*行中调整$/u, "") + " · 行中调整",
        summary: revision.summary,
        totalEstimatedCost: totalCost,
        totalEstimatedMinutes: totalMinutes,
        stops: allStops,
        routeLegs: allLegs,
        constraints: {
          ...original.constraints,
          durationMinutes: remainingMinutes,
          experience: {
            ...original.constraints.experience,
            pace: request.reason === "tired" || request.reason === "rest" ? "relaxed" : original.constraints.experience.pace,
            restStopRequired: request.reason === "tired" || request.reason === "rest" ? true : original.constraints.experience.restStopRequired,
            restroomPreferred: request.reason === "restroom" ? true : original.constraints.experience.restroomPreferred,
            avoidCrowds: request.reason === "crowded" ? true : original.constraints.experience.avoidCrowds
          },
          weatherPreference: request.reason === "rain" ? "indoor_first" : original.constraints.weatherPreference,
          weatherRisk: request.reason === "rain" ? "high" : original.constraints.weatherRisk
        },
        routeOverview: original.routeOverview ? {
          ...original.routeOverview,
          title: original.routeOverview.title.replace(/\s*·\s*行中调整$/u, "") + " · 行中调整",
          stopCount: allStops.length,
          time: {
            ...original.routeOverview.time,
            totalMinutes,
            travelMinutes: allLegs.reduce((sum, leg) => sum + leg.durationMinutes, 0),
            stayMinutes: allStops.reduce((sum, stop) => sum + stop.estimatedStayMinutes, 0)
          },
          cost: { ...original.routeOverview.cost, total: totalCost }
        } : undefined,
        decisionLog: [...original.decisionLog, revision.summary]
      },
      revision
    };
  }

  private summary(
    reason: WalkAdjustmentReason,
    completedCount: number,
    retained: string[],
    removed: string[],
    added: string[],
    remainingMinutes: number
  ): string {
    const changes = [
      retained.length ? `保留 ${retained.length} 个后续站点` : "",
      removed.length ? `移除 ${removed.join("、")}` : "",
      added.length ? `加入 ${added.join("、")}` : ""
    ].filter(Boolean).join("，");
    return `已锁定 ${completedCount} 个已走站点，因“${REASON_LABELS[reason]}”只调整剩余路线${changes ? `：${changes}` : ""}。调整后预计剩余 ${remainingMinutes} 分钟。`;
  }
}

export const walkAdjustmentService = new WalkAdjustmentService();
