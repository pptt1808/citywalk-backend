import { PlanningResult, RouteStop, UserConstraints } from "../types/plan";
import { MapTool } from "../tools/mapTool";
import { WeatherTool } from "../tools/weatherTool";

export class UrbanPulseAgent {
  constructor(
    private readonly mapTool: MapTool,
    private readonly weatherTool: WeatherTool
  ) {}

  async plan(input: UserConstraints): Promise<PlanningResult> {
    const decisionLog: string[] = [];
    const rainProbability = await this.weatherTool.getRainProbability();
    const weatherRisk =
      input.weatherRisk ??
      (rainProbability >= 60 ? "high" : rainProbability >= 30 ? "medium" : "low");

    decisionLog.push(`天气工具返回未来降雨概率 ${rainProbability}%`);
    decisionLog.push(`综合判断天气风险为 ${weatherRisk}`);

    const preferenceKeywords = input.preferences.length > 0 ? input.preferences : ["书店", "咖啡"];
    const pois = await this.mapTool.searchNearbyPoi(preferenceKeywords);
    decisionLog.push(`地图工具返回 ${pois.length} 个候选点`);

    const sorted = [...pois].sort((a, b) => a.averageCost - b.averageCost);
    const stops: RouteStop[] = [];
    let currentCost = 0;
    let currentMinutes = 0;

    for (const poi of sorted) {
      const stay = poi.category === "sight" ? 35 : 50;
      if (currentCost + poi.averageCost > input.budget) {
        decisionLog.push(`跳过 ${poi.name}，原因：会导致预算超支`);
        continue;
      }
      if (currentMinutes + stay > input.durationMinutes) {
        decisionLog.push(`跳过 ${poi.name}，原因：会超过可用时间`);
        continue;
      }

      stops.push({
        name: poi.name,
        category: poi.category,
        estimatedCost: poi.averageCost,
        estimatedStayMinutes: stay,
        reason: weatherRisk === "high" && poi.category !== "sight" ? "雨天优先室内点位" : "满足预算与时间约束"
      });

      currentCost += poi.averageCost;
      currentMinutes += stay;
    }

    if (weatherRisk === "high") {
      decisionLog.push("检测到高雨风险，优先保留书店与咖啡馆等室内节点");
    }

    if (stops.length === 0) {
      decisionLog.push("当前约束过严，建议放宽预算或增加可用时间");
    }

    return {
      summary: `从${input.startPoint}出发，生成 ${stops.length} 个点位的动态路线`,
      totalEstimatedCost: currentCost,
      totalEstimatedMinutes: currentMinutes,
      stops,
      decisionLog
    };
  }
}
